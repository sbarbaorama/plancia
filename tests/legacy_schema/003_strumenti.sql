CREATE TABLE inbox_items (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    processed_at TEXT,
    converted_type TEXT CHECK (converted_type IS NULL OR converted_type IN ('tasks', 'incidents', 'changes', 'waiting_items')),
    converted_id INTEGER,
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_inbox_processed ON inbox_items(processed_at, created_at);
CREATE INDEX idx_runs_started ON checklist_runs(started_at);
