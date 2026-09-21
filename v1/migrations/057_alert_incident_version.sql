-- A re-open is a new incident even when the outbox poller misses the closed state.
-- Timestamp/acknowledged_at cannot encode this: producers can clear acknowledgements,
-- and multiple transitions can occur within one millisecond.
ALTER TABLE operator_alerts ADD COLUMN incident_version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE alert_notifications ADD COLUMN incident_version INT UNSIGNED NOT NULL DEFAULT 1;

CREATE TRIGGER operator_alert_incident_version_before_update
BEFORE UPDATE ON operator_alerts FOR EACH ROW
SET NEW.incident_version = OLD.incident_version + IF(OLD.status <> 'OPEN' AND NEW.status = 'OPEN', 1, 0);
