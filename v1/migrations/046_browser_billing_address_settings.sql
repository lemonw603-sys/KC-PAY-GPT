INSERT INTO app_settings (setting_key, setting_value)
VALUES
  ('browser_billing_address_enabled', 'false'),
  ('browser_billing_address_state', 'DE'),
  ('browser_billing_address_name', '')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
