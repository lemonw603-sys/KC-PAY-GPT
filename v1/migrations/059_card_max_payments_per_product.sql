-- D-221 每卡成功单数按产品：Plus 3 单（沿用全局键 card_max_successful_payments），5X / 20X 各 1 单。
-- 读取口径唯一：card-inventory-eligibility.maxPaymentsSql（按产品键 → 全局键 → 3）。
-- 只补缺：已存在的按产品键不覆盖（运营可能已在设置页改过）。
INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('card_max_successful_payments:pro_5x', '1'),
  ('card_max_successful_payments:pro_20x', '1')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
