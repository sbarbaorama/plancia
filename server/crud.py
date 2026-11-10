"""Lettura e scrittura generica delle risorse descritte in schema.py."""
import json
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .schema import ENUM_LABELS, R


class ValidationError(Exception):
    """Dati non validi. Il messaggio è già in italiano, pronto per l'utente."""


class NotFound(Exception):
    """Elemento inesistente (o non visibile a chi lo chiede)."""


class Forbidden(Exception):
    """Operazione non permessa a questo utente."""


@dataclass
class Ctx:
    """Chi sta facendo la richiesta. In modalità personale c'è un solo utente (id 1)."""
    user_id: int = 1
    is_admin: bool = True
    team: bool = False


LOCAL = Ctx()


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def transaction(conn):
    """Transazione esplicita; annidabile (le interne diventano savepoint)."""
    if conn.in_transaction:
        name = f"sp_{id(object())}"
        conn.execute(f"SAVEPOINT {name}")
        try:
            yield
        except Exception:
            conn.execute(f"ROLLBACK TO {name}")
            conn.execute(f"RELEASE {name}")
            raise
        conn.execute(f"RELEASE {name}")
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except Exception:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


# ---------------------------------------------------------------- conversioni

def as_int(value, label):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{label}: valore non valido")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{label}: numero non valido")
    if abs(number) > 2**62:
        raise ValidationError(f"{label}: numero non valido")
    return number


def parse_date(value, label):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise ValidationError(f"{label}: data non valida")


def parse_datetime(value, label):
    if value in (None, ""):
        return None
    text = str(value).strip().replace(" ", "T")
    try:
        if len(text) == 10:
            return date.fromisoformat(text).isoformat() + "T00:00"
        return datetime.fromisoformat(text[:16]).strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        raise ValidationError(f"{label}: data e ora non valide")


def parse_time(value, label):
    if value in (None, ""):
        return None
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(value)):
        raise ValidationError(f"{label}: ora non valida (HH:MM)")
    return str(value)


def _steps(value, label):
    if isinstance(value, str):
        value = [s for s in value.splitlines()]
    if not isinstance(value, list):
        raise ValidationError(f"{label}: elenco non valido")
    steps = []
    for s in value:
        text = s.get("text") if isinstance(s, dict) else s
        if isinstance(text, str) and text.strip():
            steps.append(text.strip()[:500])
    if not steps:
        raise ValidationError(f"{label}: serve almeno un passo")
    if len(steps) > 200:
        raise ValidationError(f"{label}: massimo 200 passi")
    return json.dumps(steps, ensure_ascii=False)


def _clean(conn, res, name, value):
    kind, label, opt = res.fields[name]
    if kind in ("text", "longtext", "email", "company"):
        if value is None:
            return ""
        if not isinstance(value, (str, int, float)):
            raise ValidationError(f"{label}: testo non valido")
        value = str(value).strip() if kind != "longtext" else str(value).rstrip()
        limit = 300 if kind == "text" else 50000
        if name == "command":
            limit = 20000
        if len(value) > limit:
            raise ValidationError(f"{label}: testo troppo lungo (massimo {limit} caratteri)")
        if kind == "email" and value and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValidationError(f"{label}: indirizzo non valido")
        return value
    if kind == "enum":
        if value not in opt:
            raise ValidationError(f"{label}: valore non ammesso")
        return value
    if kind == "fk":
        number = as_int(value, label)
        if number is None:
            return None
        if not conn.execute(f"SELECT 1 FROM {opt} WHERE id = ?", (number,)).fetchone():
            raise ValidationError(f"{label}: elemento inesistente")
        return number
    if kind == "date":
        return parse_date(value, label)
    if kind == "datetime":
        return parse_datetime(value, label)
    if kind == "time":
        return parse_time(value, label)
    if kind == "int":
        number = as_int(value, label)
        if number is not None and opt and not opt[0] <= number <= opt[1]:
            raise ValidationError(f"{label}: tra {opt[0]} e {opt[1]}")
        return number
    if kind == "float":
        if value in (None, ""):
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValidationError(f"{label}: numero non valido")
        if opt and not opt[0] <= number <= opt[1]:
            raise ValidationError(f"{label}: tra {opt[0]} e {opt[1]}")
        return number
    if kind == "bool":
        if value in (True, 1, "1", "true", "on"):
            return 1
        if value in (False, 0, "0", "false", "", None):
            return 0
        raise ValidationError(f"{label}: valore non valido")
    if kind == "color":
        value = (value or "").strip()
        if value and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValidationError(f"{label}: colore non valido")
        return value or "#2456d3"
    if kind == "steps":
        return _steps(value, label)
    raise ValidationError(f"{label}: tipo sconosciuto")


def validate(conn, res, data, partial):
    if not isinstance(data, dict):
        raise ValidationError("Dati non validi")
    clean = {}
    for name in res.fields:
        if name in data:
            clean[name] = _clean(conn, res, name, data[name])
    if not partial:
        for name, value in res.defaults.items():
            clean.setdefault(name, value)
    for name in res.required:
        if not partial or name in clean:
            value = clean.get(name)
            if value in (None, ""):
                raise ValidationError(f"{res.fields[name][1]}: campo obbligatorio")
    return clean


# ---------------------------------------------------------------- lettura

def check(resource):
    if resource not in R:
        raise NotFound("Risorsa non trovata")
    return R[resource]


def _from(res):
    """Parte FROM … della SELECT della risorsa (con i suoi JOIN)."""
    marker = f"FROM {res.name} {res.alias}"
    i = res.select.rfind(marker)
    return res.select[i + len("FROM "):]


def visibility_clause(res, ctx):
    if not ctx.team or not res.visibility:
        return "", []
    a = res.alias
    if res.visibility == "own":
        col = "user_id" if res.name == "time_entries" else "owner_id"
        return f"{a}.{col} = ?", [ctx.user_id]
    if res.name == "tasks":
        return f"({a}.visibility = 'team' OR {a}.owner_id = ? OR {a}.assignee_id = ?)", [ctx.user_id, ctx.user_id]
    return f"({a}.visibility = 'team' OR {a}.owner_id = ?)", [ctx.user_id]


def row_dict(res, row):
    d = dict(row)
    for col in res.json_cols:
        if col in d and isinstance(d[col], str):
            try:
                d[col] = json.loads(d[col])
            except ValueError:
                d[col] = []
    if "sm_customers" in d and isinstance(d["sm_customers"], str):
        d["sm_customers"] = [x for x in json.loads(d["sm_customers"]) if x.get("id")]
    return d


def like(q):
    q = q.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{q}%"


def list_items(conn, resource, filters=None, ctx=LOCAL):
    res = check(resource)
    filters = {k: v for k, v in (filters or {}).items() if v not in (None, "")}
    a = res.alias
    where, params = [], []

    for name, (kind, label, _opt) in res.fields.items():
        if name == "customer_id" and res.customer_col:
            continue
        if kind in ("enum", "fk", "bool") and name in filters:
            value = filters[name]
            if value == "none":
                where.append(f"{a}.{name} IS NULL")
            elif isinstance(value, str) and "," in value and kind == "enum":
                values = value.split(",")
                where.append(f"{a}.{name} IN ({','.join('?' * len(values))})")
                params += values
            elif kind == "enum" and isinstance(value, str) and value.startswith("!"):
                where.append(f"{a}.{name} != ?")
                params.append(value[1:])
            else:
                where.append(f"{a}.{name} = ?")
                params.append(as_int(value, label) if kind in ("fk", "bool") else value)
    if "customer_id" in filters and res.customer_col:
        if filters["customer_id"] == "none":
            where.append(f"{res.customer_col} IS NULL")
        else:
            where.append(f"{res.customer_col} = ?")
            params.append(as_int(filters["customer_id"], "Cliente"))
    if "q" in filters:
        cols = res.search or (res.title,)
        where.append("(" + " OR ".join(f"casefold({a}.{c}) LIKE ? ESCAPE '\\'" for c in cols) + ")")
        params += [like(filters["q"])] * len(cols)
    if res.date_col and ("from" in filters or "to" in filters):
        end_col = res.date_end_col or res.date_col
        if "from" in filters:
            where.append(f"substr({end_col}, 1, 10) >= ?")
            params.append(parse_date(filters["from"], "Da"))
        if "to" in filters:
            where.append(f"substr({res.date_col}, 1, 10) <= ?")
            params.append(parse_date(filters["to"], "A"))
    vis, vparams = visibility_clause(res, ctx)
    if vis:
        where.append(vis)
        params += vparams

    order = res.order
    if resource == "tasks":
        if filters.get("open") == "1":
            where.append("t.status != 'chiuso'")
        if filters.get("mine") == "1":
            where.append("(t.assignee_id = ? OR (t.assignee_id IS NULL AND t.owner_id = ?))")
            params += [ctx.user_id, ctx.user_id]
        if filters.get("due_to"):
            where.append("t.due_date <= ?")
            params.append(parse_date(filters["due_to"], "Scadenza"))
        if filters.get("unplanned") == "1":
            where.append("t.planned_for IS NULL")
        if filters.get("timeline") == "1":
            where.append("(t.start_date IS NOT NULL OR t.due_date IS NOT NULL)")
        if filters.get("status") == "chiuso":
            order = "t.closed_at DESC, t.id DESC"
        elif filters.get("meeting_id"):
            order = "t.id"
        if filters.get("kind") is None and filters.get("all_kinds") != "1":
            pass
    elif resource == "inbox_items" and filters.get("processed") in ("0", "1"):
        where.append("n.processed_at IS NULL" if filters["processed"] == "0" else "n.processed_at IS NOT NULL")
    elif resource == "time_entries" and filters.get("running") == "1":
        where.append("te.started_at IS NOT NULL AND te.ended_at IS NULL")

    sql = res.select
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY {order}"
    if "limit" in filters:
        sql += " LIMIT ?"
        params.append(as_int(filters["limit"], "Limite"))
    return [row_dict(res, r) for r in conn.execute(sql, params)]


def get_item(conn, resource, item_id, ctx=LOCAL):
    res = check(resource)
    sql = f"{res.select} WHERE {res.alias}.id = ?"
    params = [as_int(item_id, "Id")]
    vis, vparams = visibility_clause(res, ctx)
    if vis:
        sql += f" AND {vis}"
        params += vparams
    row = conn.execute(sql, params).fetchone()
    if row is None:
        raise NotFound(f"{res.label}: elemento non trovato")
    item = row_dict(res, row)
    if resource == "customers":
        item["service_managers"] = [dict(r) for r in conn.execute(
            """SELECT co.id, co.name, co.email, co.phone FROM service_manager_customers s
               JOIN contacts co ON co.id = s.contact_id WHERE s.customer_id = ? ORDER BY casefold(co.name)""",
            (item["id"],))]
    return item


def customer_of(conn, res, item_id):
    if not res.customer_col:
        return None
    row = conn.execute(f"SELECT {res.customer_col} FROM {_from(res)} WHERE {res.alias}.id = ?", (item_id,)).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------- storico

TRACKED = ("status", "outcome", "due_date", "assignee_id", "planned_at", "executed_at", "follow_up_on", "customer_id")


def log(conn, ctx, resource, item_id, action, title="", customer_id=None, detail=""):
    res = R.get(resource)
    if res is not None and not res.log:
        return
    conn.execute(
        "INSERT INTO activity_log (at, user_id, resource, item_id, action, title, customer_id, detail) VALUES (?,?,?,?,?,?,?,?)",
        (now_iso(), ctx.user_id, resource, item_id, action, (title or "")[:300], customer_id, detail[:1000]))


NOT_LOGGED = {"plan_order", "planned_for", "plan_time", "estimate_min"}


def _fmt(value):
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?", value):
        d = f"{value[8:10]}/{value[5:7]}/{value[:4]}"
        return d + (f" {value[11:16]}" if len(value) > 10 else "")
    return ENUM_LABELS.get(value, value) if value not in (None, "") else "—"


def _describe_changes(res, old, new):
    parts = []
    for name, value in new.items():
        if name not in old or old[name] == value or name not in res.fields or name in NOT_LOGGED:
            continue
        label = res.fields[name][1]
        if name in TRACKED and res.fields[name][0] in ("enum", "date", "datetime"):
            parts.append(f"{label}: {_fmt(old[name])} → {_fmt(value)}")
        else:
            parts.append(label)
    return "; ".join(parts)


# ---------------------------------------------------------------- scrittura

def _check_unique(conn, res, record, item_id=None):
    if not res.unique or res.unique not in record:
        return
    sql = f"SELECT id FROM {res.name} WHERE casefold({res.unique}) = casefold(?)"
    params = [record[res.unique]]
    if item_id:
        sql += " AND id != ?"
        params.append(item_id)
    if conn.execute(sql, params).fetchone():
        raise ValidationError(f"Esiste già un elemento «{res.label.lower()}» con questo nome")


def _finalize(conn, resource, record, old=None):
    """Regole di dominio applicate a ogni salvataggio."""
    now = now_iso()
    old = old or {}
    if resource == "tasks":
        status = record.get("status", old.get("status"))
        if status == "chiuso" and old.get("status") != "chiuso":
            record["closed_at"] = now
        elif status != "chiuso" and old.get("status") == "chiuso":
            record["closed_at"] = None
        if record.get("recurrence_unit", old.get("recurrence_unit", "nessuna")) != "nessuna":
            if not (record.get("due_date") or old.get("due_date") or record.get("start_date") or old.get("start_date")):
                raise ValidationError("Per ripetere un task serve una scadenza o una data di inizio")
        start, due = record.get("start_date", old.get("start_date")), record.get("due_date", old.get("due_date"))
        if start and due and start > due:
            raise ValidationError("L'inizio non può essere dopo la scadenza")
    elif resource == "events":
        start, end = record.get("start", old.get("start")), record.get("end", old.get("end"))
        if start and end and end < start:
            raise ValidationError("La fine non può essere prima dell'inizio")
        if not end and start and "end" not in old:
            record["end"] = start
    elif resource == "waiting_items":
        if not old and not record.get("requested_on"):
            record["requested_on"] = date.today().isoformat()
        status = record.get("status", old.get("status"))
        if status != "in_attesa" and old.get("status") in (None, "in_attesa"):
            record["closed_at"] = now
        elif status == "in_attesa":
            record["closed_at"] = None
    elif resource == "meetings":
        status = record.get("status", old.get("status", "attiva"))
        if status == "chiusa" and old.get("status") != "chiusa":
            record["closed_at"] = now
        elif status == "attiva" and old.get("status") == "chiusa":
            record["closed_at"] = None
    elif resource == "change_freezes":
        s, e = record.get("start_date", old.get("start_date")), record.get("end_date", old.get("end_date"))
        if s and e and e < s:
            raise ValidationError("La fine del blocco non può essere prima dell'inizio")
    elif resource == "changes":
        outcome = record.get("outcome", old.get("outcome"))
        if outcome in ("eseguita", "fallita", "rollback") and not (record.get("executed_at") or old.get("executed_at")):
            record["executed_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M")
    elif resource == "contacts":
        _contact_names(record, old)
        if record.get("company"):
            remember_company(conn, record["company"])
    elif resource == "time_entries":
        # il cliente di una registrazione su task si ricava dal task (se non indicato)
        if record.get("task_id") and not record.get("customer_id") and not old.get("customer_id"):
            row = conn.execute("""SELECT COALESCE(t.customer_id, p.customer_id), t.project_id FROM tasks t
                                  LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?""", (record["task_id"],)).fetchone()
            if row:
                record["customer_id"] = row[0]
                record.setdefault("project_id", row[1])
    return record


def split_name(full):
    """"Mario Rossi" → ("Mario", "Rossi"); una sola parola resta nel nome."""
    parts = (full or "").strip().split(None, 1)
    return (parts[0], parts[1]) if len(parts) == 2 else ((parts[0], "") if parts else ("", ""))


def _contact_names(record, old):
    """Nome e cognome separati; "name" (nome completo) resta per elenchi e ricerche."""
    if ("first_name" in record or "last_name" in record):
        first = record.get("first_name", old.get("first_name", ""))
        last = record.get("last_name", old.get("last_name", ""))
        record["name"] = " ".join(x for x in (first, last) if x)
    elif record.get("name"):
        # chi manda solo il nome completo (importazioni, palette, versioni precedenti)
        record["first_name"], record["last_name"] = split_name(record["name"])
    name = record.get("name", old.get("name", ""))
    if not name:
        raise ValidationError("Nome o cognome: campo obbligatorio")


def remember_company(conn, name):
    """Aggiunge l'azienda all'elenco del menu a tendina (se non c'è già)."""
    name = (name or "").strip()
    if name and not conn.execute("SELECT 1 FROM companies WHERE casefold(name) = casefold(?)", (name,)).fetchone():
        now = now_iso()
        conn.execute("INSERT INTO companies (name, created_at, updated_at) VALUES (?, ?, ?)", (name, now, now))


def sync_contacts(conn):
    """Dopo un'importazione: nome/cognome dai nomi completi e aziende nell'elenco."""
    for row in conn.execute("SELECT id, name FROM contacts WHERE first_name = '' AND last_name = ''").fetchall():
        first, last = split_name(row["name"])
        conn.execute("UPDATE contacts SET first_name = ?, last_name = ? WHERE id = ?", (first, last, row["id"]))
    for row in conn.execute("SELECT DISTINCT trim(company) AS c FROM contacts WHERE trim(company) != ''").fetchall():
        remember_company(conn, row["c"])


def _insert(conn, table, record):
    cols = list(record)
    cur = conn.execute(
        f"INSERT INTO {table} ({', '.join(f'[{c}]' for c in cols)}) VALUES ({', '.join('?' * len(cols))})",
        [record[c] for c in cols])
    return cur.lastrowid


def _update(conn, table, item_id, record):
    if not record:
        return
    sets = ", ".join(f"[{c}] = ?" for c in record)
    conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", [*record.values(), item_id])


def _company_renamed(conn, old_name, new_name):
    """Rinominando un'azienda si aggiornano anche i contatti che la usano."""
    if old_name and new_name and old_name != new_name:
        conn.execute("UPDATE contacts SET company = ?, updated_at = ? WHERE casefold(company) = casefold(?)",
                     (new_name, now_iso(), old_name))


def merge_companies(conn, source_id, target_id):
    """Unisce due aziende: i contatti della prima passano alla seconda, che resta."""
    source_id, target_id = as_int(source_id, "Azienda"), as_int(target_id, "Azienda")
    if source_id == target_id:
        raise ValidationError("Scegli un'azienda diversa")
    with transaction(conn):
        src = get_item(conn, "companies", source_id)
        dst = get_item(conn, "companies", target_id)
        conn.execute("UPDATE contacts SET company = ?, updated_at = ? WHERE casefold(company) = casefold(?)",
                     (dst["name"], now_iso(), src["name"]))
        conn.execute("DELETE FROM companies WHERE id = ?", (source_id,))
        return get_item(conn, "companies", target_id)


def create_item(conn, resource, data, ctx=LOCAL, *, internal=False):
    res = check(resource)
    if res.no_create and not internal:
        raise ValidationError(f"{res.label}: si crea dalla sua sezione")
    if resource == "users" and not internal:
        raise Forbidden("Gli utenti si creano dalle impostazioni del team")
    with transaction(conn):
        record = validate(conn, res, data, partial=False)
        _check_unique(conn, res, record)
        now = now_iso()
        record = _finalize(conn, resource, record)
        record["created_at"] = record["updated_at"] = now
        cols = _columns(conn, resource)
        if "owner_id" in cols:
            record["owner_id"] = ctx.user_id
        if resource == "time_entries":
            record["user_id"] = ctx.user_id
        if resource == "tasks" and ctx.team and "assignee_id" not in data:
            record["assignee_id"] = ctx.user_id
        item_id = _insert(conn, resource, record)
        if resource == "contacts":
            _set_sm_customers(conn, item_id, data.get("sm_customer_ids"), record.get("is_service_manager"))
        title = record.get(res.title, "")
        log(conn, ctx, resource, item_id, "creato", title, customer_of(conn, res, item_id))
        item = get_item(conn, resource, item_id)
    return item


_COLS = {}


def _columns(conn, table):
    if table not in _COLS:
        _COLS[table] = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    return _COLS[table]


def can_write(conn, res, old, ctx):
    """Nel team: si modifica ciò che è visibile; gli elementi privati solo il proprietario."""
    if not ctx.team or ctx.is_admin or not res.visibility:
        return
    owner = old.get("owner_id") if res.visibility == "team" else old.get("owner_id", old.get("user_id"))
    if old.get("visibility") == "privato" and owner != ctx.user_id and old.get("assignee_id") != ctx.user_id:
        raise Forbidden("Elemento privato di un collega")


def update_item(conn, resource, item_id, data, ctx=LOCAL):
    res = check(resource)
    with transaction(conn):
        current = get_item(conn, resource, item_id, ctx)
        old = dict(conn.execute(f"SELECT * FROM {resource} WHERE id = ?", (current["id"],)).fetchone())
        can_write(conn, res, old, ctx)
        record = validate(conn, res, data, partial=True)
        _check_unique(conn, res, record, current["id"])
        record = _finalize(conn, resource, record, old)
        record["updated_at"] = now_iso()
        _update(conn, resource, current["id"], record)
        if resource == "companies" and "name" in record:
            _company_renamed(conn, old["name"], record["name"])
        if resource == "contacts" and ("sm_customer_ids" in data or "is_service_manager" in record):
            sm = record.get("is_service_manager", old.get("is_service_manager"))
            _set_sm_customers(conn, current["id"], data.get("sm_customer_ids"), sm, keep="sm_customer_ids" not in data)
        detail = _describe_changes(res, old, record)
        if detail:
            title = record.get(res.title, old.get(res.title, ""))
            action = "chiuso" if resource == "tasks" and record.get("status") == "chiuso" and old["status"] != "chiuso" else "modificato"
            log(conn, ctx, resource, current["id"], action, title, customer_of(conn, res, current["id"]), detail)
        if resource == "tasks":
            from . import ops  # import locale: ops usa crud
            ops.after_task_update(conn, old, record, ctx)
        item = get_item(conn, resource, current["id"])
    return item


def delete_item(conn, resource, item_id, ctx=LOCAL):
    res = check(resource)
    if resource == "users":
        raise Forbidden("Gli utenti non si eliminano: disattivali")
    with transaction(conn):
        current = get_item(conn, resource, item_id, ctx)
        old = dict(conn.execute(f"SELECT * FROM {resource} WHERE id = ?", (current["id"],)).fetchone())
        can_write(conn, res, old, ctx)
        customer = None if resource == "customers" else customer_of(conn, res, current["id"])
        if resource == "companies" and current.get("contacts_count"):
            raise ValidationError(f"«{current['name']}» è usata da {current['contacts_count']} contatti: uniscila a un'altra azienda invece di eliminarla")
        if resource == "tasks":
            cons = conn.execute("SELECT id FROM consultations WHERE task_id = ?", (current["id"],)).fetchone()
            if cons:
                conn.execute("DELETE FROM attachments WHERE entity_type = 'consultations' AND entity_id = ?", (cons[0],))
        conn.execute(f"DELETE FROM {resource} WHERE id = ?", (current["id"],))
        conn.execute("DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?", (resource, current["id"]))
        log(conn, ctx, resource, current["id"], "eliminato", current.get(res.title, ""), customer)


def _set_sm_customers(conn, contact_id, ids, is_sm, keep=False):
    if not is_sm:
        conn.execute("DELETE FROM service_manager_customers WHERE contact_id = ?", (contact_id,))
        return
    if keep or ids is None:
        return
    if not isinstance(ids, list):
        raise ValidationError("Clienti seguiti: elenco non valido")
    clean = {as_int(i, "Cliente") for i in ids if i not in (None, "")}
    for cid in clean:
        if not conn.execute("SELECT 1 FROM customers WHERE id = ?", (cid,)).fetchone():
            raise ValidationError("Clienti seguiti: cliente inesistente")
    conn.execute("DELETE FROM service_manager_customers WHERE contact_id = ?", (contact_id,))
    for cid in sorted(clean):
        conn.execute("INSERT INTO service_manager_customers (contact_id, customer_id) VALUES (?, ?)", (contact_id, cid))


# ---------------------------------------------------------------- utilità di date

def add_interval(d: date, unit: str, every: int) -> date:
    every = max(1, int(every or 1))
    if unit == "giorni":
        return d + timedelta(days=every)
    if unit == "settimane":
        return d + timedelta(weeks=every)
    if unit in ("mesi", "anni"):
        months = every if unit == "mesi" else every * 12
        y, m = divmod(d.month - 1 + months, 12)
        year, month = d.year + y, m + 1
        last = [31, 29 if year % 4 == 0 and (year % 100 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
        return date(year, month, min(d.day, last))
    return d


def next_workday(d: date) -> date:
    d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d
