-- Pro 5X / 20X as two-stage products: stage 1 buys Plus, stage 2 upgrades to Pro
-- inside the same account (the free->Pro direct checkout is not used). Both
-- products take the Browser route and the same card source the Plus route uses
-- today. Per-product minimum card balances start at the Plus default and are
-- changed on the card page.
INSERT INTO products
  (id, product_code, display_name, legacy_plan_type, status)
VALUES
  ('00000000-0000-4000-8000-000000000205', 'chatgpt_pro_5x', 'ChatGPT Pro 5X', 'pro_5x', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000206', 'chatgpt_pro_20x', 'ChatGPT Pro 20X', 'pro_20x', 'ACTIVE')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO fulfillment_routes
  (id, route_code, route_version, product_id, card_provider_account_id,
   recharge_provider_account_id, executor_kind, accepts_new_orders, immutable)
VALUES
  ('00000000-0000-4000-8000-000000000305', 'CHATGPT_PRO_5X_BROWSER_V1', 1,
   '00000000-0000-4000-8000-000000000205',
   '00000000-0000-4000-8000-000000000101', NULL, 'BROWSER', 1, 1),
  ('00000000-0000-4000-8000-000000000306', 'CHATGPT_PRO_20X_BROWSER_V1', 1,
   '00000000-0000-4000-8000-000000000206',
   '00000000-0000-4000-8000-000000000101', NULL, 'BROWSER', 1, 1)
ON DUPLICATE KEY UPDATE route_code = route_code;

INSERT INTO browser_card_source_selections (product_id, provider_account_id, version, updated_by)
SELECT p.id, plus_selection.provider_account_id, 1, 'migration-050'
FROM products p
INNER JOIN products plus ON plus.product_code = 'chatgpt_plus'
INNER JOIN browser_card_source_selections plus_selection ON plus_selection.product_id = plus.id
WHERE p.product_code IN ('chatgpt_pro_5x', 'chatgpt_pro_20x')
ON DUPLICATE KEY UPDATE browser_card_source_selections.version = browser_card_source_selections.version;

INSERT INTO app_settings (setting_key, setting_value)
SELECT CONCAT('minimum_required_card_balance:', plans.plan), COALESCE(plus_default.setting_value, '16.00')
FROM (SELECT 'pro_5x' AS plan UNION ALL SELECT 'pro_20x') plans
LEFT JOIN (SELECT setting_value FROM app_settings
           WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1) plus_default ON TRUE
ON DUPLICATE KEY UPDATE app_settings.setting_value = app_settings.setting_value;
