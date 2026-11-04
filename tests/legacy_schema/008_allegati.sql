CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('tasks', 'meetings', 'consultations', 'projects', 'customers', 'contacts',
                                                     'changes', 'deadlines', 'waiting_items', 'sticky_notes', 'events')),
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

CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- File da cancellare dal disco: li svuota il server dopo che la modifica è stata confermata.
CREATE TABLE attachment_trash (stored_name TEXT PRIMARY KEY);

CREATE TRIGGER trg_attachments_trash AFTER DELETE ON attachments WHEN OLD.kind = 'file'
BEGIN
    INSERT OR IGNORE INTO attachment_trash (stored_name) VALUES (OLD.stored_name);
END;

-- Eliminando un elemento (anche a cascata) se ne eliminano gli allegati.
CREATE TRIGGER trg_tasks_attachments AFTER DELETE ON tasks
BEGIN
    DELETE FROM attachments WHERE entity_type = 'tasks' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_meetings_attachments AFTER DELETE ON meetings
BEGIN
    DELETE FROM attachments WHERE entity_type = 'meetings' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_consultations_attachments AFTER DELETE ON consultations
BEGIN
    DELETE FROM attachments WHERE entity_type = 'consultations' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_projects_attachments AFTER DELETE ON projects
BEGIN
    DELETE FROM attachments WHERE entity_type = 'projects' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_customers_attachments AFTER DELETE ON customers
BEGIN
    DELETE FROM attachments WHERE entity_type = 'customers' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_contacts_attachments AFTER DELETE ON contacts
BEGIN
    DELETE FROM attachments WHERE entity_type = 'contacts' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_changes_attachments AFTER DELETE ON changes
BEGIN
    DELETE FROM attachments WHERE entity_type = 'changes' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_deadlines_attachments AFTER DELETE ON deadlines
BEGIN
    DELETE FROM attachments WHERE entity_type = 'deadlines' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_waiting_items_attachments AFTER DELETE ON waiting_items
BEGIN
    DELETE FROM attachments WHERE entity_type = 'waiting_items' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_sticky_notes_attachments AFTER DELETE ON sticky_notes
BEGIN
    DELETE FROM attachments WHERE entity_type = 'sticky_notes' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_events_attachments AFTER DELETE ON events
BEGIN
    DELETE FROM attachments WHERE entity_type = 'events' AND entity_id = OLD.id;
END;
