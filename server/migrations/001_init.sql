-- Plancia: schema iniziale.
-- Convenzioni: date "AAAA-MM-GG", date e ore "AAAA-MM-GGTHH:MM" (ora locale).
-- owner_id = chi ha creato l'elemento; visibility = 'team' (visibile ai colleghi) o 'privato'.
-- In modalità personale esiste un solo utente e visibility non ha effetto.

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'membro' CHECK (role IN ('admin', 'membro')),
    active INTEGER NOT NULL DEFAULT 1,
    color TEXT NOT NULL DEFAULT '#0f766e',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    monthly_hours REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    is_consultant INTEGER NOT NULL DEFAULT 0,
    is_service_manager INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE service_manager_customers (
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, customer_id)
);

CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'in_pausa', 'chiuso')),
    color TEXT NOT NULL DEFAULT '#2456d3',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    "end" TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE meetings (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    series TEXT NOT NULL DEFAULT '',
    date TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    attendees TEXT NOT NULL DEFAULT '',
    agenda TEXT NOT NULL DEFAULT '',
    discussion TEXT NOT NULL DEFAULT '',
    decisions TEXT NOT NULL DEFAULT '',
    next_meeting TEXT NOT NULL DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'bassa')),
    status TEXT NOT NULL DEFAULT 'da_fare' CHECK (status IN ('da_fare', 'in_corso', 'in_attesa', 'chiuso')),
    start_date TEXT,
    due_date TEXT,
    planned_for TEXT,
    plan_order INTEGER NOT NULL DEFAULT 0,
    plan_time TEXT,
    estimate_min INTEGER,
    recurrence_unit TEXT NOT NULL DEFAULT 'nessuna' CHECK (recurrence_unit IN ('nessuna', 'giorni', 'settimane', 'mesi', 'anni')),
    recurrence_every INTEGER NOT NULL DEFAULT 1,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'consulenza')),
    closed_at TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE subtasks (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    outcome TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE consultations (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    consultant_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    date_start TEXT NOT NULL,
    date_end TEXT,
    location TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pianificata' CHECK (status IN ('pianificata', 'in_corso', 'chiusa')),
    closing_note TEXT NOT NULL DEFAULT '',
    closed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    system TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'altro' CHECK (kind IN ('nuovo_host', 'soglie', 'upgrade', 'regola', 'certificato', 'altro')),
    planned_at TEXT,
    executed_at TEXT,
    reason TEXT NOT NULL DEFAULT '',
    rollback_plan TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT 'pianificata' CHECK (outcome IN ('pianificata', 'eseguita', 'fallita', 'rollback', 'annullata')),
    notes TEXT NOT NULL DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Periodi in cui non si fanno modifiche (per un cliente o per tutti).
CREATE TABLE change_freezes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE deadlines (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    category TEXT NOT NULL DEFAULT 'altro' CHECK (category IN ('certificato', 'licenza', 'contratto', 'manutenzione', 'verifica', 'altro')),
    due_date TEXT NOT NULL,
    recurrence_unit TEXT NOT NULL DEFAULT 'nessuna' CHECK (recurrence_unit IN ('nessuna', 'giorni', 'settimane', 'mesi', 'anni')),
    recurrence_every INTEGER NOT NULL DEFAULT 1,
    notice_days INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'attiva' CHECK (status IN ('attiva', 'fatta', 'annullata')),
    done_date TEXT,
    previous_id INTEGER REFERENCES deadlines(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE waiting_items (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    who TEXT NOT NULL DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    ticket_ref TEXT NOT NULL DEFAULT '',
    requested_on TEXT NOT NULL,
    follow_up_on TEXT,
    follow_ups INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_attesa' CHECK (status IN ('in_attesa', 'ricevuto', 'annullato')),
    closed_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE inbox_items (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    processed_at TEXT,
    converted_type TEXT,
    converted_id INTEGER,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE checklist_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE checklist_runs (
    id INTEGER PRIMARY KEY,
    template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    change_id INTEGER REFERENCES changes(id) ON DELETE SET NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sticky_notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'giallo' CHECK (color IN ('giallo', 'verde', 'blu', 'rosa', 'viola', 'arancio')),
    pinned INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'privato' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Ore lavorate: da timer (started_at senza ended_at = timer in corso) o inserite a mano.
CREATE TABLE time_entries (
    id INTEGER PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    minutes INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Storico: chi ha fatto cosa e quando (alimenta la pagina cliente e lo storico dei task).
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resource TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
    name TEXT NOT NULL,
    url TEXT,
    stored_name TEXT UNIQUE,
    mime TEXT,
    size INTEGER,
    created_at TEXT NOT NULL,
    CHECK ((kind = 'file' AND stored_name IS NOT NULL) OR (kind = 'link' AND url IS NOT NULL))
);
CREATE TABLE attachment_trash (stored_name TEXT PRIMARY KEY);
CREATE TABLE attachment_mirror_deletions (stored_name TEXT PRIMARY KEY);

CREATE TRIGGER trg_attachments_trash AFTER DELETE ON attachments WHEN OLD.kind = 'file'
BEGIN
    INSERT OR IGNORE INTO attachment_trash (stored_name) VALUES (OLD.stored_name);
END;

CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
CREATE INDEX idx_tasks_planned ON tasks(planned_for, plan_order);
CREATE INDEX idx_tasks_customer ON tasks(customer_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_meeting ON tasks(meeting_id);
CREATE INDEX idx_subtasks_task ON subtasks(task_id, position);
CREATE INDEX idx_events_start ON events(start);
CREATE INDEX idx_meetings_date ON meetings(date);
CREATE INDEX idx_meetings_series ON meetings(series, date);
CREATE INDEX idx_consultations_date ON consultations(date_start);
CREATE INDEX idx_changes_planned ON changes(customer_id, planned_at);
CREATE INDEX idx_deadlines_status_due ON deadlines(status, due_date);
CREATE INDEX idx_waiting_status ON waiting_items(status, follow_up_on);
CREATE INDEX idx_inbox_processed ON inbox_items(processed_at, created_at);
CREATE INDEX idx_time_date ON time_entries(date, user_id);
CREATE INDEX idx_time_task ON time_entries(task_id);
CREATE INDEX idx_time_customer ON time_entries(customer_id, date);
CREATE INDEX idx_log_customer ON activity_log(customer_id, at);
CREATE INDEX idx_log_item ON activity_log(resource, item_id);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE INDEX idx_sm_customer ON service_manager_customers(customer_id);
