-- Task collegati a una consulenza: il task resta un task, ma compare nella consulenza
-- (e nel rapportino); chiudendo la giornata quelli ancora aperti passano alla consulenza successiva.

ALTER TABLE tasks ADD COLUMN linked_consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_linked_consultation ON tasks(linked_consultation_id);
