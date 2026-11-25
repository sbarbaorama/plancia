-- Procedure: piccola documentazione da cercare e copiare (procedure, script, appunti tecnici).
CREATE TABLE procedures (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'privato')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_procedures_category ON procedures(category);

-- Consulenze ricorrenti: quando si chiude la giornata nasce la prossima (con le attività non chiuse).
ALTER TABLE consultations ADD COLUMN next_mode TEXT NOT NULL DEFAULT 'nessuna'
    CHECK (next_mode IN ('nessuna', 'settimana', 'mese', 'data'));
ALTER TABLE consultations ADD COLUMN next_date TEXT;
ALTER TABLE consultations ADD COLUMN carry_open INTEGER NOT NULL DEFAULT 1;
ALTER TABLE consultations ADD COLUMN next_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL;
