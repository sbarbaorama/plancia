ALTER TABLE contacts ADD COLUMN is_consultant INTEGER NOT NULL DEFAULT 0;

CREATE TABLE consultations (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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

CREATE INDEX idx_consultations_date ON consultations(date_start);
CREATE INDEX idx_consultations_task ON consultations(task_id);
CREATE INDEX idx_consultations_consultant ON consultations(consultant_id);
