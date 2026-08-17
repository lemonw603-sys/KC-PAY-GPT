INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('default_card_type_id', ''),
  ('default_open_card_amount', '')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
