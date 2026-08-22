-- Stage 4: explicit daily auto-replenishment policy setting.
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('card_replenishment_daily_limit', '5')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
