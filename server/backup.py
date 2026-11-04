"""Export/import JSON e backup giornaliero su file."""
import json
import logging
import re
import shutil
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from . import attachments, crud, ops
from .crud import ValidationError, now_iso
from .schema import R, TABLE_ORDER

ROOT = Path(__file__).resolve().parent.parent
EXPORT_VERSION = 1
FILE_RE = re.compile(r"^plancia_(\d{4}-\d{2}-\d{2})\.(db|json)$")
# Tabelle esportate per intero (tutte le colonne). Gli utenti senza password: le password non escono mai dal DB.
EXTRA_TABLES = ("service_manager_customers", "activity_log", "settings")
log = logging.getLogger("plancia.backup")


def _columns(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def export_data(conn) -> dict:
    data = {"app": "plancia", "version": EXPORT_VERSION, "exported_at": now_iso()}
    for table in TABLE_ORDER:
        cols = [c for c in _columns(conn, table) if c != "password_hash"]
        data[table] = [dict(zip(cols, r)) for r in conn.execute(f"SELECT {', '.join(f'[{c}]' for c in cols)} FROM {table} ORDER BY id")]
    data["service_manager_customers"] = [dict(r) for r in conn.execute("SELECT * FROM service_manager_customers")]
    data["activity_log"] = [dict(r) for r in conn.execute("SELECT * FROM activity_log ORDER BY id")]
    data["settings"] = [dict(r) for r in conn.execute(
        "SELECT * FROM settings WHERE key IN ({})".format(",".join("?" * len(ops.PUBLIC_SETTINGS))), ops.PUBLIC_SETTINGS)]
    data["attachments"] = [dict(r) for r in conn.execute(f"SELECT {attachments.FIELDS} FROM attachments ORDER BY id")]
    return data


def import_data(conn, data) -> dict:
    """Sostituisce TUTTI i dati con quelli dell'export (gli utenti con password restano)."""
    if not isinstance(data, dict) or data.get("app") != "plancia":
        raise ValidationError("Il file non è un export di Plancia")
    counts = {}
    with crud.transaction(conn):
        conn.execute("PRAGMA defer_foreign_keys = ON")
        for table in ("attachments", "activity_log", "service_manager_customers", *reversed(TABLE_ORDER)):
            if table == "users":
                continue
            conn.execute(f"DELETE FROM {table}")
        for table in (*TABLE_ORDER, "service_manager_customers", "activity_log", "attachments"):
            rows = data.get(table) or []
            if not isinstance(rows, list):
                raise ValidationError(f"Export non valido: {table}")
            cols = set(_columns(conn, table))
            n = 0
            for row in rows:
                if not isinstance(row, dict):
                    raise ValidationError(f"Export non valido: {table}")
                rec = {k: v for k, v in row.items() if k in cols and k != "password_hash"}
                if table == "users":
                    if conn.execute("SELECT 1 FROM users WHERE id = ?", (rec.get("id"),)).fetchone():
                        continue
                if table in ("checklist_templates", "checklist_runs") and isinstance(rec.get("steps"), list):
                    rec["steps"] = json.dumps(rec["steps"], ensure_ascii=False)
                if table == "attachments" and rec.get("kind") == "file" and not attachments.STORED_RE.fullmatch(str(row.get("stored_name") or "")):
                    continue
                if table == "attachments":
                    rec["stored_name"] = row.get("stored_name")
                try:
                    crud._insert(conn, table, rec)
                except sqlite3.Error as e:
                    raise ValidationError(f"Export non valido ({table}): {e}")
                n += 1
            counts[table] = n
        for row in data.get("settings") or []:
            if isinstance(row, dict) and row.get("key") in ops.PUBLIC_SETTINGS:
                conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                             (row["key"], row.get("value")))
        bad = conn.execute("PRAGMA foreign_key_check").fetchall()
        if bad:
            raise ValidationError("Export non valido: riferimenti mancanti tra i dati")
        conn.execute("DELETE FROM attachment_trash")
    return counts


def backup_dir(conn) -> Path:
    return Path(ops.get_settings(conn)["backup_dir"] or ROOT / "backups")


def run_backup(conn, folder, today) -> list:
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"plancia_{today.isoformat()}"
    db_file, json_file, tmp = folder / f"{stem}.db", folder / f"{stem}.json", folder / f"{stem}.db.tmp"
    target = sqlite3.connect(tmp)
    try:
        conn.backup(target)
    finally:
        target.close()
    tmp.replace(db_file)
    json_file.write_text(json.dumps(export_data(conn), ensure_ascii=False, indent=1), encoding="utf-8")
    sync_attachments(conn, folder / "allegati")
    return [db_file, json_file]


def _stored_files(base: Path) -> dict:
    found = {}
    if base.is_dir():
        for f in base.rglob("*"):
            rel = f.relative_to(base).as_posix()
            if attachments.STORED_RE.fullmatch(rel) and f.is_file():
                found[rel] = f
    return found


def sync_attachments(conn, dest) -> dict:
    """Copia nella cartella del backup i file allegati nuovi e toglie quelli eliminati. Non duplica nulla."""
    dest = Path(dest)
    source, target = _stored_files(attachments.files_dir(conn)), _stored_files(dest)
    copied = removed = 0
    for rel, f in source.items():
        try:
            if rel not in target or target[rel].stat().st_size != f.stat().st_size:
                (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest / rel)
                copied += 1
        except OSError as e:
            log.warning("Allegato non copiato nel backup: %s (%s)", f, e)
    for (rel,) in conn.execute("SELECT stored_name FROM attachment_mirror_deletions").fetchall():
        if not conn.execute("SELECT 1 FROM attachments WHERE stored_name = ?", (rel,)).fetchone() and rel in target:
            try:
                target[rel].unlink()
                removed += 1
            except OSError as e:
                log.warning("Allegato non rimosso dal backup: %s (%s)", rel, e)
                continue
        conn.execute("DELETE FROM attachment_mirror_deletions WHERE stored_name = ?", (rel,))
    return {"copied": copied, "removed": removed}


def prune(folder, retention_days, today) -> list:
    limit = today - timedelta(days=int(retention_days))
    removed = []
    folder = Path(folder)
    if not folder.is_dir():
        return removed
    for f in folder.iterdir():
        m = FILE_RE.match(f.name)
        if m:
            try:
                if date.fromisoformat(m.group(1)) < limit:
                    f.unlink()
                    removed.append(f)
            except ValueError:
                continue
    return removed


def ensure_daily_backup(conn, today, force=False) -> dict:
    settings = ops.get_settings(conn)
    if not force and settings["last_backup"] == today.isoformat():
        return {"done": False, "files": [], "error": None}
    folder = backup_dir(conn)
    try:
        files = run_backup(conn, folder, today)
    except (OSError, sqlite3.Error) as e:
        error = f"{today.isoformat()}: {e}"
        log.error("Backup fallito: %s", error)
        ops.put_settings(conn, {"last_backup_error": error}, internal=True)
        return {"done": False, "files": [], "error": error}
    try:
        prune(folder, settings["retention_days"], today)
    except OSError as e:
        log.warning("Pulizia dei backup vecchi non riuscita: %s", e)
    ops.put_settings(conn, {"last_backup": today.isoformat(), "last_backup_error": None}, internal=True)
    log.info("Backup creato: %s", ", ".join(str(f) for f in files))
    return {"done": True, "files": [str(f) for f in files], "error": None}
