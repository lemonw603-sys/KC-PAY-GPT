-- Multi-source Browser card catalog, full-snapshot intake and order-time source
-- freezing. Migration 048 has never reached production, so its local candidate
-- is intentionally replaced instead of layering compatibility DDL on a bad model.

ALTER TABLE provider_accounts
  ADD COLUMN display_name VARCHAR(128) NULL AFTER account_code,
  ADD COLUMN source_adapter VARCHAR(64) NULL AFTER credential_ref,
  ADD COLUMN supports_api_recharge TINYINT(1) NOT NULL DEFAULT 0 AFTER source_adapter,
  ADD COLUMN supports_browser_recharge TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_api_recharge,
  ADD COLUMN supports_api_sync TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_browser_recharge,
  ADD COLUMN supports_auto_open TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_api_sync,
  ADD COLUMN supports_auto_funding TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_auto_open,
  ADD COLUMN operational_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER supports_auto_funding,
  ADD COLUMN last_full_snapshot_at TIMESTAMP(3) NULL AFTER last_success_at;

UPDATE provider_accounts
SET display_name = COALESCE(display_name, 'HNSKJ'),
    source_adapter = COALESCE(source_adapter, 'hnskj_api_v1'),
    supports_api_recharge = 1,
    supports_browser_recharge = 1,
    supports_api_sync = 1,
    supports_auto_open = 1,
    supports_auto_funding = 1
WHERE provider_code = 'hnskj' AND purpose = 'CARD';

INSERT INTO provider_accounts
  (id, provider_code, account_code, display_name, environment, purpose,
   credential_ref, source_adapter, supports_api_recharge,
   supports_browser_recharge, supports_api_sync, supports_auto_open,
   supports_auto_funding, read_enabled, write_enabled, max_concurrency)
VALUES
  ('00000000-0000-4000-8000-000000000103', 'manual_excel', 'backup-a',
   '备用卡台 A', 'PRODUCTION', 'CARD', NULL, 'backup_card_export_v1',
   0, 1, 0, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), source_adapter=VALUES(source_adapter),
  supports_api_recharge=0, supports_browser_recharge=1,
  supports_api_sync=0, supports_auto_open=0, supports_auto_funding=0;

CREATE TABLE IF NOT EXISTS browser_card_source_selections (
  product_id CHAR(36) PRIMARY KEY,
  provider_account_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(128) NOT NULL DEFAULT 'migration-048',
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_browser_source_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_browser_source_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO browser_card_source_selections (product_id, provider_account_id)
SELECT p.id, COALESCE(fr.card_provider_account_id,
  '00000000-0000-4000-8000-000000000101')
FROM products p
INNER JOIN fulfillment_routes fr ON fr.product_id=p.id
WHERE p.product_code='chatgpt_plus' AND fr.executor_kind='BROWSER'
  AND fr.retired_at IS NULL
ORDER BY fr.route_version DESC LIMIT 1
ON DUPLICATE KEY UPDATE product_id=VALUES(product_id);

ALTER TABLE orders
  ADD COLUMN frozen_card_provider_account_id CHAR(36) NULL AFTER fulfillment_route_id,
  ADD INDEX idx_orders_frozen_card_source (frozen_card_provider_account_id, status),
  ADD CONSTRAINT fk_orders_frozen_card_source FOREIGN KEY (frozen_card_provider_account_id)
    REFERENCES provider_accounts(id);

UPDATE orders o
INNER JOIN fulfillment_routes fr ON fr.id=o.fulfillment_route_id
SET o.frozen_card_provider_account_id=fr.card_provider_account_id
WHERE o.frozen_card_provider_account_id IS NULL;

CREATE TABLE IF NOT EXISTS browser_card_source_switch_events (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  previous_provider_account_id CHAR(36) NULL,
  provider_account_id CHAR(36) NOT NULL,
  waiting_takeover_requested TINYINT(1) NOT NULL DEFAULT 0,
  estimated_takeover_count INT UNSIGNED NOT NULL DEFAULT 0,
  actual_takeover_count INT UNSIGNED NOT NULL DEFAULT 0,
  actor_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_browser_source_switch_created (created_at),
  CONSTRAINT fk_browser_source_switch_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_browser_source_switch_previous FOREIGN KEY (previous_provider_account_id) REFERENCES provider_accounts(id),
  CONSTRAINT fk_browser_source_switch_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manual_card_import_batches (
  id CHAR(36) PRIMARY KEY,
  provider_account_id CHAR(36) NOT NULL,
  adapter_code VARCHAR(64) NOT NULL,
  source_file_hash CHAR(64) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  unavailable_count INT UNSIGNED NOT NULL DEFAULT 0,
  missing_count INT UNSIGNED NOT NULL DEFAULT 0,
  conflict_count INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count INT UNSIGNED NOT NULL DEFAULT 0,
  requested_by VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PREVIEWED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  committed_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_manual_card_import_source_hash (provider_account_id, source_file_hash),
  KEY idx_manual_card_import_source_created (provider_account_id, created_at),
  CONSTRAINT fk_manual_import_batch_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manual_card_import_rows (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  external_card_id VARCHAR(191) NOT NULL,
  last4 CHAR(4) NULL,
  outcome VARCHAR(24) NOT NULL,
  error_code VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_manual_import_row (batch_id, external_card_id),
  CONSTRAINT fk_manual_import_rows_batch FOREIGN KEY (batch_id) REFERENCES manual_card_import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cards
  ADD COLUMN source_present TINYINT(1) NOT NULL DEFAULT 1 AFTER sync_tier,
  ADD COLUMN source_operational_status VARCHAR(32) NULL AFTER source_present,
  ADD COLUMN last_manual_snapshot_batch_id CHAR(36) NULL AFTER source_operational_status,
  ADD INDEX idx_cards_manual_snapshot (provider_account_id, source_present, last_manual_snapshot_batch_id),
  ADD CONSTRAINT fk_cards_manual_snapshot FOREIGN KEY (last_manual_snapshot_batch_id)
    REFERENCES manual_card_import_batches(id);

-- Compatibility table retained for old read paths only. New allocation never
-- ranks or falls back through this table.
CREATE TABLE IF NOT EXISTS fulfillment_route_card_sources (
  fulfillment_route_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (fulfillment_route_id, provider_account_id),
  CONSTRAINT fk_route_card_sources_route FOREIGN KEY (fulfillment_route_id) REFERENCES fulfillment_routes(id),
  CONSTRAINT fk_route_card_sources_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO fulfillment_route_card_sources (fulfillment_route_id, provider_account_id)
SELECT fr.id, fr.card_provider_account_id FROM fulfillment_routes fr
WHERE fr.card_provider_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE enabled=1;

-- A post-click transport failure is first handled by bounded, read-only
-- verification.  It is not an operator case until the configured deadline is
-- exhausted or evidence conflicts.  PAYMENT_UNKNOWN remains the money-safety
-- fence; verification_state describes the operational phase.
ALTER TABLE browser_runs
  ADD COLUMN verification_state VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED'
    AFTER payment_state,
  ADD COLUMN verification_started_at TIMESTAMP(3) NULL AFTER verification_state,
  ADD COLUMN verification_deadline_at TIMESTAMP(3) NULL AFTER verification_started_at,
  ADD COLUMN verification_next_check_at TIMESTAMP(3) NULL AFTER verification_deadline_at,
  ADD COLUMN verification_check_count INT UNSIGNED NOT NULL DEFAULT 0
    AFTER verification_next_check_at,
  ADD INDEX idx_browser_payment_verification
    (verification_state, verification_next_check_at, verification_deadline_at),
  ADD CONSTRAINT chk_browser_runs_verification_state CHECK (verification_state IN (
    'NOT_REQUIRED', 'VERIFYING_PAYMENT', 'RESOLVED', 'HUMAN_REQUIRED'
  ));
