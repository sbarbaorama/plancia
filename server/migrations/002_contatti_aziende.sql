-- Contatti: nome e cognome separati; elenco delle aziende per il menu a tendina.

ALTER TABLE contacts ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN last_name TEXT NOT NULL DEFAULT '';

-- "Mario Rossi" → nome "Mario", cognome "Rossi"; una sola parola resta nel nome.
UPDATE contacts SET
    first_name = CASE WHEN instr(trim(name), ' ') > 0 THEN substr(trim(name), 1, instr(trim(name), ' ') - 1) ELSE trim(name) END,
    last_name = CASE WHEN instr(trim(name), ' ') > 0 THEN trim(substr(trim(name), instr(trim(name), ' ') + 1)) ELSE '' END;

CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO companies (name, created_at, updated_at)
    SELECT DISTINCT trim(company), datetime('now', 'localtime'), datetime('now', 'localtime')
    FROM contacts WHERE trim(company) != '';
