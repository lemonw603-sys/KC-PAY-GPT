ALTER TABLE orders
  ADD COLUMN minimum_required_card_balance DECIMAL(18,6) NULL AFTER open_card_amount,
  ADD COLUMN actual_payment_amount DECIMAL(18,6) NULL AFTER recharge_card_key,
  ADD COLUMN actual_payment_currency VARCHAR(8) NULL AFTER actual_payment_amount;

UPDATE orders
SET minimum_required_card_balance = open_card_amount
WHERE minimum_required_card_balance IS NULL
  AND open_card_amount IS NOT NULL;

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('default_minimum_required_card_balance', '')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
