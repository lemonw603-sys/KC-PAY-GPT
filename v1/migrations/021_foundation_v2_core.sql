-- Foundation v2 compatibility schema.
-- This migration is deliberately additive: legacy columns remain available while
-- the new provider/account/route model is introduced beside them.

CREATE TABLE IF NOT EXISTS provider_accounts (
  id CHAR(36) PRIMARY KEY,
  provider_code VARCHAR(64) NOT NULL,
  account_code VARCHAR(64) NOT NULL,
  environment VARCHAR(16) NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  credential_ref VARCHAR(255) NULL,
  read_enabled TINYINT(1) NOT NULL DEFAULT 1,
  write_enabled TINYINT(1) NOT NULL DEFAULT 0,
  requests_per_minute INT UNSIGNED NULL,
  max_concurrency SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  circuit_state VARCHAR(24) NOT NULL DEFAULT 'CLOSED',
  circuit_open_until TIMESTAMP(3) NULL,
  retry_after_until TIMESTAMP(3) NULL,
  consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
  last_success_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_provider_accounts_identity (provider_code, account_code, environment),
  KEY idx_provider_accounts_runtime (read_enabled, write_enabled, circuit_state, retry_after_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY,
  product_code VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  legacy_plan_type VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_products_code (product_code),
  UNIQUE KEY uq_products_legacy_plan (legacy_plan_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fulfillment_routes (
  id CHAR(36) PRIMARY KEY,
  route_code VARCHAR(96) NOT NULL,
  route_version INT UNSIGNED NOT NULL,
  product_id CHAR(36) NOT NULL,
  card_provider_account_id CHAR(36) NULL,
  recharge_provider_account_id CHAR(36) NULL,
  executor_kind VARCHAR(16) NOT NULL,
  accepts_new_orders TINYINT(1) NOT NULL DEFAULT 0,
  immutable TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retired_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_fulfillment_routes_code_version (route_code, route_version),
  KEY idx_fulfillment_routes_product_active (product_id, accepts_new_orders),
  CONSTRAINT fk_fulfillment_routes_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_fulfillment_routes_card_account FOREIGN KEY (card_provider_account_id) REFERENCES provider_accounts(id),
  CONSTRAINT fk_fulfillment_routes_recharge_account FOREIGN KEY (recharge_provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_authorizations (
  id CHAR(36) PRIMARY KEY,
  authorization_mode VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  authorized_by VARCHAR(128) NOT NULL,
  reason VARCHAR(500) NULL,
  max_orders INT UNSIGNED NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at TIMESTAMP(3) NULL,
  KEY idx_recharge_authorizations_active (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_authorization_items (
  id CHAR(36) PRIMARY KEY,
  authorization_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  consumed_attempt_id CHAR(36) NULL,
  consumed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  protected_order_id CHAR(36) GENERATED ALWAYS AS
    (CASE WHEN status IN ('PENDING', 'CONSUMED') THEN order_id ELSE NULL END) STORED,
  UNIQUE KEY uq_recharge_auth_item_member (authorization_id, order_id),
  UNIQUE KEY uq_recharge_auth_item_protected_order (protected_order_id),
  UNIQUE KEY uq_recharge_auth_item_consumed_attempt (consumed_attempt_id),
  KEY idx_recharge_auth_items_order (order_id, status),
  CONSTRAINT fk_recharge_auth_items_authorization FOREIGN KEY (authorization_id) REFERENCES recharge_authorizations(id),
  CONSTRAINT fk_recharge_auth_items_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_attempts (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  fulfillment_route_id CHAR(36) NULL,
  provider_account_id CHAR(36) NULL,
  authorization_item_id CHAR(36) NULL,
  executor_kind VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PREPARED',
  funds_risk_state VARCHAR(16) NOT NULL DEFAULT 'NONE',
  idempotency_key VARCHAR(191) NULL,
  external_order_id VARCHAR(191) NULL,
  external_reference VARCHAR(255) NULL,
  submit_intent_at TIMESTAMP(3) NULL,
  submitted_at TIMESTAMP(3) NULL,
  last_reconciled_at TIMESTAMP(3) NULL,
  finished_at TIMESTAMP(3) NULL,
  result_summary_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  funds_fence_order_id CHAR(36) GENERATED ALWAYS AS
    (CASE WHEN funds_risk_state IN ('ACTIVE', 'UNKNOWN', 'SETTLED') THEN order_id ELSE NULL END) STORED,
  UNIQUE KEY uq_recharge_attempt_funds_fence (funds_fence_order_id),
  UNIQUE KEY uq_recharge_attempt_authorization_item (authorization_item_id),
  UNIQUE KEY uq_recharge_attempt_provider_idempotency (provider_account_id, idempotency_key),
  KEY idx_recharge_attempts_order_created (order_id, created_at),
  KEY idx_recharge_attempts_reconcile (status, last_reconciled_at),
  CONSTRAINT fk_recharge_attempts_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_recharge_attempts_route FOREIGN KEY (fulfillment_route_id) REFERENCES fulfillment_routes(id),
  CONSTRAINT fk_recharge_attempts_provider_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id),
  CONSTRAINT fk_recharge_attempts_authorization_item FOREIGN KEY (authorization_item_id) REFERENCES recharge_authorization_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_intake_batches (
  id CHAR(36) PRIMARY KEY,
  provider_account_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DISCOVERING',
  requested_by VARCHAR(128) NOT NULL DEFAULT 'admin',
  baseline_watermark VARCHAR(255) NULL,
  baseline_hash CHAR(64) NULL,
  continuation_cursor VARCHAR(512) NULL,
  baseline_json JSON NULL,
  discovered_count INT UNSIGNED NOT NULL DEFAULT 0,
  accepted_count INT UNSIGNED NOT NULL DEFAULT 0,
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_card_intake_batches_account (provider_account_id, status, created_at),
  CONSTRAINT fk_card_intake_batches_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_discoveries (
  id CHAR(36) PRIMARY KEY,
  intake_batch_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  external_card_id VARCHAR(191) NOT NULL,
  card_id CHAR(36) NULL,
  intake_status VARCHAR(24) NOT NULL DEFAULT 'QUARANTINED',
  validation_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  first_snapshot_hash CHAR(64) NULL,
  second_snapshot_hash CHAR(64) NULL,
  details_json JSON NULL,
  failure_code VARCHAR(64) NULL,
  failure_reason VARCHAR(1000) NULL,
  first_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  validated_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_card_discoveries_batch_external (intake_batch_id, provider_account_id, external_card_id),
  KEY idx_card_discoveries_review (provider_account_id, intake_status, first_seen_at),
  KEY idx_card_discoveries_card (card_id),
  CONSTRAINT fk_card_discoveries_batch FOREIGN KEY (intake_batch_id) REFERENCES card_intake_batches(id),
  CONSTRAINT fk_card_discoveries_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id),
  CONSTRAINT fk_card_discoveries_card FOREIGN KEY (card_id) REFERENCES cards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_balance_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_account_id CHAR(36) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  available_balance DECIMAL(18,6) NOT NULL,
  pending_balance DECIMAL(18,6) NULL,
  source_call_id BIGINT UNSIGNED NULL,
  payload_hash CHAR(64) NULL,
  observed_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_provider_balance_observation (provider_account_id, currency, observed_at),
  KEY idx_provider_balance_history (provider_account_id, observed_at),
  CONSTRAINT fk_provider_balance_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id),
  CONSTRAINT fk_provider_balance_call FOREIGN KEY (source_call_id) REFERENCES provider_calls(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cdk_delivery_events (
  id CHAR(36) PRIMARY KEY,
  cdk_id CHAR(36) NULL,
  batch_no VARCHAR(64) NULL,
  event_type VARCHAR(32) NOT NULL DEFAULT 'DELIVERED',
  channel VARCHAR(64) NULL,
  recipient_reference_hash CHAR(64) NULL,
  recipient_note VARCHAR(255) NULL,
  actor_id VARCHAR(128) NOT NULL DEFAULT 'admin',
  metadata_json JSON NULL,
  delivered_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_cdk_delivery_cdk (cdk_id, delivered_at),
  KEY idx_cdk_delivery_batch (batch_no, delivered_at),
  CONSTRAINT fk_cdk_delivery_cdk FOREIGN KEY (cdk_id) REFERENCES cdks(id),
  CONSTRAINT fk_cdk_delivery_batch FOREIGN KEY (batch_no) REFERENCES cdk_batches(batch_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reconciliation_cases (
  id CHAR(36) PRIMARY KEY,
  case_type VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  dedupe_key VARCHAR(191) NOT NULL,
  order_id CHAR(36) NULL,
  card_id CHAR(36) NULL,
  recharge_attempt_id CHAR(36) NULL,
  provider_account_id CHAR(36) NULL,
  evidence_json JSON NULL,
  assigned_to VARCHAR(128) NULL,
  resolution_note VARCHAR(1000) NULL,
  detected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reconciliation_cases_dedupe (dedupe_key),
  KEY idx_reconciliation_cases_queue (status, severity, detected_at),
  CONSTRAINT fk_reconciliation_cases_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_reconciliation_cases_card FOREIGN KEY (card_id) REFERENCES cards(id),
  CONSTRAINT fk_reconciliation_cases_attempt FOREIGN KEY (recharge_attempt_id) REFERENCES recharge_attempts(id),
  CONSTRAINT fk_reconciliation_cases_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deterministic compatibility seeds. Credential values remain outside MySQL.
INSERT INTO provider_accounts
  (id, provider_code, account_code, environment, purpose, credential_ref,
   read_enabled, write_enabled, max_concurrency)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'hnskj', 'legacy-primary', 'PRODUCTION', 'CARD',
   'env:HNSKJ_API_KEY', 1, 0, 1),
  ('00000000-0000-4000-8000-000000000102', 'zzshu', 'legacy-primary', 'PRODUCTION', 'RECHARGE',
   'env:ZZSHU_API_KEY', 1, 0, 1)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO products
  (id, product_code, display_name, legacy_plan_type, status)
VALUES
  ('00000000-0000-4000-8000-000000000201', 'chatgpt_plus', 'ChatGPT Plus', 'plus', 'ACTIVE')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO fulfillment_routes
  (id, route_code, route_version, product_id, card_provider_account_id,
   recharge_provider_account_id, executor_kind, accepts_new_orders, immutable)
VALUES
  ('00000000-0000-4000-8000-000000000301', 'LEGACY_HNSKJ_ZZSHU_V1', 1,
   '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000102',
   'API', 1, 1)
ON DUPLICATE KEY UPDATE id = id;

-- Idempotent additive extension helpers. MySQL 8.4 has no portable
-- ADD COLUMN IF NOT EXISTS, so each ALTER is guarded through information_schema.
SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'provider_account_id'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN provider_account_id CHAR(36) NULL AFTER id'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'external_card_id'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN external_card_id VARCHAR(191) NULL AFTER provider_card_id'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'intake_status'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN intake_status VARCHAR(24) NOT NULL DEFAULT ''QUARANTINED'' AFTER inventory_status'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'sync_tier'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN sync_tier VARCHAR(24) NOT NULL DEFAULT ''LEGACY'' AFTER refund_status'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'next_sync_at'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN next_sync_at TIMESTAMP(3) NULL AFTER sync_tier'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'sync_consecutive_failures'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN sync_consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0 AFTER next_sync_at'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'last_successful_sync_at'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN last_successful_sync_at TIMESTAMP(3) NULL AFTER sync_consecutive_failures'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'refund_watch_until'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN refund_watch_until TIMESTAMP(3) NULL AFTER last_successful_sync_at'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'pan_hmac'),
  'DO 0',
  'ALTER TABLE cards ADD COLUMN pan_hmac CHAR(64) NULL AFTER card_number_ciphertext'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'product_id'),
  'DO 0',
  'ALTER TABLE orders ADD COLUMN product_id CHAR(36) NULL AFTER plan_type'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'fulfillment_route_id'),
  'DO 0',
  'ALTER TABLE orders ADD COLUMN fulfillment_route_id CHAR(36) NULL AFTER product_id'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'route_resolution_status'),
  'DO 0',
  'ALTER TABLE orders ADD COLUMN route_resolution_status VARCHAR(24) NOT NULL DEFAULT ''LEGACY_UNKNOWN'' AFTER fulfillment_route_id'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_calls' AND COLUMN_NAME = 'provider_account_id'),
  'DO 0',
  'ALTER TABLE provider_calls ADD COLUMN provider_account_id CHAR(36) NULL AFTER provider'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_calls' AND COLUMN_NAME = 'recharge_attempt_id'),
  'DO 0',
  'ALTER TABLE provider_calls ADD COLUMN recharge_attempt_id CHAR(36) NULL AFTER order_id'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

-- Evidence-only compatibility backfill. provider_card_id is emitted solely by the
-- hard-coded legacy HNSKJ adapter; provider_calls.provider names its adapter.
UPDATE cards
SET provider_account_id = '00000000-0000-4000-8000-000000000101',
    external_card_id = COALESCE(external_card_id, provider_card_id),
    intake_status = 'LEGACY_ACCEPTED',
    sync_tier = CASE WHEN order_id IS NULL THEN 'INVENTORY' ELSE 'ASSIGNED' END,
    last_successful_sync_at = COALESCE(last_successful_sync_at, last_synced_at)
WHERE provider_card_id IS NOT NULL
  AND (provider_account_id IS NULL OR external_card_id IS NULL OR intake_status = 'QUARANTINED');

UPDATE provider_calls
SET provider_account_id = CASE LOWER(provider)
  WHEN 'hnskj' THEN '00000000-0000-4000-8000-000000000101'
  WHEN 'zzshu' THEN '00000000-0000-4000-8000-000000000102'
  ELSE NULL
END
WHERE provider_account_id IS NULL
  AND LOWER(provider) IN ('hnskj', 'zzshu');

UPDATE orders
SET product_id = '00000000-0000-4000-8000-000000000201'
WHERE product_id IS NULL AND LOWER(plan_type) = 'plus';

UPDATE orders o
SET o.fulfillment_route_id = '00000000-0000-4000-8000-000000000301',
    o.route_resolution_status = 'EVIDENCE_BACKFILLED'
WHERE o.fulfillment_route_id IS NULL
  AND o.product_id = '00000000-0000-4000-8000-000000000201'
  AND (
    o.recharge_order_no IS NOT NULL
    OR EXISTS (SELECT 1 FROM cards c WHERE c.order_id = o.id AND c.provider_account_id = '00000000-0000-4000-8000-000000000101')
    OR EXISTS (SELECT 1 FROM provider_calls pc WHERE pc.order_id = o.id AND pc.provider_account_id IN (
      '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'
    ))
  );

-- Replace the legacy global external-card uniqueness with account-scoped
-- uniqueness. The legacy column remains readable/writable during compatibility.
SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND INDEX_NAME = 'uq_cards_provider_card_id'),
  'ALTER TABLE cards DROP INDEX uq_cards_provider_card_id',
  'DO 0'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND INDEX_NAME = 'idx_cards_provider_card_id'),
  'DO 0',
  'ALTER TABLE cards ADD INDEX idx_cards_provider_card_id (provider_card_id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND INDEX_NAME = 'uq_cards_provider_account_external'),
  'DO 0',
  'ALTER TABLE cards ADD UNIQUE INDEX uq_cards_provider_account_external (provider_account_id, external_card_id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND INDEX_NAME = 'idx_cards_sync_due'),
  'DO 0',
  'ALTER TABLE cards ADD INDEX idx_cards_sync_due (sync_tier, next_sync_at, sync_consecutive_failures)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

-- Add compatibility foreign keys only after evidence backfill.
SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND CONSTRAINT_NAME = 'fk_cards_provider_account'),
  'DO 0',
  'ALTER TABLE cards ADD CONSTRAINT fk_cards_provider_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_product'),
  'DO 0',
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_fulfillment_route'),
  'DO 0',
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_fulfillment_route FOREIGN KEY (fulfillment_route_id) REFERENCES fulfillment_routes(id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_calls' AND CONSTRAINT_NAME = 'fk_provider_calls_account'),
  'DO 0',
  'ALTER TABLE provider_calls ADD CONSTRAINT fk_provider_calls_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_calls' AND CONSTRAINT_NAME = 'fk_provider_calls_recharge_attempt'),
  'DO 0',
  'ALTER TABLE provider_calls ADD CONSTRAINT fk_provider_calls_recharge_attempt FOREIGN KEY (recharge_attempt_id) REFERENCES recharge_attempts(id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

SET @foundation_v2_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'recharge_authorization_items' AND CONSTRAINT_NAME = 'fk_recharge_auth_items_consumed_attempt'),
  'DO 0',
  'ALTER TABLE recharge_authorization_items ADD CONSTRAINT fk_recharge_auth_items_consumed_attempt FOREIGN KEY (consumed_attempt_id) REFERENCES recharge_attempts(id)'
);
PREPARE foundation_v2_stmt FROM @foundation_v2_ddl; EXECUTE foundation_v2_stmt; DEALLOCATE PREPARE foundation_v2_stmt;

-- One deterministic historical attempt per order with actual ZZSHU submission
-- evidence. Orders without such evidence remain without an attempt.
INSERT INTO recharge_attempts
  (id, order_id, fulfillment_route_id, provider_account_id, executor_kind,
   status, funds_risk_state, external_order_id, submit_intent_at,
   last_reconciled_at, finished_at, result_summary_json)
SELECT
  LOWER(CONCAT(
    SUBSTR(MD5(CONCAT('foundation-v2:legacy-zzshu:', o.id)), 1, 8), '-',
    SUBSTR(MD5(CONCAT('foundation-v2:legacy-zzshu:', o.id)), 9, 4), '-4',
    SUBSTR(MD5(CONCAT('foundation-v2:legacy-zzshu:', o.id)), 14, 3), '-a',
    SUBSTR(MD5(CONCAT('foundation-v2:legacy-zzshu:', o.id)), 18, 3), '-',
    SUBSTR(MD5(CONCAT('foundation-v2:legacy-zzshu:', o.id)), 21, 12)
  )),
  o.id,
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000102',
  'API',
  CASE
    WHEN (o.status = 'RECHARGE_SUCCESS' OR (o.status = 'CLOSED' AND EXISTS (
      SELECT 1 FROM order_events oes
      WHERE oes.order_id = o.id AND oes.to_status = 'RECHARGE_SUCCESS'
    ))) AND o.recharge_order_no IS NOT NULL THEN 'SUCCESS'
    WHEN o.status = 'RECHARGE_PROCESSING' OR o.recharge_order_no IS NOT NULL THEN 'PROCESSING'
    WHEN o.status = 'RECHARGE_FAILED' AND NOT EXISTS (
      SELECT 1 FROM provider_calls pcu
      WHERE pcu.order_id = o.id AND LOWER(pcu.provider) = 'zzshu'
        AND pcu.operation = 'create_direct' AND pcu.outcome IN ('STARTED', 'SUCCESS', 'UNCERTAIN')
    ) THEN 'FAILED'
    ELSE 'SUBMIT_UNKNOWN'
  END,
  CASE
    WHEN (o.status = 'RECHARGE_SUCCESS' OR (o.status = 'CLOSED' AND EXISTS (
      SELECT 1 FROM order_events oes
      WHERE oes.order_id = o.id AND oes.to_status = 'RECHARGE_SUCCESS'
    ))) AND o.recharge_order_no IS NOT NULL THEN 'SETTLED'
    WHEN o.status = 'RECHARGE_PROCESSING' OR o.recharge_order_no IS NOT NULL THEN 'ACTIVE'
    WHEN o.status = 'RECHARGE_FAILED' AND NOT EXISTS (
      SELECT 1 FROM provider_calls pcu
      WHERE pcu.order_id = o.id AND LOWER(pcu.provider) = 'zzshu'
        AND pcu.operation = 'create_direct' AND pcu.outcome IN ('STARTED', 'SUCCESS', 'UNCERTAIN')
    ) THEN 'CLEARED'
    ELSE 'UNKNOWN'
  END,
  o.recharge_order_no,
  (SELECT MIN(pc.started_at) FROM provider_calls pc
   WHERE pc.order_id = o.id AND LOWER(pc.provider) = 'zzshu' AND pc.operation = 'create_direct'),
  (SELECT MAX(pc.finished_at) FROM provider_calls pc
   WHERE pc.order_id = o.id AND LOWER(pc.provider) = 'zzshu' AND pc.operation = 'create_direct'),
  CASE WHEN o.status IN ('RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED') THEN o.finished_at ELSE NULL END,
  JSON_OBJECT('source', 'legacy_evidence_backfill', 'legacy_order_status', o.status)
FROM orders o
WHERE o.recharge_order_no IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM provider_calls pc
     WHERE pc.order_id = o.id AND LOWER(pc.provider) = 'zzshu' AND pc.operation = 'create_direct'
   )
ON DUPLICATE KEY UPDATE external_order_id = o.recharge_order_no;

UPDATE provider_calls pc
JOIN recharge_attempts ra
  ON ra.order_id = pc.order_id
 AND ra.provider_account_id = '00000000-0000-4000-8000-000000000102'
SET pc.recharge_attempt_id = ra.id
WHERE pc.recharge_attempt_id IS NULL
  AND LOWER(pc.provider) = 'zzshu'
  AND pc.operation IN ('create_direct', 'query_order', 'query_direct');

SET @foundation_v2_ddl = NULL;
