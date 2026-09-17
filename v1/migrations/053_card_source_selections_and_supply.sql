-- V2 落实第③步（D-246 面一 C1 / D-247 面二①③ / D-252 打架 2）：
--   1. 「产品 × 执行器 → 卡台」选择表，替代 browser_card_source_selections（只有 Browser 一半）
--      与 fulfillment_routes.card_provider_account_id（API 一半、四条路线全填 101）两张各说各话的表。
--      两张旧表/旧列原样保留（删表是第⑧步），只是代码不再读它们。
--   2. 供卡策略表：每卡台 × 每产品的水位 / 开卡金额 / 每日上限 / 卡段。
--   3. provider_accounts 加开卡适配器码、钱包硬底线与告警线、供卡故障态——分派看这些能力位，不看名字。
--   4. card_stock_jobs 记下「哪台、哪产品」（旧架构只认 hnskj，历史行回填 101/plus），
--      并加归档列（965 条旧残留归档时用；不删行）。
-- 只加不删，可直接退回上一版 release（新列/新表对旧代码无害）。

CREATE TABLE IF NOT EXISTS card_source_selections (
  product_id CHAR(36) NOT NULL,
  executor_kind VARCHAR(16) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  -- 1 = 后台不给选择控件（API 行固定 hnskj：ZZSHU 按 BIN 白名单放行，D-253）
  locked TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(128) NOT NULL DEFAULT 'migration-053',
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (product_id, executor_kind),
  CONSTRAINT fk_card_source_selection_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_card_source_selection_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Browser 行：从旧表原样迁入（生产 2026-09-17 实查：201/205/206 全指 103，201 version 8）。
INSERT INTO card_source_selections (product_id, executor_kind, provider_account_id, locked, version, updated_by)
SELECT bcs.product_id, 'BROWSER', bcs.provider_account_id, 0, bcs.version, 'migration-053'
FROM browser_card_source_selections bcs
ON DUPLICATE KEY UPDATE card_source_selections.version = card_source_selections.version;

-- API 行：三个产品都固定 101（D-253 Lemon 定：API 只走 hnskj，不加 BIN），锁定。
INSERT INTO card_source_selections (product_id, executor_kind, provider_account_id, locked, version, updated_by)
SELECT p.id, 'API', '00000000-0000-4000-8000-000000000101', 1, 1, 'migration-053'
FROM products p
WHERE p.product_code IN ('chatgpt_plus', 'chatgpt_pro_5x', 'chatgpt_pro_20x')
ON DUPLICATE KEY UPDATE card_source_selections.version = card_source_selections.version;

CREATE TABLE IF NOT EXISTS card_source_selection_events (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  executor_kind VARCHAR(16) NOT NULL,
  previous_provider_account_id CHAR(36) NULL,
  provider_account_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL,
  checks_json JSON NULL,
  waiting_takeover_requested TINYINT(1) NOT NULL DEFAULT 0,
  actual_takeover_count INT UNSIGNED NOT NULL DEFAULT 0,
  actor_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_card_source_selection_events_created (created_at),
  CONSTRAINT fk_css_event_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_css_event_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE provider_accounts
  ADD COLUMN open_adapter VARCHAR(64) NULL AFTER source_adapter,
  ADD COLUMN default_card_segment VARCHAR(64) NULL AFTER open_adapter,
  ADD COLUMN wallet_floor DECIMAL(18,6) NULL AFTER default_card_segment,
  ADD COLUMN wallet_alert_threshold DECIMAL(18,6) NULL AFTER wallet_floor,
  ADD COLUMN supply_fault_state VARCHAR(24) NOT NULL DEFAULT 'OK' AFTER wallet_alert_threshold,
  ADD COLUMN supply_fault_reason VARCHAR(255) NULL AFTER supply_fault_state,
  ADD COLUMN supply_fault_at TIMESTAMP(3) NULL AFTER supply_fault_reason;

-- 101 hnskj：开卡走 hnskj Open API；默认卡段 = 现在的 default_card_type_id（生产 23）；钱包底线 $30、告警线 $50（D-247）。
UPDATE provider_accounts pa
LEFT JOIN app_settings s ON s.setting_key = 'default_card_type_id'
SET pa.open_adapter = 'hnskj_api_v1',
    pa.default_card_segment = COALESCE(NULLIF(TRIM(s.setting_value), ''), pa.default_card_segment),
    pa.wallet_floor = 30,
    pa.wallet_alert_threshold = 50
WHERE pa.id = '00000000-0000-4000-8000-000000000101' AND pa.purpose = 'CARD';

-- 103 备用卡台 A：开卡走 highvcc API（HIGHVCC_DEFAULT_VID 708）；钱包底线 $20、告警线 $50；
-- 自动开卡能力位从 0 改 1（面二③：highvcc openCard 接调度）。
UPDATE provider_accounts
SET open_adapter = 'highvcc_api_v1',
    default_card_segment = '708',
    wallet_floor = 20,
    wallet_alert_threshold = 50,
    supports_auto_open = 1
WHERE id = '00000000-0000-4000-8000-000000000103' AND purpose = 'CARD';

CREATE TABLE IF NOT EXISTS card_supply_policies (
  provider_account_id CHAR(36) NOT NULL,
  product_code VARCHAR(32) NOT NULL,
  target_available INT UNSIGNED NOT NULL DEFAULT 0,
  open_card_amount DECIMAL(18,6) NOT NULL,
  daily_open_limit INT UNSIGNED NOT NULL DEFAULT 20,
  card_segment VARCHAR(64) NULL,
  updated_by VARCHAR(128) NOT NULL DEFAULT 'migration-053',
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider_account_id, product_code),
  CONSTRAINT fk_card_supply_policy_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D-247：Plus 每台保 2 张、$50；Pro 不预留（水位 0、来单即开）、5X $100 / 20X $150；每台每日上限起步 20。
INSERT INTO card_supply_policies (provider_account_id, product_code, target_available, open_card_amount, daily_open_limit)
SELECT pa.id, plans.product_code, plans.target_available, plans.open_card_amount, 20
FROM provider_accounts pa
CROSS JOIN (
  SELECT 'plus' AS product_code, 2 AS target_available, 50 AS open_card_amount
  UNION ALL SELECT 'pro_5x', 0, 100
  UNION ALL SELECT 'pro_20x', 0, 150
) plans
WHERE pa.purpose = 'CARD' AND pa.environment = 'PRODUCTION'
  AND pa.id IN ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000103')
ON DUPLICATE KEY UPDATE card_supply_policies.updated_by = card_supply_policies.updated_by;

ALTER TABLE card_stock_jobs
  ADD COLUMN provider_account_id CHAR(36) NULL AFTER job_source,
  ADD COLUMN product_code VARCHAR(32) NULL AFTER provider_account_id,
  ADD COLUMN fallback_for_provider_account_id CHAR(36) NULL AFTER product_code,
  ADD COLUMN archived_at TIMESTAMP(3) NULL AFTER finished_at,
  ADD COLUMN archive_reason VARCHAR(255) NULL AFTER archived_at,
  ADD INDEX idx_card_stock_jobs_account_created (provider_account_id, created_at);

-- 历史 job 全部是旧架构在 hnskj 上按全局 default_open_card_amount 开的 Plus 卡
--（旧 runner 只装了 HnskjCardProvider，没有别的可能），回填成事实而不是留 NULL 让日限算不到它们。
UPDATE card_stock_jobs
SET provider_account_id = '00000000-0000-4000-8000-000000000101', product_code = 'plus'
WHERE provider_account_id IS NULL;
