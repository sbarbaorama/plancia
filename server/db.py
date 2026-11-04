"""Connessione SQLite e migrazioni dello schema."""
import re
import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def _casefold(value):
    return value.casefold() if isinstance(value, str) else value


def connect(path) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    # Ricerca senza distinzione maiuscole/minuscole anche per le lettere accentate.
    conn.create_function("casefold", 1, _casefold, deterministic=True)
    return conn


def _migrations():
    found = []
    for f in MIGRATIONS_DIR.glob("*.sql"):
        m = re.match(r"(\d+)_", f.name)
        if m:
            found.append((int(m.group(1)), f))
    return sorted(found)


def _statements(sql):
    """Divide lo script in istruzioni complete (i trigger contengono ';' tra BEGIN e END)."""
    buffer = ""
    for part in sql.split(";"):
        buffer += part + ";"
        if sqlite3.complete_statement(buffer):
            if buffer.strip(" \t\r\n;") and not all(
                    ln.strip().startswith("--") or not ln.strip() for ln in buffer.strip(" \t\r\n;").splitlines()):
                yield buffer
            buffer = ""
    if buffer.strip(" \t\r\n;"):
        yield buffer


def migrate(conn: sqlite3.Connection) -> int:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    current = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] or 0
    for number, file in _migrations():
        if number <= current:
            continue
        sql = file.read_text(encoding="utf-8")
        conn.execute("BEGIN")
        try:
            for statement in _statements(sql):
                conn.execute(statement)
            conn.execute("INSERT INTO schema_version(version) VALUES (?)", (number,))
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        current = number
    return current


def open_db(path) -> sqlite3.Connection:
    conn = connect(path)
    migrate(conn)
    return conn
