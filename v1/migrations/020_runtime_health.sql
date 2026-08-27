INSERT INTO app_settings (setting_key, setting_value)
VALUES ('worker_heartbeat_at', '1970-01-01T00:00:00.000Z')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
