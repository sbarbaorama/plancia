CREATE TABLE sticky_notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'giallo' CHECK (color IN ('giallo', 'verde', 'blu', 'rosa', 'viola', 'arancio')),
    pinned INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_sticky_order ON sticky_notes(pinned, position);
