CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'in_pausa', 'chiuso')),
    color TEXT NOT NULL DEFAULT '#3b6fd8',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    start TEXT NOT NULL DEFAULT '',
    "end" TEXT NOT NULL DEFAULT '',
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE meetings (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT '',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    attendees TEXT NOT NULL DEFAULT '',
    agenda TEXT NOT NULL DEFAULT '',
    discussion TEXT NOT NULL DEFAULT '',
    decisions TEXT NOT NULL DEFAULT '',
    next_meeting TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'bassa')),
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'da_fare' CHECK (status IN ('da_fare', 'in_corso', 'chiuso')),
    closed_at TEXT,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
    owner TEXT NOT NULL DEFAULT 'io',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
CREATE INDEX idx_events_start ON events(start);
CREATE INDEX idx_meetings_date ON meetings(date);
