"""Server HTTP di Plancia: API JSON + file dell'interfaccia (PWA). Solo libreria standard.

Due modalità:
- personale (predefinita): risponde solo su 127.0.0.1, un utente, nessun login;
- team (--team): più utenti con login, da avviare su un PC/server raggiungibile dai colleghi.
"""
import argparse
import json
import logging
import mimetypes
import re
import socket
import sqlite3
import ssl
import sys
import threading
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from . import attachments, auth, backup, crud, importer, legacy, ops
from .crud import Ctx, Forbidden, NotFound, ValidationError
from .db import connect, open_db
from .schema import R, public_schema

VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 8770
MAX_JSON = 60 * 1024 * 1024
MAX_UPLOAD = attachments.MAX_FILE + 1024
LOOPBACK = ("127.0.0.1", "::1", "::ffff:127.0.0.1")
log = logging.getLogger("plancia")

MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
}
CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
       "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
GENERIC = [n for n in R if n not in ("users", "subtasks", "consultations")]


class BadRequest(Exception):
    pass


class FileResponse:
    def __init__(self, path, name, mime, inline):
        self.path, self.name, self.mime, self.inline = path, name, mime, inline


class TextResponse:
    def __init__(self, text, mime, filename=None):
        self.text, self.mime, self.filename = text, mime, filename


class Config:
    def __init__(self, db_path, web_dir, team=False, port=DEFAULT_PORT, allowed_hosts=(), tls=False):
        self.db_path, self.web_dir, self.team, self.port, self.tls = Path(db_path), Path(web_dir).resolve(), team, port, tls
        self.allowed_hosts = {"127.0.0.1", "localhost", "[::1]"} | {h.lower() for h in allowed_hosts}


class PlanciaServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(cfg: Config, host="127.0.0.1", certfile=None, keyfile=None):
    conn = open_db(cfg.db_path)
    try:
        auth.ensure_local_user(conn)
        attachments.purge_orphans(conn)
        attachments.flush_trash(conn)
    finally:
        conn.close()

    class Handler(DeskHandler):
        pass

    Handler.cfg = cfg
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    PlanciaServer.address_family = family
    server = PlanciaServer((host, cfg.port), Handler)
    if certfile:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certfile, keyfile)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


# ---------------------------------------------------------------- rotte

ROUTES = []


def route(method, pattern, *, admin=False, public=False, raw=False):
    def deco(fn):
        ROUTES.append((method, re.compile(pattern), fn, admin, public, raw))
        return fn
    return deco


def _int(v):
    return crud.as_int(v, "Id")


def _date(q, key, default=None):
    v = q.get(key)
    if not v:
        return default
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise ValidationError(f"Data non valida ({key})")


@route("GET", r"/api/session", public=True)
def r_session(h, conn, q, ctx):
    user = None
    if h.cfg.team:
        u = h.current_user(conn)
        user = auth.public_user(u) if u else None
    else:
        user = auth.public_user(dict(conn.execute("SELECT * FROM users WHERE id = 1").fetchone()))
    return {"mode": "team" if h.cfg.team else "personale", "user": user, "version": VERSION,
            "needs_setup": h.cfg.team and auth.needs_setup(conn), "can_setup": h.is_loopback()}


@route("POST", r"/api/auth/setup", public=True)
def r_setup(h, conn, q, ctx):
    if not h.cfg.team:
        raise Forbidden("Disponibile solo in modalità team")
    if not h.is_loopback():
        raise Forbidden("Il primo amministratore si crea dal PC dove gira il server")
    b = h.body()
    uid = auth.setup_admin(conn, b.get("name"), b.get("username"), b.get("password"))
    h.set_session(auth.create_session(conn, uid))
    return {"ok": True}


@route("POST", r"/api/auth/login", public=True)
def r_login(h, conn, q, ctx):
    if not h.cfg.team:
        return {"ok": True}
    b = h.body()
    h.set_session(auth.login(conn, b.get("username"), b.get("password"), h.client_address[0]))
    return {"ok": True}


@route("POST", r"/api/auth/logout", public=True)
def r_logout(h, conn, q, ctx):
    auth.logout(conn, h.cookie_token())
    h.set_session("", clear=True)
    return {"ok": True}


@route("GET", r"/api/schema")
def r_schema(h, conn, q, ctx):
    return public_schema()


@route("GET", r"/api/settings")
def r_settings(h, conn, q, ctx):
    s = ops.get_settings(conn)
    s["backup_dir_effective"] = str(backup.backup_dir(conn))
    s["legacy_default"] = legacy.find_default()
    s["has_data"] = legacy.has_data(conn)
    return s


@route("PUT", r"/api/settings", admin=True)
def r_settings_put(h, conn, q, ctx):
    ops.put_settings(conn, h.body())
    return r_settings(h, conn, q, ctx)


@route("GET", r"/api/dashboard")
def r_dashboard(h, conn, q, ctx):
    return ops.dashboard(conn, date.today(), ctx)


@route("GET", r"/api/plan")
def r_plan(h, conn, q, ctx):
    return ops.plan_day(conn, _date(q, "date", date.today()), ctx)


@route("PUT", r"/api/plan")
def r_plan_put(h, conn, q, ctx):
    b = h.body()
    return ops.set_plan(conn, _date(b, "date", date.today()), b.get("ids"), ctx)


@route("POST", r"/api/plan/close")
def r_plan_close(h, conn, q, ctx):
    return ops.close_day(conn, _date(h.body(), "date", date.today()), ctx)


@route("POST", r"/api/tasks/(\d+)/unplan")
def r_unplan(h, conn, q, ctx, tid):
    return ops.unplan(conn, _int(tid), ctx)


@route("GET", r"/api/tasks/(\d+)/subtasks")
def r_sub_get(h, conn, q, ctx, tid):
    crud.get_item(conn, "tasks", tid, ctx)
    return ops.list_subtasks(conn, _int(tid))


@route("PUT", r"/api/tasks/(\d+)/subtasks")
def r_sub_put(h, conn, q, ctx, tid):
    return ops.set_subtasks(conn, _int(tid), h.body().get("subtasks"), ctx)


@route("GET", r"/api/tasks/(\d+)/history")
def r_history(h, conn, q, ctx, tid):
    return ops.task_history(conn, _int(tid), ctx)


@route("GET", r"/api/meetings/series")
def r_series(h, conn, q, ctx):
    return ops.series_list(conn)


@route("GET", r"/api/meetings/(\d+)/actions")
def r_actions(h, conn, q, ctx, mid):
    crud.get_item(conn, "meetings", mid, ctx)
    return crud.list_items(conn, "tasks", {"meeting_id": mid}, ctx)


@route("PUT", r"/api/meetings/(\d+)/actions")
def r_actions_put(h, conn, q, ctx, mid):
    return ops.set_actions(conn, _int(mid), h.body().get("actions"), ctx)


@route("GET", r"/api/meetings/(\d+)/carried")
def r_carried(h, conn, q, ctx, mid):
    return ops.carried_actions(conn, _int(mid), ctx)


@route("POST", r"/api/deadlines/(\d+)/complete")
def r_deadline_done(h, conn, q, ctx, did):
    b = h.body()
    return ops.complete_deadline(conn, _int(did), _date(b, "done_date", date.today()), ctx)


@route("POST", r"/api/waiting_items/(\d+)/follow_up")
def r_follow_up(h, conn, q, ctx, wid):
    return ops.follow_up(conn, _int(wid), ctx)


@route("POST", r"/api/inbox_items/(\d+)/convert")
def r_convert(h, conn, q, ctx, iid):
    return ops.convert_inbox(conn, _int(iid), h.body().get("type"), ctx)


@route("POST", r"/api/checklist_templates/(\d+)/start")
def r_cl_start(h, conn, q, ctx, tid):
    b = h.body()
    return ops.start_checklist(conn, _int(tid), b.get("customer_id"), b.get("change_id"), ctx)


@route("PUT", r"/api/checklist_runs/(\d+)/steps/(\d+)")
def r_cl_step(h, conn, q, ctx, rid, idx):
    b = h.body()
    if not isinstance(b.get("done"), bool):
        raise ValidationError("Indicare done: true o false")
    return ops.set_checklist_step(conn, _int(rid), _int(idx), b["done"], ctx)


# consulenze
@route("GET", r"/api/consultations")
def r_cons_list(h, conn, q, ctx):
    return crud.list_items(conn, "consultations", q, ctx)


@route("POST", r"/api/consultations")
def r_cons_create(h, conn, q, ctx):
    return ops.create_consultation(conn, h.body(), ctx), 201


@route("GET", r"/api/consultations/(\d+)")
def r_cons_get(h, conn, q, ctx, cid):
    item = crud.get_item(conn, "consultations", cid, ctx)
    item["activities"] = ops.list_subtasks(conn, item["task_id"])
    return item


@route("PUT", r"/api/consultations/(\d+)")
def r_cons_put(h, conn, q, ctx, cid):
    return ops.update_consultation(conn, _int(cid), h.body(), ctx)


@route("DELETE", r"/api/consultations/(\d+)")
def r_cons_del(h, conn, q, ctx, cid):
    ops.delete_consultation(conn, _int(cid), ctx)
    return None, 204


@route("POST", r"/api/consultations/(\d+)/close")
def r_cons_close(h, conn, q, ctx, cid):
    return ops.close_consultation(conn, _int(cid), h.body().get("closing_note"), ctx)


@route("POST", r"/api/consultations/(\d+)/reopen")
def r_cons_reopen(h, conn, q, ctx, cid):
    return ops.reopen_consultation(conn, _int(cid), ctx)


@route("POST", r"/api/consultations/(\d+)/duplicate")
def r_cons_dup(h, conn, q, ctx, cid):
    return ops.duplicate_consultation(conn, _int(cid), _date(h.body(), "date_start"), ctx), 201


# ore
@route("GET", r"/api/timer")
def r_timer(h, conn, q, ctx):
    return {"timer": ops.running_timer(conn, ctx)}


@route("POST", r"/api/timer/start")
def r_timer_start(h, conn, q, ctx):
    return {"timer": ops.start_timer(conn, h.body(), ctx)}


@route("POST", r"/api/timer/stop")
def r_timer_stop(h, conn, q, ctx):
    with crud.transaction(conn):
        entry = ops.stop_timer(conn, ctx)
    return {"timer": None, "entry": entry}


@route("GET", r"/api/time/summary")
def r_time_summary(h, conn, q, ctx):
    today = date.today()
    return ops.time_summary(conn, _date(q, "from", today.replace(day=1)), _date(q, "to", today), ctx, q.get("user", "me"))


@route("GET", r"/api/time/export\.csv")
def r_time_csv(h, conn, q, ctx):
    today = date.today()
    start, end = _date(q, "from", today.replace(day=1)), _date(q, "to", today)
    return TextResponse(ops.time_csv(conn, start, end, ctx, q.get("user", "me")), "text/csv; charset=utf-8",
                        f"ore_{start.isoformat()}_{end.isoformat()}.csv")


# modifiche, clienti, riepilogo, ricerca
@route("GET", r"/api/changes/calendar")
def r_change_cal(h, conn, q, ctx):
    today = date.today()
    start = _date(q, "from", today - timedelta(days=today.weekday()))
    return ops.change_calendar(conn, start, _date(q, "to", start + timedelta(days=13)), q.get("customer_id") or None, ctx)


@route("GET", r"/api/changes/check")
def r_change_check(h, conn, q, ctx):
    return ops.freeze_conflicts(conn, q.get("customer_id") or None, q.get("planned_at"))


@route("GET", r"/api/customers/(\d+)/cockpit")
def r_cockpit(h, conn, q, ctx, cid):
    return ops.customer_cockpit(conn, _int(cid), date.today(), ctx)


@route("GET", r"/api/report")
def r_report(h, conn, q, ctx):
    today = date.today()
    start = _date(q, "from", today - timedelta(days=today.weekday()))
    return ops.weekly_report(conn, start, _date(q, "to", start + timedelta(days=6)), q.get("customer_id") or None, ctx)


@route("GET", r"/api/search")
def r_search(h, conn, q, ctx):
    return ops.search(conn, q.get("q", ""), ctx, limit=min(20, int(q.get("limit") or 8)))


@route("GET", r"/api/reminders")
def r_reminders(h, conn, q, ctx):
    return ops.reminders(conn, datetime.now(), ctx)


# utenti
@route("GET", r"/api/users")
def r_users(h, conn, q, ctx):
    return crud.list_items(conn, "users", {}, ctx)


@route("POST", r"/api/users", admin=True)
def r_user_create(h, conn, q, ctx):
    if not h.cfg.team:
        raise ValidationError("Gli utenti servono solo in modalità team")
    return auth.create_user(conn, h.body(), ctx), 201


@route("PUT", r"/api/users/(\d+)")
def r_user_update(h, conn, q, ctx, uid):
    b = h.body()
    user = auth.update_user(conn, _int(uid), b, ctx)
    if b.get("password") and user["id"] == ctx.user_id and h.cfg.team:
        h.set_session(auth.create_session(conn, user["id"]))
    return user


# allegati
@route("GET", r"/api/attachments")
def r_att_list(h, conn, q, ctx):
    return attachments.list_for(conn, q.get("entity_type"), q.get("entity_id"), ctx)


@route("POST", r"/api/attachments/link")
def r_att_link(h, conn, q, ctx):
    b = h.body()
    return attachments.add_link(conn, b.get("entity_type"), b.get("entity_id"), b.get("url"), b.get("name"), ctx), 201


@route("POST", r"/api/attachments/upload", raw=True)
def r_att_upload(h, conn, q, ctx):
    data = h.raw_body(MAX_UPLOAD)
    return attachments.add_file(conn, q.get("entity_type"), q.get("entity_id"), q.get("name"), data, ctx), 201


@route("GET", r"/api/attachments/(\d+)/file")
def r_att_file(h, conn, q, ctx, aid):
    att = attachments.get(conn, aid, ctx)
    if att["kind"] != "file":
        raise NotFound("Questo allegato è un link")
    path = attachments.file_path(conn, att)
    if path is None or not path.is_file():
        raise NotFound("File non presente su questo PC")
    ext = path.suffix.lstrip(".").lower()
    return FileResponse(path, att["name"], attachments.MIME.get(ext, "application/octet-stream"), ext in attachments.INLINE_EXT)


@route("DELETE", r"/api/attachments/(\d+)")
def r_att_del(h, conn, q, ctx, aid):
    attachments.delete(conn, aid, ctx)
    return None, 204


# import/export
@route("POST", r"/api/import/parse")
def r_parse(h, conn, q, ctx):
    b = h.body()
    try:
        return importer.parse(b.get("kind"), b.get("content"), b.get("content_b64"))
    except importer.ImportError_ as e:
        raise ValidationError(str(e))


@route("GET", r"/api/export", admin=True)
def r_export(h, conn, q, ctx):
    return TextResponse(json.dumps(backup.export_data(conn), ensure_ascii=False, indent=1), "application/json; charset=utf-8",
                        f"plancia_{date.today().isoformat()}.json")


@route("POST", r"/api/import", admin=True)
def r_import(h, conn, q, ctx):
    data = h.body(MAX_JSON)
    safety = backup.ensure_daily_backup(conn, date.today(), force=True)
    if safety["error"]:
        raise ValidationError(f"Import annullato: il backup preliminare non è riuscito ({safety['error']})")
    return {"counts": backup.import_data(conn, data)}


@route("POST", r"/api/backup", admin=True)
def r_backup(h, conn, q, ctx):
    result = backup.ensure_daily_backup(conn, date.today(), force=True)
    if result["error"]:
        raise ValidationError(f"Backup non riuscito: {result['error']}")
    return result


@route("POST", r"/api/legacy/import", admin=True)
def r_legacy(h, conn, q, ctx):
    b = h.body()
    if legacy.has_data(conn):
        safety = backup.ensure_daily_backup(conn, date.today(), force=True)
        if safety["error"]:
            raise ValidationError(f"Import annullato: il backup preliminare non è riuscito ({safety['error']})")
    counts = legacy.import_legacy(conn, b.get("path") or legacy.find_default(), bool(b.get("replace")), ctx.user_id)
    ops.put_settings(conn, {"legacy_db_path": b.get("path") or legacy.find_default()})
    return {"counts": counts}


# risorse generiche (in fondo: le rotte specifiche hanno la precedenza)
_RES = "(" + "|".join(GENERIC) + ")"


@route("GET", rf"/api/{_RES}")
def r_list(h, conn, q, ctx, res):
    return crud.list_items(conn, res, q, ctx)


def _with_freezes(conn, res, item):
    if res == "changes" and item.get("outcome") == "pianificata":
        item["freezes"] = ops.freeze_conflicts(conn, item.get("customer_id"), item.get("planned_at"))
    return item


@route("POST", rf"/api/{_RES}")
def r_create(h, conn, q, ctx, res):
    return _with_freezes(conn, res, crud.create_item(conn, res, h.body(), ctx)), 201


@route("GET", rf"/api/{_RES}/(\d+)")
def r_get(h, conn, q, ctx, res, iid):
    return _with_freezes(conn, res, crud.get_item(conn, res, iid, ctx))


@route("PUT", rf"/api/{_RES}/(\d+)")
def r_update(h, conn, q, ctx, res, iid):
    return _with_freezes(conn, res, crud.update_item(conn, res, iid, h.body(), ctx))


@route("DELETE", rf"/api/{_RES}/(\d+)")
def r_delete(h, conn, q, ctx, res, iid):
    crud.delete_item(conn, res, iid, ctx)
    return None, 204


# ---------------------------------------------------------------- gestore HTTP

class DeskHandler(BaseHTTPRequestHandler):
    cfg: Config
    server_version = "Plancia"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")

    def log_message(self, fmt, *args):
        log.debug("%s - %s", self.address_string(), fmt % args)

    # ------------------------------------------------------------ utilità
    def is_loopback(self):
        return self.client_address[0] in LOOPBACK

    def cookie_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            c = SimpleCookie(raw)
        except Exception:
            return None
        return c[auth.COOKIE].value if auth.COOKIE in c else None

    def current_user(self, conn):
        return auth.user_for_token(conn, self.cookie_token())

    def set_session(self, token, clear=False):
        parts = [f"{auth.COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Strict"]
        parts.append("Max-Age=0" if clear else f"Max-Age={auth.SESSION_DAYS * 86400}")
        if self.cfg.tls:
            parts.append("Secure")
        self._extra_headers.append(("Set-Cookie", "; ".join(parts)))

    def _read(self, limit):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise BadRequest("Content-Length non valido")
        if length < 0 or length > limit:
            raise BadRequest("Richiesta troppo grande")
        self._consumed = True
        return self.rfile.read(length) if length else b""

    def body(self, limit=2 * 1024 * 1024):
        if self._body_cache is None:
            raw = self._read(limit)
            if not raw:
                self._body_cache = {}
            else:
                try:
                    self._body_cache = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise BadRequest("JSON non valido")
            if not isinstance(self._body_cache, dict):
                raise BadRequest("JSON non valido: serve un oggetto")
        return self._body_cache

    def raw_body(self, limit):
        return self._read(limit)

    # ------------------------------------------------------------ protezione
    def _refuse(self, raw_route):
        host = (self.headers.get("Host") or "").strip().lower()
        hostname = host.split("]")[0] + "]" if host.startswith("[") else host.rsplit(":", 1)[0]
        if hostname not in self.cfg.allowed_hosts:
            return HTTPStatus.FORBIDDEN, "Richiesta non consentita (indirizzo del server non autorizzato)"
        if self.command in ("GET", "HEAD"):
            return None
        origin = self.headers.get("Origin")
        if origin is not None and origin != "null":
            p = urlparse(origin)
            expected = ("https" if self.cfg.tls else "http", host)
            if (p.scheme, p.netloc.lower()) != expected:
                return HTTPStatus.FORBIDDEN, "Richiesta non consentita: arriva da un altro sito"
        elif origin == "null":
            return HTTPStatus.FORBIDDEN, "Richiesta non consentita"
        if (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            return HTTPStatus.FORBIDDEN, "Richiesta non consentita: arriva da un altro sito"
        # Un'intestazione personalizzata non può essere inviata da un altro sito senza un permesso CORS
        # (che il server non concede mai): blocca le richieste falsificate.
        if self.headers.get("X-Plancia") != "1":
            return HTTPStatus.FORBIDDEN, "Richiesta non consentita"
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        length = self.headers.get("Content-Length") or "0"
        if length != "0":
            if raw_route and ctype != "application/octet-stream":
                return HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Formato non supportato"
            if not raw_route and ctype != "application/json":
                return HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Formato non supportato: serve JSON"
        return None

    # ------------------------------------------------------------ smistamento
    def _handle(self, method):
        self._extra_headers = []
        self._body_cache = None
        self._consumed = False
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            self._api(method, url)
        elif method == "GET":
            refusal = self._refuse(False)
            if refusal:
                self._json(refusal[0], {"error": refusal[1]})
            else:
                self._static(url.path)
        else:
            self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Metodo non consentito"})

    def _api(self, method, url):
        query = {k: v[-1] for k, v in parse_qs(url.query).items()}
        conn = None
        try:
            for m, pattern, fn, admin, public, raw in ROUTES:
                if m != method:
                    continue
                match = pattern.fullmatch(url.path)
                if not match:
                    continue
                refusal = self._refuse(raw)
                if refusal:
                    # svuota il corpo per mantenere valida la connessione
                    self._json(refusal[0], {"error": refusal[1]})
                    return
                conn = connect(self.cfg.db_path)
                ctx = self._ctx(conn, public)
                if admin and not ctx.is_admin:
                    raise Forbidden("Operazione riservata all'amministratore")
                result = fn(self, conn, query, ctx, *match.groups())
                status = HTTPStatus.OK
                if isinstance(result, tuple):
                    result, status = result
                if method != "GET":
                    self._flush_trash(conn)
                if isinstance(result, FileResponse):
                    self._file(result)
                elif isinstance(result, TextResponse):
                    self._text(result)
                else:
                    self._json(status, result)
                return
            raise NotFound("Risorsa non trovata")
        except (ValidationError, BadRequest) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
        except Unauthorized:
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Accesso richiesto", "login": True})
        except Forbidden as e:
            self._json(HTTPStatus.FORBIDDEN, {"error": str(e) or "Non consentito"})
        except NotFound as e:
            self._json(HTTPStatus.NOT_FOUND, {"error": str(e) or "Non trovato"})
        except sqlite3.IntegrityError as e:
            log.warning("Vincolo non rispettato su %s %s: %s", method, url.path, e)
            self._json(HTTPStatus.BAD_REQUEST, {"error": "Dati non validi: manca un campo obbligatorio o un riferimento"})
        except Exception:
            log.exception("Errore su %s %s", method, url.path)
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Errore interno"})
        finally:
            if conn is not None:
                conn.close()

    def _ctx(self, conn, public):
        if not self.cfg.team:
            return crud.LOCAL
        user = self.current_user(conn)
        if user is None:
            if public:
                return Ctx(user_id=0, is_admin=False, team=True)
            raise Unauthorized()
        return Ctx(user_id=user["id"], is_admin=user["role"] == "admin", team=True)

    @staticmethod
    def _flush_trash(conn):
        try:
            attachments.flush_trash(conn)
        except Exception:
            log.exception("Pulizia dei file allegati non riuscita")

    # ------------------------------------------------------------ risposte
    def _send(self, status, ctype, data, headers=()):
        self.send_response(status)
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if not self._consumed and (self.headers.get("Content-Length") or "0") != "0" and not self.close_connection:
            # corpo non letto (richiesta rifiutata prima): si chiude la connessione per non confondere la successiva
            headers = list(headers) + [("Connection", "close")]
            self.close_connection = True
        for k, v in list(headers) + self._extra_headers:
            self.send_header(k, v)
        self.end_headers()
        if data and self.command != "HEAD":
            self.wfile.write(data)

    def _json(self, status, payload):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = [("Cache-Control", "no-store")]
        self._send(status, "application/json; charset=utf-8" if payload is not None else None, data, headers)

    def _text(self, resp):
        headers = [("Cache-Control", "no-store")]
        if resp.filename:
            headers.append(("Content-Disposition", f'attachment; filename="{resp.filename}"'))
        self._send(HTTPStatus.OK, resp.mime, resp.text.encode("utf-8"), headers)

    def _file(self, resp):
        data = resp.path.read_bytes()
        ascii_name = "".join(c for c in resp.name if 32 <= ord(c) < 127 and c not in '"\\') or "allegato"
        disp = "inline" if resp.inline else "attachment"
        self._send(HTTPStatus.OK, resp.mime if resp.inline else "application/octet-stream", data, [
            ("Content-Disposition", f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(resp.name, safe='')}"),
            ("Cache-Control", "no-store"), ("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"),
        ])

    def _static(self, raw_path):
        path = unquote(raw_path).replace("\\", "/")
        if path in ("", "/"):
            path = "/index.html"
        target = (self.cfg.web_dir / path.lstrip("/")).resolve()
        if not target.is_relative_to(self.cfg.web_dir) or not target.is_file():
            self._json(HTTPStatus.NOT_FOUND, {"error": "Non trovato"})
            return
        ctype = MIME.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        headers = [("Cache-Control", "no-cache"), ("Content-Security-Policy", CSP), ("X-Frame-Options", "DENY")]
        if target.name == "sw.js":
            headers.append(("Service-Worker-Allowed", "/"))
        self._send(HTTPStatus.OK, ctype, target.read_bytes(), headers)


class Unauthorized(Exception):
    pass


# ---------------------------------------------------------------- avvio

def start_backup_thread(db_path, interval_s=3600):
    stop = threading.Event()

    def loop():
        while True:
            try:
                conn = connect(db_path)
                try:
                    backup.ensure_daily_backup(conn, date.today())
                finally:
                    conn.close()
            except Exception:
                log.exception("Errore nel controllo del backup")
            if stop.wait(interval_s):
                return

    thread = threading.Thread(target=loop, name="backup", daemon=True)
    thread.stop = stop
    thread.start()
    return thread


def _setup_logging(log_file):
    handlers = [logging.StreamHandler(sys.stderr)] if sys.stderr else []
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers, force=True)


def main(argv=None):
    p = argparse.ArgumentParser(description="Plancia - server")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--db", default=str(ROOT / "data" / "plancia.db"))
    p.add_argument("--no-log-file", action="store_true")
    p.add_argument("--team", action="store_true", help="modalità team: più utenti con login")
    p.add_argument("--host", default="127.0.0.1", help="indirizzo di ascolto (in team, es. 0.0.0.0)")
    p.add_argument("--allowed-host", action="append", default=[],
                   help="nome con cui i colleghi raggiungono il server (es. plancia.azienda.local); ripetibile")
    p.add_argument("--cert", help="certificato TLS (PEM) per HTTPS")
    p.add_argument("--key", help="chiave privata TLS (PEM)")
    args = p.parse_args(argv)
    db_path = Path(args.db)
    _setup_logging(None if args.no_log_file else db_path.parent / "server.log")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not args.team:
        log.error("Per accettare connessioni da altri PC serve la modalità team (--team)")
        raise SystemExit(2)
    if args.team and args.host not in ("127.0.0.1", "localhost", "::1") and not args.cert:
        log.warning("Modalità team senza HTTPS: usa --cert/--key o un reverse proxy HTTPS (le password viaggerebbero in chiaro)")
    cfg = Config(db_path, ROOT / "web", team=args.team, port=args.port, allowed_hosts=args.allowed_host, tls=bool(args.cert))
    try:
        server = make_server(cfg, args.host, args.cert, args.key)
    except OSError:
        log.warning("Plancia già in esecuzione sulla porta %s (oppure porta occupata)", args.port)
        raise SystemExit(0)
    start_backup_thread(db_path)
    scheme = "https" if args.cert else "http"
    log.info("Plancia %s avviata su %s://%s:%s (modalità %s)", VERSION, scheme, args.host, args.port,
             "team" if args.team else "personale")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
