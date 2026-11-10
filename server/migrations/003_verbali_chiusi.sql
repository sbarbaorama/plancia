-- Verbali attivi o chiusi: quelli chiusi spariscono dall'elenco predefinito delle riunioni.

ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'attiva' CHECK (status IN ('attiva', 'chiusa'));
ALTER TABLE meetings ADD COLUMN closed_at TEXT;
CREATE INDEX idx_meetings_status ON meetings(status);
