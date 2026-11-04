"""Allegati: file salvati accanto al database e link a documenti esterni (OneDrive, SharePoint, rete)."""
import logging
import re
import secrets
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlsplit

from . import crud
from .crud import NotFound, ValidationError, as_int, now_iso
from .schema import ATTACHMENT_TYPES

MAX_FILE = 25 * 1024 * 1024
MIME = {
    "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "txt": "text/plain", "csv": "text/csv", "log": "text/plain", "json": "application/json",
    "xml": "application/xml", "md": "text/plain", "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "vsd": "application/vnd.visio", "vsdx": "application/vnd.ms-visio.drawing", "msg": "application/vnd.ms-outlook",
    "eml": "message/rfc822", "zip": "application/zip", "7z": "application/x-7z-compressed",
}
INLINE_EXT = frozenset({"pdf", "png", "jpg", "jpeg", "gif", "webp"})
STORED_RE = re.compile(r"^\d{4}/\d{2}/[0-9a-f]{32}\.[a-z0-9]{1,5}$")
LINK_SCHEMES = ("http", "https", "file")
FIELDS = "id, entity_type, entity_id, kind, name, url, stored_name, mime, size, created_at"
log = logging.getLogger("plancia.attachments")


def files_dir(conn) -> Path:
    """Cartella degli allegati: 'allegati' accanto al file del database."""
    for row in conn.execute("PRAGMA database_list"):
        if row[1] == "main":
            return Path(row[2]).parent / "allegati"
    raise RuntimeError("Database principale non trovato")


def stored_path(base: Path, stored_name):
    if not stored_name or not STORED_RE.fullmatch(stored_name):
        return None
    return base / stored_name


def _row(conn, row, base=None) -> dict:
    d = dict(row)
    stored = d.pop("stored_name", None)
    if d["kind"] == "file":
        path = stored_path(base or files_dir(conn), stored)
        d["missing"] = path is None or not path.is_file()
    else:
        d["missing"] = False
    return d


def check_entity(conn, entity_type, entity_id, ctx=crud.LOCAL) -> int:
    if entity_type not in ATTACHMENT_TYPES:
        raise ValidationError("Tipo di elemento non valido per gli allegati")
    return crud.get_item(conn, entity_type, as_int(entity_id, "Elemento"), ctx)["id"]


def clean_name(name) -> str:
    if not isinstance(name, str):
        raise ValidationError("Nome del file mancante")
    name = "".join(c for c in name if c.isprintable()).replace("\\", "/").split("/")[-1].strip()
    if not name:
        raise ValidationError("Nome del file mancante")
    return name[:255]


def list_for(conn, entity_type, entity_id, ctx=crud.LOCAL) -> list:
    eid = check_entity(conn, entity_type, entity_id, ctx)
    base = files_dir(conn)
    rows = conn.execute(f"SELECT {FIELDS} FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, id",
                        (entity_type, eid))
    return [_row(conn, r, base) for r in rows]


def get(conn, att_id, ctx=crud.LOCAL) -> dict:
    row = conn.execute(f"SELECT {FIELDS} FROM attachments WHERE id = ?", (as_int(att_id, "Allegato"),)).fetchone()
    if not row:
        raise NotFound("Allegato non trovato")
    check_entity(conn, row["entity_type"], row["entity_id"], ctx)  # visibilità dell'elemento
    return _row(conn, row)


def add_file(conn, entity_type, entity_id, name, data: bytes, ctx=crud.LOCAL) -> dict:
    entity_id = check_entity(conn, entity_type, entity_id, ctx)
    name = clean_name(name)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in MIME:
        raise ValidationError(f"{name}: tipo di file non ammesso")
    if not data:
        raise ValidationError(f"{name}: il file è vuoto")
    if len(data) > MAX_FILE:
        raise ValidationError(f"{name}: il file supera i {MAX_FILE // (1024 * 1024)} MB")
    today = date.today()
    stored = f"{today.year:04d}/{today.month:02d}/{secrets.token_hex(16)}.{ext}"
    path = files_dir(conn) / stored
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    try:
        cur = conn.execute(
            "INSERT INTO attachments (entity_type, entity_id, kind, name, stored_name, mime, size, created_at) "
            "VALUES (?, ?, 'file', ?, ?, ?, ?, ?)", (entity_type, entity_id, name, stored, MIME[ext], len(data), now_iso()))
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return get(conn, cur.lastrowid)


def check_url(url) -> str:
    if not isinstance(url, str) or not url.strip():
        raise ValidationError("Link mancante")
    url = url.strip()
    if len(url) > 2000:
        raise ValidationError("Link troppo lungo")
    if url.startswith("\\\\"):
        return url
    if urlsplit(url).scheme.lower() not in LINK_SCHEMES:
        raise ValidationError("Link non ammesso: usa un indirizzo https:// o un percorso di rete \\\\server\\cartella")
    return url


def _link_name(url) -> str:
    parts = urlsplit(url) if not url.startswith("\\\\") else None
    path = parts.path if parts else url
    last = unquote(path).replace("\\", "/").rstrip("/").split("/")[-1].strip()
    return (last or (parts.netloc if parts else "") or url)[:300]


def add_link(conn, entity_type, entity_id, url, name=None, ctx=crud.LOCAL) -> dict:
    entity_id = check_entity(conn, entity_type, entity_id, ctx)
    url = check_url(url)
    name = name.strip()[:300] if isinstance(name, str) and name.strip() else _link_name(url)
    cur = conn.execute("INSERT INTO attachments (entity_type, entity_id, kind, name, url, created_at) VALUES (?, ?, 'link', ?, ?, ?)",
                       (entity_type, entity_id, name, url, now_iso()))
    return get(conn, cur.lastrowid)


def delete(conn, att_id, ctx=crud.LOCAL) -> None:
    get(conn, att_id, ctx)
    conn.execute("DELETE FROM attachments WHERE id = ?", (as_int(att_id, "Allegato"),))


def file_path(conn, att):
    if att.get("kind") != "file":
        return None
    row = conn.execute("SELECT stored_name FROM attachments WHERE id = ?", (att["id"],)).fetchone()
    return stored_path(files_dir(conn), row[0]) if row else None


def flush_trash(conn) -> int:
    """Cancella dal disco i file eliminati che nessun allegato usa più."""
    base = files_dir(conn)
    removed = 0
    for (stored,) in conn.execute("SELECT stored_name FROM attachment_trash").fetchall():
        in_use = conn.execute("SELECT 1 FROM attachments WHERE stored_name = ?", (stored,)).fetchone()
        path = stored_path(base, stored)
        if not in_use and path is not None:
            try:
                if path.is_file():
                    path.unlink()
                    removed += 1
            except OSError as e:
                log.warning("File allegato non eliminabile, riprovo più tardi: %s (%s)", path, e)
                continue
            conn.execute("INSERT OR IGNORE INTO attachment_mirror_deletions (stored_name) VALUES (?)", (stored,))
        conn.execute("DELETE FROM attachment_trash WHERE stored_name = ?", (stored,))
    return removed


def purge_orphans(conn) -> int:
    """Rimuove gli allegati il cui elemento non esiste più (pulizia di sicurezza all'avvio)."""
    removed = 0
    for entity_type in ATTACHMENT_TYPES:
        cur = conn.execute(f"DELETE FROM attachments WHERE entity_type = ? AND entity_id NOT IN (SELECT id FROM {entity_type})",
                           (entity_type,))
        removed += cur.rowcount
    return removed


def stats(conn) -> dict:
    count, total = conn.execute("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM attachments WHERE kind = 'file'").fetchone()
    return {"count": count, "bytes": total}
