CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cdks (
  id CHAR(36) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
  batch_no VARCHAR(64) NULL,
  order_id CHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  redeemed_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_cdks_code_hash (code_hash),
  UNIQUE KEY uq_cdks_order_id (order_id),
  KEY idx_cdks_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) PRIMARY KEY,
  public_no VARCHAR(64) NOT NULL,
  cdk_id CHAR(36) NOT NULL,
  status VARCHAR(40) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  plan_type VARCHAR(24) NOT NULL DEFAULT 'plus',
  customer_email VARCHAR(320) NULL,
  chatgpt_account_id VARCHAR(191) NULL,
  session_ciphertext MEDIUMBLOB NOT NULL,
  card_purchase_idempotency_key VARCHAR(128) NOT NULL,
  recharge_order_no VARCHAR(128) NULL,
  recharge_card_key VARCHAR(255) NULL,
  failure_code VARCHAR(64) NULL,
  failure_reason VARCHAR(1000) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_orders_public_no (public_no),
  UNIQUE KEY uq_orders_cdk_id (cdk_id),
  UNIQUE KEY uq_orders_purchase_key (card_purchase_idempotency_key),
  UNIQUE KEY uq_orders_recharge_card_key (recharge_card_key),
  KEY idx_orders_status_created (status, created_at),
  CONSTRAINT fk_orders_cdk FOREIGN KEY (cdk_id) REFERENCES cdks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cards (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  provider_card_id VARCHAR(128) NOT NULL,
  card_type_id VARCHAR(128) NOT NULL,
  last4 CHAR(4) NULL,
  status VARCHAR(40) NOT NULL,
  funded_amount DECIMAL(18,6) NOT NULL,
  current_balance DECIMAL(18,6) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  refund_status VARCHAR(40) NOT NULL DEFAULT 'MONITORING',
  last_synced_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cards_order_id (order_id),
  UNIQUE KEY uq_cards_provider_card_id (provider_card_id),
  KEY idx_cards_refund_sync (refund_status, last_synced_at),
  CONSTRAINT fk_cards_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_calls (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NULL,
  provider VARCHAR(32) NOT NULL,
  operation VARCHAR(64) NOT NULL,
  request_key VARCHAR(191) NULL,
  attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
  http_status SMALLINT UNSIGNED NULL,
  business_code VARCHAR(64) NULL,
  outcome VARCHAR(32) NOT NULL,
  response_summary_json JSON NULL,
  started_at TIMESTAMP(3) NOT NULL,
  finished_at TIMESTAMP(3) NULL,
  duration_ms INT UNSIGNED NULL,
  UNIQUE KEY uq_provider_request_attempt (provider, operation, request_key, attempt_no),
  KEY idx_provider_calls_order (order_id, started_at),
  CONSTRAINT fk_provider_calls_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  dedupe_key VARCHAR(191) NOT NULL,
  payload_json JSON NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  leased_until TIMESTAMP(3) NULL,
  leased_by VARCHAR(128) NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message VARCHAR(1000) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_tasks_dedupe_key (dedupe_key),
  KEY idx_tasks_claim (status, available_at, leased_until),
  KEY idx_tasks_order (order_id),
  CONSTRAINT fk_tasks_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NULL,
  reason VARCHAR(500) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_order_events_order (order_id, id),
  CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  card_id CHAR(36) NOT NULL,
  provider_transaction_id VARCHAR(191) NOT NULL,
  transaction_type VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL,
  amount DECIMAL(18,6) NOT NULL,
  currency CHAR(3) NOT NULL,
  occurred_at TIMESTAMP(3) NULL,
  raw_hash CHAR(64) NOT NULL,
  first_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_card_transactions_provider (card_id, provider_transaction_id),
  KEY idx_card_transactions_type (card_id, transaction_type, status),
  CONSTRAINT fk_card_transactions_card FOREIGN KEY (card_id) REFERENCES cards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refund_cases (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  card_id CHAR(36) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'MONITORING',
  original_transaction_id BIGINT UNSIGNED NULL,
  refund_transaction_id BIGINT UNSIGNED NULL,
  expected_amount DECIMAL(18,6) NULL,
  confirmed_amount DECIMAL(18,6) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  detected_at TIMESTAMP(3) NULL,
  confirmed_at TIMESTAMP(3) NULL,
  withdrawn_at TIMESTAMP(3) NULL,
  operator_note VARCHAR(1000) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_refund_cases_order (order_id),
  KEY idx_refund_cases_status (status, updated_at),
  CONSTRAINT fk_refund_cases_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_refund_cases_card FOREIGN KEY (card_id) REFERENCES cards(id),
  CONSTRAINT fk_refund_cases_original_tx FOREIGN KEY (original_transaction_id) REFERENCES card_transactions(id),
  CONSTRAINT fk_refund_cases_refund_tx FOREIGN KEY (refund_transaction_id) REFERENCES card_transactions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('accept_new_orders', 'false'),
  ('dispatch_new_recharges', 'false'),
  ('poll_existing_orders', 'true'),
  ('sync_card_transactions', 'true')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
