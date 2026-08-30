INSERT INTO app_settings (setting_key, setting_value)
VALUES ('browser_worker_heartbeat_at', '')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
