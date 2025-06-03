-- Script di inizializzazione del database
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    code VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crea un indice sul campo code per migliorare le performance
CREATE INDEX IF NOT EXISTS idx_events_code ON events(code);

-- Funzione per notificare i cambiamenti di dati
CREATE OR REPLACE FUNCTION notify_data_change() 
RETURNS TRIGGER AS $$
DECLARE
    notification_data JSON;
    event_code VARCHAR(255);
BEGIN
    -- Gestisce INSERT e UPDATE
    IF TG_OP = 'DELETE' THEN
        event_code := OLD.code;
        notification_data := json_build_object(
            'table', TG_TABLE_NAME,
            'action', TG_OP,
            'data', row_to_json(OLD),
            'code', OLD.code
        );
        PERFORM pg_notify('data_changes', notification_data::text);
        RETURN OLD;
    ELSE
        event_code := NEW.code;
        notification_data := json_build_object(
            'table', TG_TABLE_NAME,
            'action', TG_OP,
            'data', row_to_json(NEW),
            'code', NEW.code
        );
        PERFORM pg_notify('data_changes', notification_data::text);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Applica il trigger alla tabella events per tutte le operazioni
DROP TRIGGER IF EXISTS events_notify_trigger ON events;
CREATE TRIGGER events_notify_trigger
    AFTER INSERT OR UPDATE OR DELETE ON events
    FOR EACH ROW EXECUTE PROCEDURE notify_data_change();

-- Inserisci alcuni dati di esempio
INSERT INTO events (code, title, description) VALUES 
('DEMO', 'Evento di benvenuto', 'Questo è un evento di esempio per testare il sistema'),
('DEMO', 'Sistema operativo', 'Il sistema è ora completamente operativo e pronto per l''uso'),
('TEST', 'Test di connessione', 'Test della connessione al database'),
('TEST', 'Verifica WebSocket', 'Verifica del funzionamento delle WebSocket in tempo reale')
ON CONFLICT DO NOTHING;
