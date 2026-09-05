-- Manual backup-card intake. The source has no API and is therefore never
-- eligible for provider sync, opening, or balance funding.
INSERT INTO provider_accounts
  (id, provider_code, account_code, environment, purpose, credential_ref,
   read_enabled, write_enabled, max_concurrency)
VALUES
  ('00000000-0000-4000-8000-000000000103', 'manual_excel', 'backup-primary',
   'PRODUCTION', 'CARD', NULL, 0, 0, 1)
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS manual_card_import_batches (
  id CHAR(36) PRIMARY KEY,
  source_file_hash CHAR(64) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count INT UNSIGNED NOT NULL DEFAULT 0,
  requested_by VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PREVIEWED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  committed_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_manual_card_import_hash (source_file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manual_card_import_rows (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  external_card_id VARCHAR(191) NOT NULL,
  last4 CHAR(4) NULL,
  outcome VARCHAR(24) NOT NULL,
  error_code VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_manual_import_row (batch_id, external_card_id),
  CONSTRAINT fk_manual_import_rows_batch FOREIGN KEY (batch_id) REFERENCES manual_card_import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fulfillment_route_card_sources (
  fulfillment_route_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (fulfillment_route_id, provider_account_id),
  KEY idx_route_card_sources_pick (fulfillment_route_id, enabled, priority),
  CONSTRAINT fk_route_card_sources_route FOREIGN KEY (fulfillment_route_id) REFERENCES fulfillment_routes(id),
  CONSTRAINT fk_route_card_sources_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO fulfillment_route_card_sources (fulfillment_route_id, provider_account_id, priority)
SELECT fr.id, pa.id, 100
FROM fulfillment_routes fr
INNER JOIN provider_accounts pa ON pa.provider_code='hnskj' AND pa.environment='PRODUCTION' AND pa.purpose='CARD'
WHERE fr.card_provider_account_id = pa.id
ON DUPLICATE KEY UPDATE priority = VALUES(priority), enabled = 1;

INSERT INTO fulfillment_route_card_sources (fulfillment_route_id, provider_account_id, priority)
SELECT fr.id, '00000000-0000-4000-8000-000000000103', 200
FROM fulfillment_routes fr
WHERE fr.route_code='CHATGPT_PLUS_BROWSER_V1'
ON DUPLICATE KEY UPDATE priority = VALUES(priority), enabled = 1;
