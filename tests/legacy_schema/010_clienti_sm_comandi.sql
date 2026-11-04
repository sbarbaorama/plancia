ALTER TABLE meetings ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE contacts ADD COLUMN is_service_manager INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sticky_notes ADD COLUMN command TEXT NOT NULL DEFAULT '';

-- Clienti seguiti da un contatto con il ruolo di service manager.
CREATE TABLE service_manager_customers (
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, customer_id)
);

CREATE INDEX idx_sm_customer ON service_manager_customers(customer_id);
