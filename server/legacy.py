"""Import dei dati da Activity Desk (il database della vecchia app, letto in sola lettura).

Cosa cambia nel passaggio:
- gli incidenti non esistono più: i task collegati a un incidente prendono il suo cliente;
- i task ricevono il cliente del progetto (ora il cliente si può indicare anche senza progetto);
- le note dell'Inbox convertite in incidenti restano come note già smistate;
- i file allegati vengono copiati dalla cartella "allegati" della vecchia app.
"""
import shutil
import sqlite3
from pathlib import Path

from . import attachments, crud
from .crud import ValidationError, now_iso

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATHS = (ROOT.parent / "activity_desk" / "data" / "activity_desk.db",)
DATA_TABLES = ("customers", "contacts", "projects", "events", "meetings", "tasks", "subtasks", "consultations",
               "changes", "deadlines", "waiting_items", "inbox_items", "checklist_templates", "checklist_runs",
               "sticky_notes", "time_entries", "change_freezes")


def find_default():
    for p in DEFAULT_PATHS:
        if p.is_file():
            return str(p)
    return ""


def has_data(conn) -> bool:
    return any(conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone() for t in DATA_TABLES)


def _rows(src, table):
    if not src.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone():
        return []
    return [dict(r) for r in src.execute(f"SELECT * FROM {table} ORDER BY id" if table != "service_manager_customers"
                                         else f"SELECT * FROM {table}")]


def _pick(row, cols, **extra):
    out = {c: row[c] for c in cols if c in row}
    out.update(extra)
    return out


def import_legacy(conn, path, replace=False, user_id=1) -> dict:
    path = Path(str(path or "").strip().strip('"'))
    if not path.is_file():
        raise ValidationError(f"Database di Activity Desk non trovato: {path}")
    if has_data(conn) and not replace:
        raise ValidationError("Plancia contiene già dei dati: conferma la sostituzione per importare")
    try:
        src = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error as e:
        raise ValidationError(f"Database non leggibile: {e}")
    src.row_factory = sqlite3.Row
    try:
        if not src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").fetchone():
            raise ValidationError("Il file non sembra un database di Activity Desk")
        return _copy(conn, src, path, user_id)
    except sqlite3.DatabaseError as e:
        raise ValidationError(f"Database non leggibile: {e}")
    finally:
        src.close()


def _copy(conn, src, path, uid):
    counts = {}
    incidents = {r["id"]: r for r in _rows(src, "incidents")}
    projects_customer = {r["id"]: r.get("customer_id") for r in _rows(src, "projects")}
    ins = lambda table, rec: crud._insert(conn, table, rec)
    with crud.transaction(conn):
        conn.execute("PRAGMA defer_foreign_keys = ON")
        for t in ("attachments", "activity_log", "service_manager_customers", "time_entries", "checklist_runs",
                  "checklist_templates", "sticky_notes", "inbox_items", "waiting_items", "deadlines", "change_freezes",
                  "changes", "consultations", "subtasks", "tasks", "meetings", "events", "projects", "contacts", "customers"):
            conn.execute(f"DELETE FROM {t}")

        def copy(table, cols, transform=None):
            n = 0
            for r in _rows(src, table):
                rec = _pick(r, ("id", "created_at", "updated_at", *cols))
                rec.setdefault("created_at", now_iso())
                rec.setdefault("updated_at", rec["created_at"])
                if transform:
                    rec = transform(r, rec)
                    if rec is None:
                        continue
                ins(table, rec)
                n += 1
            counts[table] = n

        copy("customers", ("name", "code", "notes", "active"))
        copy("contacts", ("name", "company", "customer_id", "role", "email", "phone", "notes", "is_consultant",
                          "is_service_manager"))
        copy("projects", ("name", "description", "status", "color", "customer_id"),
             lambda r, rec: {**rec, "owner_id": uid, "visibility": "team"})
        copy("events", ("title", "start", "end", "all_day", "location", "notes", "project_id"),
             lambda r, rec: {**rec, "end": rec.get("end") or rec["start"], "owner_id": uid, "visibility": "team"})
        copy("meetings", ("title", "date", "project_id", "customer_id", "event_id", "attendees", "agenda", "discussion",
                          "decisions", "next_meeting"),
             lambda r, rec: {**rec, "date": rec.get("date") or None, "owner_id": uid, "visibility": "team"})

        def task(r, rec):
            customer = None
            inc = incidents.get(r.get("incident_id"))
            if inc:
                customer = inc.get("customer_id")
                note = f"Dall'incidente «{inc['title']}»"
                rec["notes"] = f"{note}\n\n{rec.get('notes') or ''}".strip()
            if not customer and r.get("project_id"):
                customer = None  # il cliente del progetto si eredita già: non lo si duplica
            rec.update(customer_id=customer, owner_id=uid, visibility="team",
                       kind="consulenza" if src.execute("SELECT 1 FROM sqlite_master WHERE name='consultations'").fetchone()
                       and src.execute("SELECT 1 FROM consultations WHERE task_id = ?", (r["id"],)).fetchone() else "task")
            return rec
        copy("tasks", ("title", "notes", "project_id", "priority", "start_date", "due_date", "status", "closed_at",
                       "meeting_id"), task)
        copy("subtasks", ("task_id", "position", "title", "done", "done_at", "outcome"))
        copy("consultations", ("task_id", "consultant_id", "customer_id", "date_start", "date_end", "location", "status",
                               "closing_note", "closed_at"))
        copy("changes", ("title", "customer_id", "system", "kind", "planned_at", "executed_at", "reason", "rollback_plan",
                         "outcome", "notes"),
             lambda r, rec: {**rec, "owner_id": uid, "visibility": "team"})
        copy("deadlines", ("title", "customer_id", "category", "due_date", "recurrence_unit", "recurrence_every",
                           "notice_days", "status", "done_date", "previous_id", "notes"),
             lambda r, rec: {**rec, "owner_id": uid, "visibility": "team"})
        copy("waiting_items", ("title", "contact_id", "who", "customer_id", "ticket_ref", "requested_on", "follow_up_on",
                               "status", "closed_at", "notes"),
             lambda r, rec: {**rec, "owner_id": uid, "visibility": "team"})

        def inbox(r, rec):
            if rec.get("converted_type") == "incidents":
                rec["converted_type"], rec["converted_id"] = None, None
            return {**rec, "owner_id": uid}
        copy("inbox_items", ("text", "processed_at", "converted_type", "converted_id"), inbox)
        copy("checklist_templates", ("name", "description", "steps"))
        copy("checklist_runs", ("template_id", "name", "customer_id", "change_id", "steps", "started_at", "completed_at",
                                "notes"), lambda r, rec: {**rec, "owner_id": uid})
        copy("sticky_notes", ("title", "body", "command", "color", "pinned", "position", "project_id", "customer_id"),
             lambda r, rec: {**rec, "owner_id": uid, "visibility": "privato"})
        n = 0
        for r in _rows(src, "service_manager_customers"):
            conn.execute("INSERT OR IGNORE INTO service_manager_customers (contact_id, customer_id) VALUES (?, ?)",
                         (r["contact_id"], r["customer_id"]))
            n += 1
        counts["service_manager_customers"] = n

        # allegati: solo quelli di elementi che esistono ancora (niente incidenti)
        old_dir = path.parent / "allegati"
        new_dir = attachments.files_dir(conn)
        copied = missing = n = 0
        for r in _rows(src, "attachments"):
            if r["entity_type"] not in attachments.ATTACHMENT_TYPES:
                continue
            if not conn.execute(f"SELECT 1 FROM {r['entity_type']} WHERE id = ?", (r["entity_id"],)).fetchone():
                continue
            rec = _pick(r, ("entity_type", "entity_id", "kind", "name", "url", "stored_name", "mime", "size", "created_at"))
            if r["kind"] == "file":
                stored = r.get("stored_name")
                if not attachments.STORED_RE.fullmatch(stored or ""):
                    continue
                source = old_dir / stored
                if source.is_file():
                    (new_dir / stored).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, new_dir / stored)
                    copied += 1
                else:
                    missing += 1
            ins("attachments", rec)
            n += 1
        counts["attachments"] = n
        counts["files_copied"] = copied
        counts["files_missing"] = missing
        counts["incidents_skipped"] = len(incidents)
        bad = conn.execute("PRAGMA foreign_key_check").fetchall()
        if bad:
            raise ValidationError(f"Import non riuscito: riferimenti mancanti ({bad[0][0]})")
        crud.log(conn, crud.Ctx(uid), "settings", 0, "import", "Import da Activity Desk", None,
                 ", ".join(f"{k}: {v}" for k, v in counts.items() if v))
    return counts
