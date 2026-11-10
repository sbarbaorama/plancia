"""Operazioni di dominio: pianificazione, ore, ricorrenze, verbali, consulenze, cockpit cliente, riepiloghi."""
import csv
import io
import json
from datetime import date, datetime, timedelta

from . import crud
from .crud import LOCAL, NotFound, ValidationError, add_interval, as_int, get_item, list_items, log, now_iso, \
    parse_date, transaction
from .schema import ENUM_LABELS, R

# ---------------------------------------------------------------- impostazioni

SETTINGS_DEFAULTS = {
    "backup_dir": "",            # vuoto = cartella "backups" del programma
    "retention_days": 30,
    "theme": "auto",
    "density": "comoda",
    "work_hours": 7.5,           # ore disponibili al giorno per la pianificazione
    "day_start": "08:30",
    "day_end": "17:30",
    "notifications": 1,
    "legacy_db_path": "",
    "last_backup": None,
    "last_backup_error": None,
}
THEMES = ("auto", "chiaro", "scuro", "salvia", "lavanda", "sabbia", "cobalto", "corallo", "smeraldo")
PUBLIC_SETTINGS = ("backup_dir", "retention_days", "theme", "density", "work_hours", "day_start", "day_end",
                   "notifications", "legacy_db_path")


def get_settings(conn):
    values = dict(SETTINGS_DEFAULTS)
    for row in conn.execute("SELECT key, value FROM settings"):
        values[row["key"]] = row["value"]
    for key, cast in (("retention_days", int), ("work_hours", float), ("notifications", int)):
        try:
            values[key] = cast(values[key])
        except (TypeError, ValueError):
            values[key] = SETTINGS_DEFAULTS[key]
    return values


def put_settings(conn, data, internal=False):
    if not isinstance(data, dict):
        raise ValidationError("Impostazioni non valide")
    allowed = SETTINGS_DEFAULTS.keys() if internal else PUBLIC_SETTINGS
    clean = {}
    for key, value in data.items():
        if key not in allowed:
            continue
        if key == "retention_days":
            value = as_int(value, "Giorni di conservazione")
            if value is None or not 1 <= value <= 3650:
                raise ValidationError("Giorni di conservazione: tra 1 e 3650")
        elif key == "work_hours":
            try:
                value = float(value)
            except (TypeError, ValueError):
                raise ValidationError("Ore al giorno: numero non valido")
            if not 0.5 <= value <= 16:
                raise ValidationError("Ore al giorno: tra 0,5 e 16")
        elif key in ("day_start", "day_end"):
            value = crud.parse_time(value, "Orario")
        elif key == "theme" and value not in THEMES:
            raise ValidationError("Tema non valido")
        elif key == "density" and value not in ("comoda", "compatta"):
            raise ValidationError("Densità non valida")
        elif key == "notifications":
            value = 1 if value in (1, True, "1", "true") else 0
        elif key in ("backup_dir", "legacy_db_path"):
            value = str(value or "").strip()
        clean[key] = value
    with transaction(conn):
        for key, value in clean.items():
            conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                         (key, None if value is None else str(value)))
    return get_settings(conn)


# ---------------------------------------------------------------- task: ricorrenze, sotto-task

def after_task_update(conn, old, record, ctx):
    """Effetti collaterali della chiusura/riapertura di un task."""
    closing = record.get("status") == "chiuso" and old["status"] != "chiuso"
    reopening = "status" in record and record["status"] != "chiuso" and old["status"] == "chiuso"
    if closing:
        conn.execute("""UPDATE time_entries SET ended_at = ?, minutes = MAX(minutes,
                        CAST(ROUND((julianday(?) - julianday(started_at)) * 1440) AS INTEGER)), updated_at = ?
                        WHERE task_id = ? AND started_at IS NOT NULL AND ended_at IS NULL""",
                     (now_iso()[:16], now_iso()[:16], now_iso(), old["id"]))
        conn.execute("UPDATE consultations SET status = 'chiusa', closed_at = ?, updated_at = ? WHERE task_id = ? AND status != 'chiusa'",
                     (now_iso(), now_iso(), old["id"]))
        task = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (old["id"],)).fetchone())
        if task["recurrence_unit"] != "nessuna":
            _repeat_task(conn, task, ctx)
    elif reopening:
        conn.execute("UPDATE consultations SET status = 'in_corso', closed_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'chiusa'",
                     (now_iso(), old["id"]))


def _repeat_task(conn, task, ctx):
    unit, every = task["recurrence_unit"], task["recurrence_every"]
    shift = lambda v: add_interval(date.fromisoformat(v), unit, every).isoformat() if v else None
    new = {k: task[k] for k in ("title", "notes", "project_id", "customer_id", "priority", "estimate_min",
                                 "recurrence_unit", "recurrence_every", "assignee_id", "visibility", "owner_id", "plan_time")}
    new.update(status="da_fare", start_date=shift(task["start_date"]), due_date=shift(task["due_date"]),
               created_at=now_iso(), updated_at=now_iso(), kind="task", plan_order=0)
    new_id = crud._insert(conn, "tasks", new)
    for s in conn.execute("SELECT position, title FROM subtasks WHERE task_id = ? ORDER BY position", (task["id"],)).fetchall():
        conn.execute("INSERT INTO subtasks (task_id, position, title, done, outcome, created_at, updated_at) VALUES (?,?,?,0,'',?,?)",
                     (new_id, s[0], s[1], now_iso(), now_iso()))
    # il task chiuso non si ripete più: la ricorrenza passa al nuovo
    conn.execute("UPDATE tasks SET recurrence_unit = 'nessuna' WHERE id = ?", (task["id"],))
    log(conn, ctx, "tasks", new_id, "creato", task["title"], crud.customer_of(conn, R["tasks"], new_id), "Ripetizione automatica")
    return new_id


def list_subtasks(conn, task_id):
    return [dict(r) for r in conn.execute("SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, id", (task_id,))]


def set_subtasks(conn, task_id, items, ctx=LOCAL):
    """Sostituisce l'elenco dei sotto-task (mantiene gli id esistenti, così l'esito resta collegato)."""
    task = get_item(conn, "tasks", task_id, ctx)
    if not isinstance(items, list) or len(items) > 200:
        raise ValidationError("Sotto-task: elenco non valido")
    with transaction(conn):
        existing = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM subtasks WHERE task_id = ?", (task["id"],))}
        keep = set()
        now = now_iso()
        for pos, it in enumerate(items):
            if not isinstance(it, dict):
                raise ValidationError("Sotto-task non valido")
            title = str(it.get("title") or "").strip()[:300]
            if not title:
                continue
            done = 1 if it.get("done") else 0
            outcome = str(it.get("outcome") or "").strip()[:2000]
            sid = it.get("id")
            if sid in existing:
                old = existing[sid]
                done_at = old["done_at"] if done and old["done"] else (now if done else None)
                conn.execute("UPDATE subtasks SET position=?, title=?, done=?, done_at=?, outcome=?, updated_at=? WHERE id=?",
                             (pos, title, done, done_at, outcome, now, sid))
                keep.add(sid)
            else:
                conn.execute("INSERT INTO subtasks (task_id, position, title, done, done_at, outcome, created_at, updated_at) "
                             "VALUES (?,?,?,?,?,?,?,?)", (task["id"], pos, title, done, now if done else None, outcome, now, now))
        for sid in existing:
            if sid not in keep:
                conn.execute("DELETE FROM subtasks WHERE id = ?", (sid,))
    return list_subtasks(conn, task["id"])


def task_history(conn, task_id, ctx=LOCAL):
    get_item(conn, "tasks", task_id, ctx)
    return [dict(r) for r in conn.execute(
        """SELECT l.*, u.name AS user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
           WHERE l.resource = 'tasks' AND l.item_id = ? ORDER BY l.at DESC, l.id DESC LIMIT 100""", (task_id,))]


# ---------------------------------------------------------------- scadenze, attese, inbox, checklist

def complete_deadline(conn, deadline_id, done_date: date, ctx=LOCAL):
    with transaction(conn):
        d = get_item(conn, "deadlines", deadline_id, ctx)
        if d["status"] != "attiva":
            raise ValidationError("La scadenza non è attiva")
        conn.execute("UPDATE deadlines SET status = 'fatta', done_date = ?, updated_at = ? WHERE id = ?",
                     (done_date.isoformat(), now_iso(), d["id"]))
        log(conn, ctx, "deadlines", d["id"], "chiuso", d["title"], d["customer_id"], f"Fatta il {done_date.isoformat()}")
        nxt = None
        if d["recurrence_unit"] != "nessuna":
            new = {k: d[k] for k in ("title", "customer_id", "category", "recurrence_unit", "recurrence_every",
                                     "notice_days", "notes", "visibility")}
            new.update(due_date=add_interval(done_date, d["recurrence_unit"], d["recurrence_every"]).isoformat(),
                       status="attiva", previous_id=d["id"], owner_id=ctx.user_id, created_at=now_iso(), updated_at=now_iso())
            nid = crud._insert(conn, "deadlines", new)
            log(conn, ctx, "deadlines", nid, "creato", d["title"], d["customer_id"], "Scadenza successiva")
            nxt = get_item(conn, "deadlines", nid)
    return {"done": get_item(conn, "deadlines", d["id"]), "next": nxt}


def follow_up(conn, waiting_id, ctx=LOCAL):
    """Registra un sollecito e sposta il prossimo di 3 giorni lavorativi."""
    with transaction(conn):
        w = get_item(conn, "waiting_items", waiting_id, ctx)
        d = date.today()
        for _ in range(3):
            d = crud.next_workday(d)
        conn.execute("UPDATE waiting_items SET follow_up_on = ?, follow_ups = follow_ups + 1, updated_at = ? WHERE id = ?",
                     (d.isoformat(), now_iso(), w["id"]))
        log(conn, ctx, "waiting_items", w["id"], "sollecito", w["title"], w["customer_id"], f"Prossimo sollecito {d.isoformat()}")
    return get_item(conn, "waiting_items", w["id"])


INBOX_TARGETS = ("tasks", "changes", "waiting_items", "sticky_notes", "events")


def convert_inbox(conn, item_id, target, ctx=LOCAL):
    if target not in INBOX_TARGETS + ("archivia",):
        raise ValidationError("Destinazione non valida")
    with transaction(conn):
        note = get_item(conn, "inbox_items", item_id, ctx)
        if note["processed_at"]:
            raise ValidationError("Nota già smistata")
        created = None
        if target != "archivia":
            first, _, rest = note["text"].strip().partition("\n")
            title = first.strip()[:300] or "Nota"
            data = {
                "tasks": {"title": title, "notes": rest.strip()},
                "changes": {"title": title, "notes": rest.strip()},
                "waiting_items": {"title": title, "notes": rest.strip()},
                "sticky_notes": {"title": title, "body": rest.strip()},
                "events": {"title": title, "notes": rest.strip(), "start": datetime.now().strftime("%Y-%m-%dT09:00")},
            }[target]
            created = crud.create_item(conn, target, data, ctx)
        conn.execute("UPDATE inbox_items SET processed_at = ?, converted_type = ?, converted_id = ?, updated_at = ? WHERE id = ?",
                     (now_iso(), None if target == "archivia" else target, created["id"] if created else None, now_iso(), note["id"]))
    return {"type": target, "item": created}


def start_checklist(conn, template_id, customer_id=None, change_id=None, ctx=LOCAL):
    with transaction(conn):
        tpl = get_item(conn, "checklist_templates", template_id)
        steps = [{"text": s, "done": False, "done_at": None} for s in tpl["steps"]]
        rec = {"template_id": tpl["id"], "name": tpl["name"], "steps": json.dumps(steps, ensure_ascii=False),
               "started_at": now_iso(), "owner_id": ctx.user_id, "created_at": now_iso(), "updated_at": now_iso(),
               "customer_id": crud._clean(conn, R["checklist_runs"], "customer_id", customer_id),
               "change_id": crud._clean(conn, R["checklist_runs"], "change_id", change_id)}
        rid = crud._insert(conn, "checklist_runs", rec)
        log(conn, ctx, "checklist_runs", rid, "creato", tpl["name"], rec["customer_id"])
    return get_item(conn, "checklist_runs", rid)


def set_checklist_step(conn, run_id, index, done, ctx=LOCAL):
    with transaction(conn):
        run = get_item(conn, "checklist_runs", run_id)
        steps = run["steps"]
        if not 0 <= index < len(steps):
            raise ValidationError("Passo inesistente")
        steps[index]["done"] = bool(done)
        steps[index]["done_at"] = now_iso() if done else None
        completed = now_iso() if all(s["done"] for s in steps) else None
        conn.execute("UPDATE checklist_runs SET steps = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                     (json.dumps(steps, ensure_ascii=False), completed, now_iso(), run["id"]))
        if completed and not run["completed_at"]:
            log(conn, ctx, "checklist_runs", run["id"], "chiuso", run["name"], run["customer_id"], "Checklist completata")
    return get_item(conn, "checklist_runs", run["id"])


# ---------------------------------------------------------------- verbali: azioni e serie

def set_actions(conn, meeting_id, actions, ctx=LOCAL):
    """Le azioni del verbale sono task collegati: si creano, aggiornano o tolgono insieme."""
    meeting = get_item(conn, "meetings", meeting_id, ctx)
    if not isinstance(actions, list) or len(actions) > 200:
        raise ValidationError("Azioni: elenco non valido")
    customer = meeting["customer_id"]
    with transaction(conn):
        existing = {r[0] for r in conn.execute("SELECT id FROM tasks WHERE meeting_id = ?", (meeting["id"],))}
        keep = set()
        for a in actions:
            if not isinstance(a, dict) or not str(a.get("title") or "").strip():
                continue
            data = {"title": a["title"], "due_date": a.get("due_date") or None, "assignee_id": a.get("assignee_id") or None,
                    "status": a.get("status") or "da_fare", "notes": a.get("notes") or ""}
            if a.get("id") in existing:
                crud.update_item(conn, "tasks", a["id"], data, ctx)
                keep.add(a["id"])
            else:
                data.update(meeting_id=meeting["id"], project_id=meeting["project_id"], customer_id=customer,
                            visibility=meeting["visibility"])
                keep.add(crud.create_item(conn, "tasks", data, ctx)["id"])
        for tid in existing - keep:
            crud.delete_item(conn, "tasks", tid, ctx)
    return list_items(conn, "tasks", {"meeting_id": meeting["id"]}, ctx)


def carried_actions(conn, meeting_id, ctx=LOCAL):
    """Azioni ancora aperte delle riunioni precedenti della stessa serie."""
    m = get_item(conn, "meetings", meeting_id, ctx)
    if not m["series"]:
        return []
    prev = [r[0] for r in conn.execute(
        "SELECT id FROM meetings WHERE series = ? AND id != ? AND (date < ? OR (date = ? AND id < ?) OR ? IS NULL)",
        (m["series"], m["id"], m["date"], m["date"], m["id"], m["date"]))]
    if not prev:
        return []
    out = []
    for tid in prev:
        out += [t for t in list_items(conn, "tasks", {"meeting_id": tid, "open": "1"}, ctx)]
    return out


def series_list(conn):
    return [r[0] for r in conn.execute("SELECT DISTINCT series FROM meetings WHERE series != '' ORDER BY casefold(series)")]


# ---------------------------------------------------------------- consulenze

def _consultation_task_fields(conn, data, consultant):
    title = str(data.get("title") or "").strip() or f"Consulenza {consultant['name'] if consultant else ''}".strip()
    start = parse_date(data.get("date_start"), "Data")
    end = parse_date(data.get("date_end"), "Fino al") or start
    return {"title": title[:300], "start_date": start, "due_date": end, "planned_for": start,
            "project_id": data.get("project_id") or None, "customer_id": data.get("customer_id") or None,
            "notes": data.get("notes") or ""}


def create_consultation(conn, data, ctx=LOCAL):
    if not isinstance(data, dict):
        raise ValidationError("Dati non validi")
    with transaction(conn):
        rec = crud.validate(conn, R["consultations"], data, partial=False)
        consultant = get_item(conn, "contacts", rec["consultant_id"]) if rec.get("consultant_id") else None
        if not consultant:
            raise ValidationError("Consulente: campo obbligatorio")
        if rec.get("date_end") and rec["date_end"] < rec["date_start"]:
            raise ValidationError("La fine non può essere prima dell'inizio")
        task = crud.create_item(conn, "tasks", {**_consultation_task_fields(conn, {**data, **rec}, consultant)}, ctx)
        conn.execute("UPDATE tasks SET kind = 'consulenza' WHERE id = ?", (task["id"],))
        rec.update(task_id=task["id"], created_at=now_iso(), updated_at=now_iso())
        rec.setdefault("status", "pianificata")
        cid = crud._insert(conn, "consultations", rec)
        if isinstance(data.get("activities"), list):
            set_subtasks(conn, task["id"], data["activities"], ctx)
    return get_item(conn, "consultations", cid)


def update_consultation(conn, cid, data, ctx=LOCAL):
    with transaction(conn):
        cons = get_item(conn, "consultations", cid)
        rec = crud.validate(conn, R["consultations"], data, partial=True)
        merged = {**cons, **rec, **{k: data[k] for k in ("title", "project_id", "notes") if k in data}}
        if merged.get("date_end") and merged["date_end"] < merged["date_start"]:
            raise ValidationError("La fine non può essere prima dell'inizio")
        rec["updated_at"] = now_iso()
        crud._update(conn, "consultations", cons["id"], rec)
        consultant = get_item(conn, "contacts", merged["consultant_id"]) if merged.get("consultant_id") else None
        fields = _consultation_task_fields(conn, merged, consultant)
        crud.update_item(conn, "tasks", cons["task_id"], fields, ctx)
        if isinstance(data.get("activities"), list):
            set_subtasks(conn, cons["task_id"], data["activities"], ctx)
    return get_item(conn, "consultations", cons["id"])


def close_consultation(conn, cid, note, ctx=LOCAL):
    with transaction(conn):
        cons = get_item(conn, "consultations", cid)
        conn.execute("UPDATE consultations SET status = 'chiusa', closing_note = ?, closed_at = ?, updated_at = ? WHERE id = ?",
                     (str(note or cons["closing_note"] or "")[:20000], now_iso(), now_iso(), cons["id"]))
        crud.update_item(conn, "tasks", cons["task_id"], {"status": "chiuso"}, ctx)
    return get_item(conn, "consultations", cons["id"])


def reopen_consultation(conn, cid, ctx=LOCAL):
    with transaction(conn):
        cons = get_item(conn, "consultations", cid)
        crud.update_item(conn, "tasks", cons["task_id"], {"status": "in_corso"}, ctx)
        conn.execute("UPDATE consultations SET status = 'in_corso', closed_at = NULL, updated_at = ? WHERE id = ?",
                     (now_iso(), cons["id"]))
    return get_item(conn, "consultations", cons["id"])


def duplicate_consultation(conn, cid, new_start=None, ctx=LOCAL):
    cons = get_item(conn, "consultations", cid)
    start = date.fromisoformat(cons["date_start"])
    target = new_start or start + timedelta(days=7)
    days = (date.fromisoformat(cons["date_end"]) - start).days if cons["date_end"] else 0
    open_acts = [{"title": s["title"]} for s in list_subtasks(conn, cons["task_id"]) if not s["done"]]
    return create_consultation(conn, {
        "consultant_id": cons["consultant_id"], "customer_id": cons["customer_id"], "location": cons["location"],
        "date_start": target.isoformat(), "date_end": (target + timedelta(days=days)).isoformat() if days else None,
        "title": cons["title"], "project_id": cons["project_id"], "activities": open_acts,
    }, ctx)


def delete_consultation(conn, cid, ctx=LOCAL):
    cons = get_item(conn, "consultations", cid)
    crud.delete_item(conn, "tasks", cons["task_id"], ctx)


# ---------------------------------------------------------------- pianificazione della giornata

def _my_tasks_clause(ctx):
    if not ctx.team:
        return "1=1", []
    return "(t.assignee_id = ? OR (t.assignee_id IS NULL AND t.owner_id = ?))", [ctx.user_id, ctx.user_id]


def _tasks(conn, where, params, ctx, order=None):
    mine, mp = _my_tasks_clause(ctx)
    sql = f"{R['tasks'].select} WHERE {mine} AND {where} ORDER BY {order or R['tasks'].order}"
    return [crud.row_dict(R["tasks"], r) for r in conn.execute(sql, mp + list(params))]


def _minutes_between(a, b):
    try:
        return max(0, int((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() // 60))
    except (TypeError, ValueError):
        return 0


def plan_day(conn, day: date, ctx=LOCAL):
    d = day.isoformat()
    week = (day + timedelta(days=7)).isoformat()
    settings = get_settings(conn)
    plan = _tasks(conn, "t.planned_for = ?", [d], ctx, "t.status = 'chiuso', t.plan_order, t.id")
    planned_ids = {t["id"] for t in plan}
    later = lambda items: [t for t in items if t["id"] not in planned_ids]
    backlog = [
        {"key": "overdue", "title": "In ritardo",
         "items": later(_tasks(conn, "t.status != 'chiuso' AND t.due_date < ? AND (t.planned_for IS NULL OR t.planned_for < ?)", [d, d], ctx))},
        {"key": "week", "title": "Scadono entro 7 giorni",
         "items": later(_tasks(conn, "t.status != 'chiuso' AND t.due_date >= ? AND t.due_date <= ? AND (t.planned_for IS NULL OR t.planned_for < ?)", [d, week, d], ctx))},
        {"key": "progress", "title": "In corso",
         "items": later(_tasks(conn, "t.status = 'in_corso' AND (t.due_date IS NULL OR t.due_date > ?) AND (t.planned_for IS NULL OR t.planned_for < ?)", [week, d], ctx))},
        {"key": "nodate", "title": "Senza data",
         "items": later(_tasks(conn, "t.status IN ('da_fare', 'in_attesa') AND t.due_date IS NULL AND t.planned_for IS NULL", [], ctx, "t.priority = 'alta' DESC, t.created_at DESC"))[:25]},
    ]
    events = list_items(conn, "events", {"from": d, "to": d}, ctx)
    consultations = list_items(conn, "consultations", {"from": d, "to": d}, ctx)
    changes = [c for c in list_items(conn, "changes", {"from": d, "to": d}, ctx) if c["outcome"] == "pianificata"]
    busy = sum(_minutes_between(e["start"], e["end"]) for e in events if not e["all_day"] and e.get("end"))
    available = max(0, int(settings["work_hours"] * 60) - busy)
    planned = sum((t["estimate_min"] or 0) for t in plan if t["status"] != "chiuso")
    done = sum((t["estimate_min"] or 0) for t in plan if t["status"] == "chiuso")
    logged = conn.execute("SELECT COALESCE(SUM(minutes), 0) FROM time_entries WHERE date = ? AND user_id = ?",
                          (d, ctx.user_id)).fetchone()[0]
    inbox = list_items(conn, "inbox_items", {"processed": "0", "limit": 20}, ctx)
    return {
        "date": d, "plan": plan, "backlog": backlog, "inbox": inbox,
        "events": events, "consultations": consultations, "changes": changes,
        "capacity": {"work_min": int(settings["work_hours"] * 60), "meetings_min": busy, "available_min": available,
                     "planned_min": planned, "done_min": done, "logged_min": logged},
        "day_start": settings["day_start"], "day_end": settings["day_end"],
    }


def set_plan(conn, day: date, ids, ctx=LOCAL):
    """Mette i task nel piano del giorno nell'ordine indicato."""
    if not isinstance(ids, list) or len(ids) > 300:
        raise ValidationError("Piano non valido")
    with transaction(conn):
        for pos, tid in enumerate(ids):
            task = get_item(conn, "tasks", tid, ctx)
            conn.execute("UPDATE tasks SET planned_for = ?, plan_order = ?, updated_at = ? WHERE id = ?",
                         (day.isoformat(), pos, now_iso(), task["id"]))
    return plan_day(conn, day, ctx)


def unplan(conn, task_id, ctx=LOCAL):
    task = get_item(conn, "tasks", task_id, ctx)
    conn.execute("UPDATE tasks SET planned_for = NULL, plan_time = NULL, updated_at = ? WHERE id = ?", (now_iso(), task["id"]))
    return get_item(conn, "tasks", task["id"])


def close_day(conn, day: date, ctx=LOCAL):
    """Fine giornata: quello che non è stato fatto passa al prossimo giorno lavorativo; restituisce il riepilogo."""
    d = day.isoformat()
    nxt = crud.next_workday(day).isoformat()
    with transaction(conn):
        plan = _tasks(conn, "t.planned_for = ?", [d], ctx, "t.plan_order, t.id")
        done = [t for t in plan if t["status"] == "chiuso"]
        moved = [t for t in plan if t["status"] != "chiuso"]
        for t in moved:
            conn.execute("UPDATE tasks SET planned_for = ?, plan_time = NULL, updated_at = ? WHERE id = ?", (nxt, now_iso(), t["id"]))
        closed_today = _tasks(conn, "t.status = 'chiuso' AND substr(t.closed_at, 1, 10) = ? AND (t.planned_for IS NULL OR t.planned_for != ?)", [d, d], ctx)
        entries = [dict(r) for r in conn.execute(
            """SELECT te.minutes, COALESCE(cu.code, cu.name, 'Senza cliente') AS who FROM time_entries te
               LEFT JOIN customers cu ON cu.id = te.customer_id WHERE te.date = ? AND te.user_id = ?""", (d, ctx.user_id))]
    by_customer = {}
    for e in entries:
        by_customer[e["who"]] = by_customer.get(e["who"], 0) + e["minutes"]
    lines = [f"Riepilogo del {day.strftime('%d/%m/%Y')}", ""]
    if done or closed_today:
        lines.append("Fatto:")
        lines += [f"- {t['title']}" + (f" ({t['customer_code'] or t['customer_name']})" if t.get("customer_name") else "")
                  for t in done + closed_today]
    if moved:
        lines += ["", f"Spostato a {date.fromisoformat(nxt).strftime('%d/%m')}:"]
        lines += [f"- {t['title']}" for t in moved]
    if by_customer:
        lines += ["", "Ore registrate:"]
        lines += [f"- {k}: {fmt_min(v)}" for k, v in sorted(by_customer.items())]
    return {"done": len(done) + len(closed_today), "moved": len(moved), "next_day": nxt,
            "minutes": sum(by_customer.values()), "text": "\n".join(lines)}


def fmt_min(m):
    m = int(m or 0)
    h, mm = divmod(m, 60)
    return f"{h} h {mm:02d}" if h else f"{mm} min"


# ---------------------------------------------------------------- ore (timer e registrazioni)

def running_timer(conn, ctx=LOCAL):
    rows = list_items(conn, "time_entries", {"running": "1"}, crud.Ctx(ctx.user_id, False, True))
    return rows[0] if rows else None


def start_timer(conn, data, ctx=LOCAL):
    data = data if isinstance(data, dict) else {}
    with transaction(conn):
        stop_timer(conn, ctx, quiet=True)
        task_id = as_int(data.get("task_id"), "Task")
        if task_id:
            task = get_item(conn, "tasks", task_id, ctx)
            if task["status"] == "da_fare":
                crud.update_item(conn, "tasks", task_id, {"status": "in_corso"}, ctx)
        now = datetime.now().strftime("%Y-%m-%dT%H:%M")
        rec = crud.validate(conn, R["time_entries"], {"task_id": task_id, "customer_id": data.get("customer_id"),
                                                       "note": data.get("note", ""), "date": now[:10]}, partial=False)
        rec = crud._finalize(conn, "time_entries", rec)
        rec.update(started_at=now, user_id=ctx.user_id, minutes=0, created_at=now_iso(), updated_at=now_iso())
        eid = crud._insert(conn, "time_entries", rec)
    return get_item(conn, "time_entries", eid)


def stop_timer(conn, ctx=LOCAL, quiet=False):
    row = conn.execute("SELECT * FROM time_entries WHERE user_id = ? AND started_at IS NOT NULL AND ended_at IS NULL",
                       (ctx.user_id,)).fetchone()
    if not row:
        if quiet:
            return None
        raise ValidationError("Nessun timer in corso")
    now = datetime.now().strftime("%Y-%m-%dT%H:%M")
    minutes = max(1, _minutes_between(row["started_at"], now))
    conn.execute("UPDATE time_entries SET ended_at = ?, minutes = ?, updated_at = ? WHERE id = ?",
                 (now, minutes, now_iso(), row["id"]))
    return get_item(conn, "time_entries", row["id"])


def time_summary(conn, start: date, end: date, ctx=LOCAL, user="me"):
    where, params = ["te.date >= ?", "te.date <= ?"], [start.isoformat(), end.isoformat()]
    if not (ctx.is_admin and user == "all"):
        where.append("te.user_id = ?")
        params.append(ctx.user_id)
    rows = [dict(r) for r in conn.execute(
        f"""SELECT te.*, t.title AS task_title, cu.name AS customer_name, cu.code AS customer_code,
            p.name AS project_name, u.name AS user_name
            FROM time_entries te LEFT JOIN tasks t ON t.id = te.task_id LEFT JOIN customers cu ON cu.id = te.customer_id
            LEFT JOIN projects p ON p.id = te.project_id LEFT JOIN users u ON u.id = te.user_id
            WHERE {' AND '.join(where)} ORDER BY te.date, te.id""", params)]

    def group(key, label):
        out = {}
        for r in rows:
            k = r.get(key)
            g = out.setdefault(k, {"id": k, "label": r.get(label) or "—", "minutes": 0})
            g["minutes"] += r["minutes"]
        return sorted(out.values(), key=lambda g: -g["minutes"])

    days = {}
    for r in rows:
        days[r["date"]] = days.get(r["date"], 0) + r["minutes"]
    contract = {r[0]: r[1] for r in conn.execute("SELECT id, monthly_hours FROM customers WHERE monthly_hours IS NOT NULL")}
    by_customer = group("customer_id", "customer_name")
    for g in by_customer:
        g["contract_hours"] = contract.get(g["id"])
    return {"from": start.isoformat(), "to": end.isoformat(), "total": sum(r["minutes"] for r in rows),
            "entries": rows, "by_customer": by_customer, "by_project": group("project_id", "project_name"),
            "by_task": group("task_id", "task_title"), "by_day": [{"date": k, "minutes": v} for k, v in sorted(days.items())]}


def time_csv(conn, start, end, ctx=LOCAL, user="me"):
    data = time_summary(conn, start, end, ctx, user)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Data", "Utente", "Cliente", "Progetto", "Task", "Minuti", "Ore", "Nota"])
    for r in data["entries"]:
        w.writerow([r["date"], r["user_name"] or "", r["customer_name"] or "", r["project_name"] or "",
                    r["task_title"] or "", r["minutes"], f"{r['minutes'] / 60:.2f}".replace(".", ","), r["note"]])
    return "﻿" + buf.getvalue()


# ---------------------------------------------------------------- modifiche e blocchi

def freeze_conflicts(conn, customer_id, when):
    if not when:
        return []
    day = str(when)[:10]
    return [dict(r) for r in conn.execute(
        """SELECT fz.*, cu.name AS customer_name FROM change_freezes fz LEFT JOIN customers cu ON cu.id = fz.customer_id
           WHERE fz.start_date <= ? AND fz.end_date >= ? AND (fz.customer_id IS NULL OR fz.customer_id = ?)""",
        (day, day, customer_id))]


def change_calendar(conn, start: date, end: date, customer_id=None, ctx=LOCAL):
    f = {"from": start.isoformat(), "to": end.isoformat()}
    if customer_id:
        f["customer_id"] = customer_id
    changes = list_items(conn, "changes", f, ctx)
    freezes = [dict(r) for r in conn.execute(
        """SELECT fz.*, cu.name AS customer_name, cu.code AS customer_code FROM change_freezes fz
           LEFT JOIN customers cu ON cu.id = fz.customer_id
           WHERE fz.start_date <= ? AND fz.end_date >= ? AND (? IS NULL OR fz.customer_id IS NULL OR fz.customer_id = ?)
           ORDER BY fz.start_date""", (end.isoformat(), start.isoformat(), customer_id, customer_id))]
    for c in changes:
        c["freezes"] = [z["title"] for z in freeze_conflicts(conn, c["customer_id"], c["planned_at"])] if c["outcome"] == "pianificata" else []
    return {"from": start.isoformat(), "to": end.isoformat(), "changes": changes, "freezes": freezes}


# ---------------------------------------------------------------- oggi, cliente, riepilogo

def dashboard(conn, today: date, ctx=LOCAL):
    t = today.isoformat()
    week = (today + timedelta(days=7)).isoformat()
    settings = get_settings(conn)
    last = settings["last_backup"]
    try:
        stale = not last or (today - date.fromisoformat(last[:10])).days > 2
    except ValueError:
        stale = True
    plan = _tasks(conn, "t.planned_for = ?", [t], ctx, "t.status = 'chiuso', t.plan_order, t.id")
    mon = today - timedelta(days=today.weekday())
    week_min = conn.execute("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ?",
                            (ctx.user_id, mon.isoformat(), t)).fetchone()[0]
    day_min = conn.execute("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE user_id = ? AND date = ?",
                           (ctx.user_id, t)).fetchone()[0]
    vis_w, vp_w = crud.visibility_clause(R["waiting_items"], ctx)
    vis_d, vp_d = crud.visibility_clause(R["deadlines"], ctx)
    vis_c, vp_c = crud.visibility_clause(R["changes"], ctx)
    and_ = lambda v: f" AND {v}" if v else ""
    return {
        "today": t,
        "overdue": _tasks(conn, "t.status != 'chiuso' AND t.due_date < ?", [t], ctx),
        "due_today": _tasks(conn, "t.status != 'chiuso' AND t.due_date = ?", [t], ctx),
        "due_week": _tasks(conn, "t.status != 'chiuso' AND t.due_date > ? AND t.due_date <= ?", [t, week], ctx),
        "in_progress": _tasks(conn, "t.status = 'in_corso'", [], ctx),
        "plan": plan,
        "events_today": list_items(conn, "events", {"from": t, "to": t}, ctx),
        "consultations_today": list_items(conn, "consultations", {"from": t, "to": t}, ctx),
        "waiting_followup": [crud.row_dict(R["waiting_items"], r) for r in conn.execute(
            R["waiting_items"].select + " WHERE w.status = 'in_attesa' AND w.follow_up_on <= ?" + and_(vis_w)
            + " ORDER BY w.follow_up_on, w.id", [t] + vp_w)],
        "deadlines_due": [crud.row_dict(R["deadlines"], r) for r in conn.execute(
            R["deadlines"].select + " WHERE d.status = 'attiva' AND date(d.due_date, '-' || d.notice_days || ' days') <= ?"
            + and_(vis_d) + " ORDER BY d.due_date, d.id", [t] + vp_d)],
        "changes_upcoming": [crud.row_dict(R["changes"], r) for r in conn.execute(
            R["changes"].select + " WHERE ch.outcome = 'pianificata' AND substr(ch.planned_at,1,10) >= ? AND substr(ch.planned_at,1,10) <= ?"
            + and_(vis_c) + " ORDER BY ch.planned_at, ch.id", [t, week] + vp_c)],
        "recent_meetings": list_items(conn, "meetings", {"status": "attiva", "limit": 5}, ctx),
        "inbox_count": conn.execute("SELECT COUNT(*) FROM inbox_items WHERE processed_at IS NULL AND (? = 0 OR owner_id = ?)",
                                    (1 if ctx.team else 0, ctx.user_id)).fetchone()[0],
        "minutes_today": day_min, "minutes_week": week_min,
        "timer": running_timer(conn, ctx),
        "last_backup": last, "last_backup_error": settings["last_backup_error"], "backup_stale": stale,
    }


def customer_cockpit(conn, cid, today: date, ctx=LOCAL):
    cu = get_item(conn, "customers", cid, ctx)
    c = cu["id"]
    t = today.isoformat()
    month_start = today.replace(day=1)
    tasks = list_items(conn, "tasks", {"customer_id": c, "open": "1"}, ctx)
    waits = list_items(conn, "waiting_items", {"customer_id": c, "status": "in_attesa"}, ctx)
    deadlines = list_items(conn, "deadlines", {"customer_id": c, "status": "attiva"}, ctx)
    mon = today - timedelta(days=today.weekday())
    cal = change_calendar(conn, mon, mon + timedelta(days=13), c, ctx)
    month_changes = list_items(conn, "changes", {"customer_id": c, "from": month_start.isoformat(), "to": t}, ctx)
    feed = [dict(r) for r in conn.execute(
        """SELECT l.*, u.name AS user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
           WHERE l.customer_id = ? ORDER BY l.at DESC, l.id DESC LIMIT 40""", (c,))]
    hours = time_summary(conn, month_start, today, ctx, user="all" if ctx.is_admin else "me")
    entries = [e for e in hours["entries"] if e["customer_id"] == c]
    by_project = {}
    for e in entries:
        k = e["project_name"] or "Senza progetto"
        by_project[k] = by_project.get(k, 0) + e["minutes"]
    upcoming = [e for e in list_items(conn, "events", {"customer_id": c, "from": t, "to": (today + timedelta(days=30)).isoformat()}, ctx)]
    meetings = list_items(conn, "meetings", {"customer_id": c, "limit": 8}, ctx)
    return {
        "customer": cu,
        "kpi": {
            "open_tasks": len(tasks), "overdue": sum(1 for x in tasks if x["due_date"] and x["due_date"] < t),
            "waits": len(waits), "waits_due": sum(1 for w in waits if w["follow_up_on"] and w["follow_up_on"] <= t),
            "deadlines_30": sum(1 for d in deadlines if d["due_date"] <= (today + timedelta(days=30)).isoformat()),
            "next_deadline": deadlines[0] if deadlines else None,
            "changes_month": len(month_changes),
            "changes_bad": sum(1 for x in month_changes if x["outcome"] in ("fallita", "rollback")),
            "minutes_month": sum(e["minutes"] for e in entries), "contract_hours": cu["monthly_hours"],
            "next_event": upcoming[0] if upcoming else None,
        },
        "tasks": tasks[:30], "waits": waits, "deadlines": deadlines, "calendar": cal, "feed": feed,
        "hours_by_project": [{"label": k, "minutes": v} for k, v in sorted(by_project.items(), key=lambda kv: -kv[1])],
        "projects": list_items(conn, "projects", {"customer_id": c}, ctx),
        "contacts": list_items(conn, "contacts", {"customer_id": c}, ctx),
        "meetings": meetings, "events": upcoming,
        "consultations": list_items(conn, "consultations", {"customer_id": c, "limit": 10}, ctx),
        "notes": list_items(conn, "sticky_notes", {"customer_id": c}, ctx),
    }


def _it(d):
    return date.fromisoformat(d[:10]).strftime("%d/%m") if d else ""


def weekly_report(conn, start: date, end: date, customer_id=None, ctx=LOCAL):
    s, e = start.isoformat(), end.isoformat()
    f = {"customer_id": customer_id} if customer_id else {}
    changes = list_items(conn, "changes", {**f, "from": s, "to": e}, ctx)
    closed = [t for t in list_items(conn, "tasks", {**f, "status": "chiuso"}, ctx) if s <= (t["closed_at"] or "")[:10] <= e]
    waits = list_items(conn, "waiting_items", {**f, "status": "in_attesa"}, ctx)
    deadlines = list_items(conn, "deadlines", {**f, "status": "attiva", "from": s,
                                               "to": (end + timedelta(days=30)).isoformat()}, ctx)
    meetings = list_items(conn, "meetings", {**f, "from": s, "to": e}, ctx)
    consultations = list_items(conn, "consultations", {**f, "from": s, "to": e}, ctx)
    hours = time_summary(conn, start, end, ctx, user="all" if ctx.is_admin else "me")
    minutes = sum(x["minutes"] for x in hours["entries"] if not customer_id or x["customer_id"] == int(customer_id))
    r = {"from": s, "to": e, "changes": changes, "closed_tasks": closed, "waits": waits, "deadlines": deadlines,
         "meetings": meetings, "consultations": consultations, "minutes": minutes}
    name = get_item(conn, "customers", customer_id)["name"] if customer_id else ""
    lines = [f"Riepilogo {_it(s)} – {_it(e)}" + (f" · {name}" if name else ""), ""]

    def section(title, items, fmt):
        if items:
            lines.append(f"{title}:")
            lines.extend(f"- {fmt(x)}" for x in items)
            lines.append("")

    section("Modifiche", changes, lambda c: f"{c['title']} ({ENUM_LABELS.get(c['outcome'], c['outcome'])}"
            + (f", {_it(c['executed_at'] or c['planned_at'])}" if (c['executed_at'] or c['planned_at']) else "") + ")")
    section("Attività completate", closed, lambda t: t["title"])
    section("Giornate di consulenza", consultations, lambda c: f"{_it(c['date_start'])} {c['consultant_name'] or ''} — "
            f"{c['activities_done']}/{c['activities_total']} attività")
    section("Riunioni", meetings, lambda m: f"{_it(m['date'])} {m['title']}")
    section("In attesa di", waits, lambda w: f"{w['title']}" + (f" ({w['contact_name'] or w['who']})" if (w['contact_name'] or w['who']) else ""))
    section("Scadenze in arrivo", deadlines, lambda d: f"{_it(d['due_date'])} {d['title']}")
    if minutes:
        lines.append(f"Ore registrate: {fmt_min(minutes)}")
    r["text"] = "\n".join(lines).strip()
    return r


# ---------------------------------------------------------------- ricerca e promemoria

def search(conn, q, ctx=LOCAL, limit=8):
    q = (q or "").strip()
    out = {}
    if len(q) < 2:
        return out
    pattern = crud.like(q)
    for name, res in R.items():
        if not res.search or name in ("users",):
            continue
        cols = res.search
        cond = " OR ".join(f"casefold({res.alias}.{c}) LIKE ? ESCAPE '\\'" for c in cols)
        params = [pattern] * len(cols)
        if name == "tasks":
            cond += " OR EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id = t.id AND (casefold(s.title) LIKE ? ESCAPE '\\' OR casefold(s.outcome) LIKE ? ESCAPE '\\'))"
            params += [pattern, pattern]
        if name == "consultations":
            cond += " OR casefold(co.name) LIKE ? ESCAPE '\\' OR casefold(t.title) LIKE ? ESCAPE '\\'"
            params += [pattern, pattern]
        sql = f"{res.select} WHERE ({cond})"
        vis, vp = crud.visibility_clause(res, ctx)
        if vis:
            sql += f" AND {vis}"
            params += vp
        sql += f" ORDER BY {res.alias}.id DESC LIMIT {int(limit)}"
        rows = [crud.row_dict(res, r) for r in conn.execute(sql, params)]
        if rows:
            out[name] = rows
    att = [dict(r) for r in conn.execute(
        "SELECT id, entity_type, entity_id, kind, name, url, created_at FROM attachments WHERE casefold(name) LIKE ? ESCAPE '\\' "
        "ORDER BY id DESC LIMIT ?", (pattern, limit))]
    if att:
        out["attachments"] = att
    return out


def reminders(conn, now: datetime, ctx=LOCAL):
    """Promemoria per le notifiche del browser (l'interfaccia evita i doppioni)."""
    t = now.date().isoformat()
    soon = (now + timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M")
    cur = now.strftime("%Y-%m-%dT%H:%M")
    out = []
    for e in list_items(conn, "events", {"from": t, "to": t}, ctx):
        if not e["all_day"] and cur <= e["start"] <= soon:
            out.append({"key": f"ev-{e['id']}-{e['start']}", "title": f"Tra poco: {e['title']}",
                        "body": f"Alle {e['start'][11:16]}" + (f" · {e['location']}" if e["location"] else ""), "href": "#/calendario"})
    dash = dashboard(conn, now.date(), ctx)
    for w in dash["waiting_followup"]:
        out.append({"key": f"w-{w['id']}-{t}", "title": "Da sollecitare", "body": w["title"], "href": "#/attese"})
    for d in dash["deadlines_due"]:
        out.append({"key": f"d-{d['id']}-{t}", "title": "Scadenza in arrivo",
                    "body": f"{d['title']} · {_it(d['due_date'])}", "href": "#/scadenze"})
    n = len(dash["overdue"])
    if n:
        out.append({"key": f"late-{t}", "title": "Task in ritardo", "body": f"{n} task oltre la scadenza", "href": "#/oggi"})
    return out
