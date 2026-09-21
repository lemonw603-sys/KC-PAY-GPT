-- Daily reconciliation persists its dated fingerprint summary, not the UI report.
-- VARCHAR(255) cannot hold a normal multi-card summary. Widen without changing
-- keys, existing values, collation or nullability; allocate only actual text size.
ALTER TABLE app_settings MODIFY COLUMN setting_value MEDIUMTEXT NOT NULL;
