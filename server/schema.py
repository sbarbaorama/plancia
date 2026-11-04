"""Registro delle risorse: UNA scheda per sezione, con tutto quello che serve.

Ogni scheda descrive campi modificabili, query di lettura, ordinamento, ricerca, colonna del cliente,
visibilità nel team e layout del modulo di modifica. Aggiungere una sezione = aggiungere una scheda.

Tipi di campo: text, company (testo scelto dall'elenco delle aziende), longtext, enum, fk, date, datetime, time, int, bool, email, color, steps.
"""
from dataclasses import dataclass, field

VIS = ("team", "privato")
RECURRENCE = ("nessuna", "giorni", "settimane", "mesi", "anni")

# Etichette leggibili per i valori delle enum (l'interfaccia le mostra al posto del valore grezzo).
ENUM_LABELS = {
    "attivo": "Attivo", "in_pausa": "In pausa", "chiuso": "Chiuso",
    "alta": "Alta", "media": "Media", "bassa": "Bassa",
    "da_fare": "Da fare", "in_corso": "In corso", "in_attesa": "In attesa",
    "nessuna": "Nessuna", "giorni": "Giorni", "settimane": "Settimane", "mesi": "Mesi", "anni": "Anni",
    "team": "Team", "privato": "Privato",
    "nuovo_host": "Nuovo host", "soglie": "Soglie", "upgrade": "Upgrade", "regola": "Regola",
    "certificato": "Certificato", "altro": "Altro",
    "pianificata": "Pianificata", "eseguita": "Eseguita", "fallita": "Fallita", "rollback": "Rollback",
    "annullata": "Annullata", "licenza": "Licenza", "contratto": "Contratto", "manutenzione": "Manutenzione",
    "verifica": "Verifica", "attiva": "Attiva", "fatta": "Fatta", "ricevuto": "Ricevuto", "annullato": "Annullato",
    "chiusa": "Chiusa", "giallo": "Giallo", "verde": "Verde", "blu": "Blu", "rosa": "Rosa", "viola": "Viola",
    "arancio": "Arancio", "task": "Task", "consulenza": "Consulenza", "admin": "Amministratore", "membro": "Membro",
}


@dataclass
class Resource:
    name: str
    label: str            # "Task", "Scadenza"…
    alias: str            # alias SQL della tabella
    fields: dict          # nome -> (tipo, etichetta, opzioni)
    select: str           # SELECT con i campi calcolati utili all'interfaccia
    order: str
    required: tuple = ()
    title: str = "title"
    search: tuple = ()
    customer_col: str = ""          # espressione SQL del cliente (anche ereditato)
    date_col: str = ""              # colonna per i filtri from/to
    date_end_col: str = ""          # se c'è, il periodo è date_col..date_end_col
    visibility: str = ""            # "team": owner/assignee/visibility; "own": solo il proprietario
    attachments: bool = True
    log: bool = True
    no_create: bool = False         # si crea solo con operazioni dedicate
    json_cols: tuple = ()
    unique: str = ""
    form: list = field(default_factory=list)   # layout del modulo: righe di nomi di campo
    defaults: dict = field(default_factory=dict)

    @property
    def table(self):
        return self.name


def _att(entity, alias):
    return f"(SELECT COUNT(*) FROM attachments x WHERE x.entity_type = '{entity}' AND x.entity_id = {alias}.id) AS attachments_count"


R = {}


def add(res: Resource):
    R[res.name] = res


add(Resource(
    "customers", "Cliente", "cu",
    fields={
        "name": ("text", "Nome", None), "code": ("text", "Sigla", None),
        "active": ("bool", "Attivo", None), "monthly_hours": ("float", "Ore mensili a contratto", (0, 10000)),
        "notes": ("longtext", "Note", None),
    },
    required=("name",), title="name", unique="name",
    select=f"""SELECT cu.*,
        (SELECT COUNT(*) FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
          WHERE COALESCE(t.customer_id, p.customer_id) = cu.id AND t.status != 'chiuso') AS open_tasks,
        (SELECT COUNT(*) FROM deadlines d WHERE d.customer_id = cu.id AND d.status = 'attiva'
          AND date(d.due_date, '-' || d.notice_days || ' days') <= date('now', 'localtime')) AS deadlines_due,
        (SELECT COUNT(*) FROM waiting_items w WHERE w.customer_id = cu.id AND w.status = 'in_attesa') AS open_waits,
        (SELECT COUNT(*) FROM projects p WHERE p.customer_id = cu.id AND p.status != 'chiuso') AS projects_count,
        {_att('customers', 'cu')}
        FROM customers cu""",
    order="cu.active DESC, casefold(cu.name)",
    search=("name", "code", "notes"), customer_col="cu.id",
    form=[["name", "code"], ["active", "monthly_hours"], ["notes"]],
    defaults={"active": 1},
))

add(Resource(
    "contacts", "Contatto", "co",
    fields={
        "first_name": ("text", "Nome", None), "last_name": ("text", "Cognome", None),
        "name": ("text", "Nome completo", None), "company": ("company", "Azienda", None),
        "customer_id": ("fk", "Cliente", "customers"), "role": ("text", "Ruolo", None),
        "email": ("email", "Email", None), "phone": ("text", "Telefono", None),
        "is_consultant": ("bool", "Consulente", None), "is_service_manager": ("bool", "Service manager", None),
        "notes": ("longtext", "Note", None),
    },
    title="name",
    select=f"""SELECT co.*, cu.name AS customer_name, cu.code AS customer_code,
        (SELECT json_group_array(json_object('id', s.customer_id, 'name', c2.name))
            FROM service_manager_customers s JOIN customers c2 ON c2.id = s.customer_id
            WHERE s.contact_id = co.id) AS sm_customers,
        {_att('contacts', 'co')}
        FROM contacts co LEFT JOIN customers cu ON cu.id = co.customer_id""",
    order="casefold(COALESCE(NULLIF(co.last_name, ''), co.first_name, co.name)), casefold(co.first_name)",
    search=("name", "first_name", "last_name", "company", "role", "email", "phone", "notes"), customer_col="co.customer_id",
    form=[["first_name", "last_name"], ["company", "role"], ["customer_id"], ["email", "phone"], ["is_consultant", "is_service_manager"], ["notes"]],
))

add(Resource(
    "companies", "Azienda", "cm",
    fields={"name": ("text", "Nome", None)},
    required=("name",), title="name", unique="name",
    select="""SELECT cm.*, (SELECT COUNT(*) FROM contacts co WHERE casefold(co.company) = casefold(cm.name)) AS contacts_count
        FROM companies cm""",
    order="casefold(cm.name)", search=("name",), attachments=False, log=False,
))

add(Resource(
    "projects", "Progetto", "p",
    fields={
        "name": ("text", "Nome", None), "customer_id": ("fk", "Cliente", "customers"),
        "status": ("enum", "Stato", ("attivo", "in_pausa", "chiuso")), "color": ("color", "Colore", None),
        "description": ("longtext", "Descrizione", None), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("name",), title="name",
    select=f"""SELECT p.*, cu.name AS customer_name, cu.code AS customer_code,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'chiuso') AS open_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'chiuso') AS closed_tasks,
        (SELECT COUNT(*) FROM meetings m WHERE m.project_id = p.id) AS meetings_count,
        (SELECT MIN(t.due_date) FROM tasks t WHERE t.project_id = p.id AND t.status != 'chiuso') AS next_due,
        {_att('projects', 'p')}
        FROM projects p LEFT JOIN customers cu ON cu.id = p.customer_id""",
    order="CASE p.status WHEN 'attivo' THEN 0 WHEN 'in_pausa' THEN 1 ELSE 2 END, casefold(p.name)",
    search=("name", "description"), customer_col="p.customer_id", visibility="team",
    form=[["name"], ["customer_id", "status"], ["color", "visibility"], ["description"]],
    defaults={"status": "attivo", "color": "#2456d3", "visibility": "team"},
))

add(Resource(
    "tasks", "Task", "t",
    fields={
        "title": ("text", "Titolo", None), "notes": ("longtext", "Note", None),
        "customer_id": ("fk", "Cliente", "customers"), "project_id": ("fk", "Progetto", "projects"),
        "priority": ("enum", "Priorità", ("alta", "media", "bassa")),
        "status": ("enum", "Stato", ("da_fare", "in_corso", "in_attesa", "chiuso")),
        "start_date": ("date", "Inizio", None), "due_date": ("date", "Scadenza", None),
        "planned_for": ("date", "Pianificato per", None), "plan_order": ("int", "Ordine", (0, 1000000)),
        "plan_time": ("time", "Ora", None),
        "estimate_min": ("int", "Stima (minuti)", (0, 100000)),
        "recurrence_unit": ("enum", "Ripeti", RECURRENCE), "recurrence_every": ("int", "Ogni", (1, 1000)),
        "meeting_id": ("fk", "Verbale", "meetings"),
        "assignee_id": ("fk", "Assegnato a", "users"), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("title",),
    select=f"""SELECT t.*, p.name AS project_name, p.color AS project_color, m.title AS meeting_title,
        COALESCE(t.customer_id, p.customer_id) AS eff_customer_id,
        cu.name AS customer_name, cu.code AS customer_code,
        ua.name AS assignee_name, uo.name AS owner_name,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtasks_total,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtasks_done,
        (SELECT cn.id FROM consultations cn WHERE cn.task_id = t.id) AS consultation_id,
        (SELECT COALESCE(SUM(te.minutes), 0) FROM time_entries te WHERE te.task_id = t.id) AS minutes_spent,
        {_att('tasks', 't')}
        FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN meetings m ON m.id = t.meeting_id
        LEFT JOIN customers cu ON cu.id = COALESCE(t.customer_id, p.customer_id)
        LEFT JOIN users ua ON ua.id = t.assignee_id
        LEFT JOIN users uo ON uo.id = t.owner_id""",
    order="t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, t.id",
    search=("title", "notes"), customer_col="COALESCE(t.customer_id, p.customer_id)",
    date_col="t.start_date", visibility="team",
    form=[["title"], ["customer_id", "project_id"], ["priority", "status"], ["start_date", "due_date"],
          ["estimate_min", "planned_for"], ["recurrence_unit", "recurrence_every"], ["assignee_id", "visibility"], ["notes"]],
    defaults={"priority": "media", "status": "da_fare", "recurrence_unit": "nessuna", "recurrence_every": 1, "visibility": "team"},
))

add(Resource(
    "subtasks", "Sotto-task", "s",
    fields={
        "task_id": ("fk", "Task", "tasks"), "position": ("int", "Posizione", (0, 100000)),
        "title": ("text", "Titolo", None), "done": ("bool", "Fatto", None), "outcome": ("text", "Esito", None),
    },
    required=("task_id", "title"),
    select="SELECT s.* FROM subtasks s", order="s.task_id, s.position, s.id",
    attachments=False, log=False, no_create=True,
))

add(Resource(
    "events", "Appuntamento", "e",
    fields={
        "title": ("text", "Titolo", None), "start": ("datetime", "Inizio", None), "end": ("datetime", "Fine", None),
        "all_day": ("bool", "Tutto il giorno", None), "location": ("text", "Luogo", None),
        "customer_id": ("fk", "Cliente", "customers"), "project_id": ("fk", "Progetto", "projects"),
        "notes": ("longtext", "Note", None), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("title", "start"),
    select=f"""SELECT e.*, p.name AS project_name, p.color AS project_color,
        cu.name AS customer_name, cu.code AS customer_code,
        (SELECT id FROM meetings m WHERE m.event_id = e.id ORDER BY m.id LIMIT 1) AS meeting_id,
        {_att('events', 'e')}
        FROM events e LEFT JOIN projects p ON p.id = e.project_id
        LEFT JOIN customers cu ON cu.id = COALESCE(e.customer_id, p.customer_id)""",
    order="e.start, e.id", search=("title", "location", "notes"),
    customer_col="COALESCE(e.customer_id, p.customer_id)", date_col="e.start", date_end_col="COALESCE(NULLIF(e.\"end\", ''), e.start)",
    visibility="team",
    form=[["title"], ["start", "end"], ["all_day", "location"], ["customer_id", "project_id"], ["visibility"], ["notes"]],
    defaults={"visibility": "team"},
))

add(Resource(
    "meetings", "Verbale", "m",
    fields={
        "title": ("text", "Titolo", None), "series": ("text", "Serie (riunioni ricorrenti)", None),
        "date": ("datetime", "Data", None),
        "customer_id": ("fk", "Cliente", "customers"), "project_id": ("fk", "Progetto", "projects"),
        "event_id": ("fk", "Appuntamento", "events"),
        "attendees": ("longtext", "Partecipanti", None), "agenda": ("longtext", "Ordine del giorno", None),
        "discussion": ("longtext", "Discussione", None), "decisions": ("longtext", "Decisioni", None),
        "next_meeting": ("text", "Prossimo incontro", None), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("title",),
    select=f"""SELECT m.*, p.name AS project_name, p.color AS project_color,
        cu.name AS customer_name, cu.code AS customer_code,
        (SELECT COUNT(*) FROM tasks t WHERE t.meeting_id = m.id) AS actions_total,
        (SELECT COUNT(*) FROM tasks t WHERE t.meeting_id = m.id AND t.status != 'chiuso') AS actions_open,
        {_att('meetings', 'm')}
        FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
        LEFT JOIN customers cu ON cu.id = COALESCE(m.customer_id, p.customer_id)""",
    order="m.date DESC, m.id DESC",
    search=("title", "series", "attendees", "agenda", "discussion", "decisions", "next_meeting"),
    customer_col="COALESCE(m.customer_id, p.customer_id)", date_col="m.date", visibility="team",
    defaults={"visibility": "team"},
))

add(Resource(
    "consultations", "Consulenza", "cn",
    fields={
        "consultant_id": ("fk", "Consulente", "contacts"), "customer_id": ("fk", "Cliente", "customers"),
        "date_start": ("date", "Data", None), "date_end": ("date", "Fino al", None),
        "location": ("text", "Luogo", None),
        "status": ("enum", "Stato", ("pianificata", "in_corso", "chiusa")),
        "closing_note": ("longtext", "Nota di chiusura", None),
    },
    required=("date_start",),
    select=f"""SELECT cn.*, co.name AS consultant_name, co.company AS consultant_company,
        co.email AS consultant_email, co.phone AS consultant_phone,
        cu.name AS customer_name, cu.code AS customer_code,
        t.title AS title, t.project_id AS project_id, p.name AS project_name, t.notes AS notes,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = cn.task_id) AS activities_total,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = cn.task_id AND s.done = 1) AS activities_done,
        {_att('consultations', 'cn')}
        FROM consultations cn LEFT JOIN contacts co ON co.id = cn.consultant_id
        LEFT JOIN customers cu ON cu.id = cn.customer_id
        LEFT JOIN tasks t ON t.id = cn.task_id
        LEFT JOIN projects p ON p.id = t.project_id""",
    order="cn.date_start DESC, cn.id DESC", title="location",
    search=("location", "closing_note"), customer_col="cn.customer_id",
    date_col="cn.date_start", date_end_col="COALESCE(cn.date_end, cn.date_start)", no_create=True,
))

add(Resource(
    "changes", "Modifica", "ch",
    fields={
        "title": ("text", "Titolo", None), "customer_id": ("fk", "Cliente", "customers"),
        "system": ("text", "Sistema", None),
        "kind": ("enum", "Tipo", ("nuovo_host", "soglie", "upgrade", "regola", "certificato", "altro")),
        "planned_at": ("datetime", "Prevista", None), "executed_at": ("datetime", "Eseguita", None),
        "outcome": ("enum", "Esito", ("pianificata", "eseguita", "fallita", "rollback", "annullata")),
        "reason": ("longtext", "Motivo", None), "rollback_plan": ("longtext", "Piano di rollback", None),
        "notes": ("longtext", "Note", None), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("title",),
    select=f"""SELECT ch.*, cu.name AS customer_name, cu.code AS customer_code, uo.name AS owner_name,
        {_att('changes', 'ch')}
        FROM changes ch LEFT JOIN customers cu ON cu.id = ch.customer_id
        LEFT JOIN users uo ON uo.id = ch.owner_id""",
    order="COALESCE(ch.executed_at, ch.planned_at, ch.created_at) DESC, ch.id DESC",
    search=("title", "system", "reason", "rollback_plan", "notes"), customer_col="ch.customer_id",
    date_col="COALESCE(ch.executed_at, ch.planned_at)", visibility="team",
    form=[["title"], ["customer_id", "system"], ["kind", "outcome"], ["planned_at", "executed_at"],
          ["reason"], ["rollback_plan"], ["notes"], ["visibility"]],
    defaults={"kind": "altro", "outcome": "pianificata", "visibility": "team"},
))

add(Resource(
    "change_freezes", "Blocco modifiche", "fz",
    fields={
        "title": ("text", "Motivo", None), "customer_id": ("fk", "Cliente (vuoto = tutti)", "customers"),
        "start_date": ("date", "Dal", None), "end_date": ("date", "Al", None), "notes": ("longtext", "Note", None),
    },
    required=("title", "start_date", "end_date"),
    select="""SELECT fz.*, cu.name AS customer_name, cu.code AS customer_code
        FROM change_freezes fz LEFT JOIN customers cu ON cu.id = fz.customer_id""",
    order="fz.start_date DESC, fz.id DESC", search=("title", "notes"),
    customer_col="fz.customer_id", date_col="fz.start_date", date_end_col="fz.end_date", attachments=False,
    form=[["title"], ["customer_id"], ["start_date", "end_date"], ["notes"]],
))

add(Resource(
    "deadlines", "Scadenza", "d",
    fields={
        "title": ("text", "Titolo", None), "customer_id": ("fk", "Cliente", "customers"),
        "category": ("enum", "Categoria", ("certificato", "licenza", "contratto", "manutenzione", "verifica", "altro")),
        "due_date": ("date", "Scadenza", None),
        "recurrence_unit": ("enum", "Ripeti", RECURRENCE), "recurrence_every": ("int", "Ogni", (1, 1000)),
        "notice_days": ("int", "Preavviso (giorni)", (0, 365)),
        "status": ("enum", "Stato", ("attiva", "fatta", "annullata")), "done_date": ("date", "Fatta il", None),
        "notes": ("longtext", "Note", None), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("title", "due_date"),
    select=f"""SELECT d.*, cu.name AS customer_name, cu.code AS customer_code,
        CAST(julianday(d.due_date) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left,
        {_att('deadlines', 'd')}
        FROM deadlines d LEFT JOIN customers cu ON cu.id = d.customer_id""",
    order="d.due_date, d.id", search=("title", "notes"), customer_col="d.customer_id",
    date_col="d.due_date", visibility="team",
    form=[["title"], ["customer_id", "category"], ["due_date", "notice_days"],
          ["recurrence_unit", "recurrence_every"], ["visibility"], ["notes"]],
    defaults={"category": "altro", "recurrence_unit": "nessuna", "recurrence_every": 1, "notice_days": 30,
              "status": "attiva", "visibility": "team"},
))

add(Resource(
    "waiting_items", "Attesa", "w",
    fields={
        "title": ("text", "Cosa aspetto", None), "contact_id": ("fk", "Contatto", "contacts"),
        "who": ("text", "Da chi (se non è in rubrica)", None), "customer_id": ("fk", "Cliente", "customers"),
        "ticket_ref": ("text", "Ticket", None), "requested_on": ("date", "Richiesto il", None),
        "follow_up_on": ("date", "Sollecito", None),
        "status": ("enum", "Stato", ("in_attesa", "ricevuto", "annullato")),
        "notes": ("longtext", "Note", None), "visibility": ("enum", "Visibilità", VIS),
    },
    required=("title",),
    select=f"""SELECT w.*, cu.name AS customer_name, cu.code AS customer_code,
        co.name AS contact_name, co.email AS contact_email,
        CAST(julianday(date('now', 'localtime')) - julianday(w.requested_on) AS INTEGER) AS days_waiting,
        {_att('waiting_items', 'w')}
        FROM waiting_items w LEFT JOIN customers cu ON cu.id = w.customer_id
        LEFT JOIN contacts co ON co.id = w.contact_id""",
    order="w.follow_up_on IS NULL, w.follow_up_on, w.requested_on, w.id",
    search=("title", "who", "ticket_ref", "notes"), customer_col="w.customer_id",
    date_col="w.follow_up_on", visibility="team",
    form=[["title"], ["contact_id", "who"], ["customer_id", "ticket_ref"], ["requested_on", "follow_up_on"],
          ["status", "visibility"], ["notes"]],
    defaults={"status": "in_attesa", "visibility": "team"},
))

add(Resource(
    "inbox_items", "Nota", "n",
    fields={"text": ("longtext", "Testo", None)},
    required=("text",), title="text",
    select="SELECT n.* FROM inbox_items n", order="n.created_at DESC, n.id DESC",
    search=("text",), visibility="own", attachments=False, log=False,
))

add(Resource(
    "checklist_templates", "Modello di checklist", "ct",
    fields={"name": ("text", "Nome", None), "description": ("longtext", "Descrizione", None),
            "steps": ("steps", "Passi", None)},
    required=("name", "steps"), title="name",
    select="SELECT ct.* FROM checklist_templates ct", order="casefold(ct.name)",
    search=("name", "description"), json_cols=("steps",), attachments=False,
))

add(Resource(
    "checklist_runs", "Checklist", "cr",
    fields={"customer_id": ("fk", "Cliente", "customers"), "change_id": ("fk", "Modifica", "changes"),
            "notes": ("longtext", "Note", None)},
    title="name",
    select="""SELECT cr.*, cu.name AS customer_name, cu.code AS customer_code, ch.title AS change_title
        FROM checklist_runs cr LEFT JOIN customers cu ON cu.id = cr.customer_id
        LEFT JOIN changes ch ON ch.id = cr.change_id""",
    order="cr.completed_at IS NOT NULL, cr.started_at DESC, cr.id DESC",
    customer_col="cr.customer_id", json_cols=("steps",), no_create=True, attachments=False,
))

add(Resource(
    "sticky_notes", "Post-it", "sn",
    fields={
        "title": ("text", "Titolo", None), "body": ("longtext", "Testo", None), "command": ("longtext", "Comando", None),
        "color": ("enum", "Colore", ("giallo", "verde", "blu", "rosa", "viola", "arancio")),
        "pinned": ("bool", "Fissato in alto", None),
        "customer_id": ("fk", "Cliente", "customers"), "project_id": ("fk", "Progetto", "projects"),
        "visibility": ("enum", "Visibilità", VIS),
    },
    select=f"""SELECT sn.*, p.name AS project_name, cu.name AS customer_name, cu.code AS customer_code,
        {_att('sticky_notes', 'sn')}
        FROM sticky_notes sn LEFT JOIN projects p ON p.id = sn.project_id
        LEFT JOIN customers cu ON cu.id = sn.customer_id""",
    order="sn.pinned DESC, sn.position, sn.id DESC",
    search=("title", "body", "command"), customer_col="sn.customer_id", visibility="team",
    form=[["title"], ["body"], ["command"], ["color", "pinned"], ["customer_id", "project_id"], ["visibility"]],
    defaults={"color": "giallo", "visibility": "privato"},
))

add(Resource(
    "time_entries", "Ore", "te",
    fields={
        "task_id": ("fk", "Task", "tasks"), "customer_id": ("fk", "Cliente", "customers"),
        "project_id": ("fk", "Progetto", "projects"), "date": ("date", "Giorno", None),
        "minutes": ("int", "Minuti", (0, 1440)), "note": ("text", "Nota", None),
    },
    required=("date",), title="note",
    select="""SELECT te.*, t.title AS task_title, cu.name AS customer_name, cu.code AS customer_code,
        p.name AS project_name, u.name AS user_name
        FROM time_entries te LEFT JOIN tasks t ON t.id = te.task_id
        LEFT JOIN customers cu ON cu.id = te.customer_id
        LEFT JOIN projects p ON p.id = te.project_id
        LEFT JOIN users u ON u.id = te.user_id""",
    order="te.date DESC, te.started_at DESC, te.id DESC", search=("note",),
    customer_col="te.customer_id", date_col="te.date", visibility="own", attachments=False, log=False,
    form=[["date", "minutes"], ["task_id"], ["customer_id", "project_id"], ["note"]],
))

add(Resource(
    "users", "Utente", "u",
    fields={
        "name": ("text", "Nome", None), "username": ("text", "Nome utente", None),
        "role": ("enum", "Ruolo", ("admin", "membro")), "active": ("bool", "Attivo", None),
        "color": ("color", "Colore", None),
    },
    required=("name", "username"), title="name", unique="username",
    select="SELECT u.id, u.name, u.username, u.role, u.active, u.color, u.created_at, u.updated_at, "
           "(u.password_hash != '') AS has_password FROM users u",
    order="u.active DESC, casefold(u.name)", attachments=False,
))

# Sezioni che possono avere allegati (e che il backup/import conosce).
ATTACHMENT_TYPES = tuple(n for n, r in R.items() if r.attachments)

# Ordine di inserimento che rispetta le chiavi esterne.
TABLE_ORDER = (
    "users", "customers", "companies", "contacts", "projects", "events", "meetings", "tasks", "subtasks", "consultations",
    "changes", "change_freezes", "deadlines", "waiting_items", "inbox_items", "checklist_templates",
    "checklist_runs", "sticky_notes", "time_entries",
)


def public_schema():
    """Descrizione dei campi per l'interfaccia (moduli generici)."""
    out = {}
    for name, r in R.items():
        out[name] = {
            "label": r.label, "title": r.title, "required": list(r.required), "form": r.form,
            "defaults": r.defaults, "visibility": r.visibility, "attachments": r.attachments,
            "fields": {f: {"type": k, "label": lab, "options": list(opt) if isinstance(opt, tuple) and k == "enum" else opt}
                       for f, (k, lab, opt) in r.fields.items()},
        }
    return {"resources": out, "enum_labels": ENUM_LABELS}
