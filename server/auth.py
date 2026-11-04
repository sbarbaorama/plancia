"""Utenti, password e sessioni (usati solo in modalità team; in modalità personale c'è un utente unico)."""
import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timedelta

from . import crud
from .crud import Forbidden, ValidationError, now_iso

ITERATIONS = 240_000
SESSION_DAYS = 14
COOKIE = "plancia_session"
_failures = {}
_lock = threading.Lock()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(calc.hex(), digest)
    except (ValueError, AttributeError):
        return False


def check_password_strength(password):
    if not isinstance(password, str) or len(password) < 10:
        raise ValidationError("La password deve avere almeno 10 caratteri")
    if len(password) > 200:
        raise ValidationError("Password troppo lunga")


def ensure_local_user(conn):
    """Modalità personale: un solo utente, creato al primo avvio."""
    if not conn.execute("SELECT 1 FROM users").fetchone():
        conn.execute("INSERT INTO users (id, name, username, role, created_at, updated_at) VALUES (1, 'Io', 'io', 'admin', ?, ?)",
                     (now_iso(), now_iso()))


def needs_setup(conn) -> bool:
    return not conn.execute("SELECT 1 FROM users WHERE password_hash != '' AND role = 'admin' AND active = 1").fetchone()


def setup_admin(conn, name, username, password):
    """Primo avvio in modalità team: l'utente 1 diventa l'amministratore (con i dati già presenti)."""
    if not needs_setup(conn):
        raise Forbidden("L'amministratore esiste già")
    check_password_strength(password)
    name, username = str(name or "").strip()[:100], str(username or "").strip().lower()[:50]
    if not name or not username:
        raise ValidationError("Nome e nome utente sono obbligatori")
    with crud.transaction(conn):
        if conn.execute("SELECT 1 FROM users WHERE id = 1").fetchone():
            conn.execute("UPDATE users SET name = ?, username = ?, password_hash = ?, role = 'admin', active = 1, updated_at = ? WHERE id = 1",
                         (name, username, hash_password(password), now_iso()))
        else:
            conn.execute("INSERT INTO users (id, name, username, password_hash, role, created_at, updated_at) VALUES (1,?,?,?,'admin',?,?)",
                         (name, username, hash_password(password), now_iso(), now_iso()))
    return 1


def _throttled(key):
    with _lock:
        count, until = _failures.get(key, (0, 0))
        return until > time.time()


def _fail(key):
    with _lock:
        count, _until = _failures.get(key, (0, 0))
        count += 1
        _failures[key] = (count, time.time() + min(300, 2 ** max(0, count - 4)) if count >= 5 else 0)


def login(conn, username, password, client_ip=""):
    username = str(username or "").strip().lower()
    key = f"{client_ip}|{username}"
    if _throttled(key):
        raise Forbidden("Troppi tentativi: riprova tra qualche minuto")
    row = conn.execute("SELECT * FROM users WHERE username = ? AND active = 1", (username,)).fetchone()
    if not row or not row["password_hash"] or not verify_password(str(password or ""), row["password_hash"]):
        _fail(key)
        time.sleep(0.4)
        raise ValidationError("Nome utente o password non corretti")
    with _lock:
        _failures.pop(key, None)
    return create_session(conn, row["id"])


def create_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))
    conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                 (_digest(token), user_id, now_iso(), expires))
    return token


def _digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_for_token(conn, token):
    if not token:
        return None
    row = conn.execute(
        """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1""", (_digest(token), now_iso())).fetchone()
    return dict(row) if row else None


def logout(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_digest(token),))


def public_user(u):
    return {k: u[k] for k in ("id", "name", "username", "role", "color")}


# ---------------------------------------------------------------- gestione utenti (amministratore)

def create_user(conn, data, ctx):
    if not ctx.is_admin:
        raise Forbidden("Solo l'amministratore gestisce gli utenti")
    data = data if isinstance(data, dict) else {}
    password = data.get("password")
    check_password_strength(password)
    with crud.transaction(conn):
        rec = crud.validate(conn, crud.R["users"], {**data, "username": str(data.get("username") or "").strip().lower()}, partial=False)
        crud._check_unique(conn, crud.R["users"], rec)
        rec.setdefault("role", "membro")
        rec.setdefault("active", 1)
        rec.update(password_hash=hash_password(password), created_at=now_iso(), updated_at=now_iso())
        uid = crud._insert(conn, "users", rec)
    return crud.get_item(conn, "users", uid)


def update_user(conn, uid, data, ctx):
    if not ctx.is_admin and int(uid) != ctx.user_id:
        raise Forbidden("Solo l'amministratore gestisce gli utenti")
    data = data if isinstance(data, dict) else {}
    with crud.transaction(conn):
        user = crud.get_item(conn, "users", uid)
        allowed = {"name", "color"} if not ctx.is_admin else {"name", "color", "role", "active", "username"}
        rec = crud.validate(conn, crud.R["users"], {k: v for k, v in data.items() if k in allowed}, partial=True)
        if user["id"] == ctx.user_id and (rec.get("active") == 0 or rec.get("role") == "membro"):
            raise ValidationError("Non puoi togliere a te stesso l'accesso da amministratore")
        crud._check_unique(conn, crud.R["users"], rec, user["id"])
        if data.get("password"):
            check_password_strength(data["password"])
            if not ctx.is_admin or user["id"] == ctx.user_id:
                current = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()[0]
                if current and not verify_password(str(data.get("current_password") or ""), current):
                    raise ValidationError("Password attuale non corretta")
            rec["password_hash"] = hash_password(data["password"])
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        rec["updated_at"] = now_iso()
        crud._update(conn, "users", user["id"], rec)
        if rec.get("active") == 0:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
    return crud.get_item(conn, "users", user["id"])
