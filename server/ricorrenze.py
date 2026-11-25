"""Appuntamenti ricorrenti.

Ogni ripetizione è un appuntamento vero (compare in Oggi, Pianifica, Calendario e nelle notifiche);
le ripetizioni sono legate dallo stesso `recurrence_group`. Le modifiche valgono per un solo
appuntamento oppure per «questo e i successivi».
"""
import secrets
from datetime import date, datetime, timedelta

from . import crud
from .crud import ValidationError, add_interval, now_iso, transaction

MAX_OCCURRENCES = 105        # due anni di appuntamenti settimanali
COPY = ("title", "all_day", "location", "notes", "project_id", "customer_id", "owner_id", "visibility",
        "recurrence_unit", "recurrence_every", "recurrence_until", "recurrence_group", "series")
SHARED = ("title", "all_day", "location", "notes", "project_id", "customer_id", "visibility", "series")
RULE = ("recurrence_unit", "recurrence_every", "recurrence_until")


def _dt(value):
    return datetime.fromisoformat(value) if len(value) > 10 else datetime.combine(date.fromisoformat(value), datetime.min.time())


def _fmt(dt, like):
    return dt.date().isoformat() if len(like) <= 10 else dt.strftime("%Y-%m-%dT%H:%M")


def _row(conn, event_id):
    row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if row is None:
        raise crud.NotFound("Appuntamento non trovato")
    return dict(row)


def _check_rule(ev):
    if ev.get("recurrence_unit", "nessuna") == "nessuna":
        return
    until = ev.get("recurrence_until")
    if until and until < ev["start"][:10]:
        raise ValidationError("«Fino al» non può essere prima dell'appuntamento")


def expand(conn, event_id, skip_dates=()):
    """Crea le ripetizioni successive all'appuntamento indicato (che diventa il primo del gruppo)."""
    ev = _row(conn, event_id)
    if ev.get("recurrence_unit", "nessuna") == "nessuna":
        return 0
    _check_rule(ev)
    first = _dt(ev["start"])
    length = _dt(ev["end"]) - first if ev.get("end") else timedelta(0)
    until = date.fromisoformat(ev["recurrence_until"]) if ev.get("recurrence_until") else add_interval(first.date(), "anni", 1)
    group = ev.get("recurrence_group") or secrets.token_hex(8)
    conn.execute("UPDATE events SET recurrence_group = ?, recurrence_until = ? WHERE id = ?", (group, until.isoformat(), ev["id"]))
    now = now_iso()
    made = 0
    for k in range(1, MAX_OCCURRENCES):
        day = add_interval(first.date(), ev["recurrence_unit"], ev["recurrence_every"] * k)
        if day > until:
            break
        if day.isoformat() in skip_dates:
            continue
        start = datetime.combine(day, first.time())
        rec = {c: ev.get(c) for c in COPY}
        rec.update(recurrence_group=group, recurrence_until=until.isoformat(), start=_fmt(start, ev["start"]),
                   end=_fmt(start + length, ev["end"]) if ev.get("end") else None, created_at=now, updated_at=now)
        crud._insert(conn, "events", rec)
        made += 1
    return made


def _following(conn, ev, include_self=True):
    if not ev.get("recurrence_group"):
        return [ev] if include_self else []
    rows = conn.execute("SELECT * FROM events WHERE recurrence_group = ? AND (start > ? OR (start = ? AND id >= ?)) ORDER BY start, id",
                        (ev["recurrence_group"], ev["start"], ev["start"], ev["id"])).fetchall()
    out = [dict(r) for r in rows]
    return out if include_self else [r for r in out if r["id"] != ev["id"]]


def _with_meeting(conn, ids):
    if not ids:
        return set()
    q = ",".join("?" * len(ids))
    return {r[0] for r in conn.execute(f"SELECT DISTINCT event_id FROM meetings WHERE event_id IN ({q})", list(ids))}


def update(conn, event_id, data, scope="this", ctx=crud.LOCAL):
    """Modifica un appuntamento ricorrente: scope "this" (solo questo) o "following" (questo e i successivi)."""
    if scope not in ("this", "following"):
        raise ValidationError("Ambito non valido")
    res = crud.check("events")
    with transaction(conn):
        crud.get_item(conn, "events", event_id, ctx)  # visibilità
        old = _row(conn, event_id)
        crud.can_write(conn, res, old, ctx)
        clean = crud.validate(conn, res, data, partial=True)
        rule_changed = any(k in clean and clean[k] != old.get(k) for k in RULE)
        day_changed = "start" in clean and clean["start"][:10] != old["start"][:10]
        if scope == "this":
            if rule_changed and old.get("recurrence_group"):
                raise ValidationError("Per cambiare la ripetizione scegli «questo e i successivi»")
            # un appuntamento singolo che diventa ricorrente
            crud.update_item(conn, "events", event_id, data, ctx)
            if rule_changed and not old.get("recurrence_group"):
                expand(conn, event_id)
            return crud.get_item(conn, "events", event_id, ctx)

        following = _following(conn, old, include_self=False)
        if rule_changed or day_changed or not old.get("recurrence_group"):
            # nuova regola: si rifanno le ripetizioni successive, tenendo quelle che hanno già un verbale
            keep = _with_meeting(conn, [f["id"] for f in following])
            for f in following:
                if f["id"] not in keep:
                    conn.execute("DELETE FROM events WHERE id = ?", (f["id"],))
            if old.get("recurrence_group"):
                # le ripetizioni precedenti restano un gruppo a sé, con la vecchia regola fino a ieri
                before = conn.execute("SELECT COUNT(*) FROM events WHERE recurrence_group = ? AND start < ?",
                                      (old["recurrence_group"], old["start"])).fetchone()[0]
                if before:
                    conn.execute("UPDATE events SET recurrence_until = ? WHERE recurrence_group = ? AND start < ?",
                                 ((_dt(old["start"]).date() - timedelta(days=1)).isoformat(), old["recurrence_group"], old["start"]))
                    conn.execute("UPDATE events SET recurrence_group = NULL WHERE id = ?", (event_id,))
                    for k in keep:
                        conn.execute("UPDATE events SET recurrence_group = NULL WHERE id = ?", (k,))
            crud.update_item(conn, "events", event_id, data, ctx)
            new = _row(conn, event_id)
            if not new.get("recurrence_group"):
                conn.execute("UPDATE events SET recurrence_group = ? WHERE id = ?", (secrets.token_hex(8), event_id))
            group = _row(conn, event_id)["recurrence_group"]
            kept_days = set()
            for k in keep:
                conn.execute("UPDATE events SET recurrence_group = ? WHERE id = ?", (group, k))
                kept_days.add(_row(conn, k)["start"][:10])
            expand(conn, event_id, skip_dates=kept_days)
            return crud.get_item(conn, "events", event_id, ctx)

        # stessa regola: i campi comuni e lo spostamento d'orario passano ai successivi
        shift = _dt(clean["start"]) - _dt(old["start"]) if "start" in clean else timedelta(0)
        crud.update_item(conn, "events", event_id, data, ctx)
        new = _row(conn, event_id)
        length = _dt(new["end"]) - _dt(new["start"]) if new.get("end") else None
        shared = {k: clean[k] for k in SHARED if k in clean}
        for f in following:
            rec = dict(shared)
            if shift or "end" in clean:
                start = _dt(f["start"]) + shift
                rec["start"] = _fmt(start, new["start"])
                rec["end"] = _fmt(start + length, new["end"]) if length is not None else None
            if rec:
                rec["updated_at"] = now_iso()
                crud._update(conn, "events", f["id"], rec)
        return crud.get_item(conn, "events", event_id, ctx)


def delete(conn, event_id, scope="this", ctx=crud.LOCAL):
    """Elimina un appuntamento ricorrente, oppure anche tutti i successivi."""
    if scope not in ("this", "following"):
        raise ValidationError("Ambito non valido")
    with transaction(conn):
        crud.get_item(conn, "events", event_id, ctx)
        old = _row(conn, event_id)
        crud.can_write(conn, crud.check("events"), old, ctx)
        targets = _following(conn, old) if scope == "following" else [old]
        for f in targets:
            crud.delete_item(conn, "events", f["id"], ctx)
        if scope == "following" and old.get("recurrence_group"):
            conn.execute("UPDATE events SET recurrence_until = ? WHERE recurrence_group = ?",
                         ((_dt(old["start"]).date() - timedelta(days=1)).isoformat(), old["recurrence_group"]))
        return {"deleted": len(targets)}
