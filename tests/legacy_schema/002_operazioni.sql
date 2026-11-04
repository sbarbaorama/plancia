CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE incidents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    system TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'media' CHECK (severity IN ('critica', 'alta', 'media', 'bassa')),
    status TEXT NOT NULL DEFAULT 'aperto' CHECK (status IN ('aperto', 'in_analisi', 'risolto', 'chiuso')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    impact TEXT NOT NULL DEFAULT '',
    cause TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    system TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'altro' CHECK (kind IN ('nuovo_host', 'soglie', 'upgrade', 'regola', 'altro')),
    planned_at TEXT,
    executed_at TEXT,
    reason TEXT NOT NULL DEFAULT '',
    rollback_plan TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT 'pianificata' CHECK (outcome IN ('pianificata', 'eseguita', 'fallita', 'annullata')),
    incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
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
    recurrence_unit TEXT NOT NULL DEFAULT 'nessuna' CHECK (recurrence_unit IN ('nessuna', 'giorni', 'mesi', 'anni')),
    recurrence_every INTEGER NOT NULL DEFAULT 1,
    notice_days INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'attiva' CHECK (status IN ('attiva', 'fatta', 'annullata')),
    done_date TEXT,
    previous_id INTEGER REFERENCES deadlines(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
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
    status TEXT NOT NULL DEFAULT 'in_attesa' CHECK (status IN ('in_attesa', 'ricevuto', 'annullato')),
    closed_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE projects ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL;

CREATE INDEX idx_incidents_status ON incidents(status, started_at);
CREATE INDEX idx_deadlines_status_due ON deadlines(status, due_date);
CREATE INDEX idx_waiting_status ON waiting_items(status, follow_up_on);
CREATE INDEX idx_changes_outcome ON changes(outcome, planned_at);
