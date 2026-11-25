-- Appuntamenti ricorrenti: ogni ripetizione è un appuntamento a sé, legato alle altre dal gruppo.
-- "series" collega l'appuntamento a una serie di riunioni (il verbale nasce già nella serie).

ALTER TABLE events ADD COLUMN recurrence_unit TEXT NOT NULL DEFAULT 'nessuna';
ALTER TABLE events ADD COLUMN recurrence_every INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN recurrence_until TEXT;
ALTER TABLE events ADD COLUMN recurrence_group TEXT;
ALTER TABLE events ADD COLUMN series TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_events_group ON events(recurrence_group);
