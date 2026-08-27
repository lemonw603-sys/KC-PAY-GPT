-- Stage 4: traceable card-balance top-up attempts.
-- This migration only creates the ledger and linkage.  No provider write is
-- enabled by it; the executor remains behind the existing runtime fences.

CREATE TABLE IF NOT EXISTS card_funding_attempts (
  id CHAR(36) PRIMARY KEY,
  card_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  provider_account_id CHAR(36) NULL,
  amount DECIMAL(18,6) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'PREPARED',
  funds_risk_state VARCHAR(16) NOT NULL DEFAULT 'NONE',
  idempotency_key VARCHAR(191) NOT NULL,
  external_reference VARCHAR(255) NULL,
  submit_intent_at TIMESTAMP(3) NULL,
  submitted_at TIMESTAMP(3) NULL,
  last_reconciled_at TIMESTAMP(3) NULL,
  finished_at TIMESTAMP(3) NULL,
  result_summary_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  funds_fence_card_id CHAR(36) GENERATED ALWAYS AS
    (CASE WHEN funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED') THEN card_id ELSE NULL END) STORED,
  UNIQUE KEY uq_card_funding_idempotency (provider_account_id, idempotency_key),
  UNIQUE KEY uq_card_funding_funds_fence (funds_fence_card_id),
  KEY idx_card_funding_reconcile (status, last_reconciled_at),
  KEY idx_card_funding_card (card_id, created_at),
  CONSTRAINT fk_card_funding_card FOREIGN KEY (card_id) REFERENCES cards(id),
  CONSTRAINT fk_card_funding_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_card_funding_provider FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_card_funding_call_id := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'provider_calls'
    AND column_name = 'card_funding_attempt_id'
);
SET @sql := IF(@has_card_funding_call_id = 0,
  'ALTER TABLE provider_calls ADD COLUMN card_funding_attempt_id CHAR(36) NULL AFTER recharge_attempt_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_card_funding_call_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'provider_calls'
    AND index_name = 'idx_provider_calls_card_funding'
);
SET @sql := IF(@has_card_funding_call_idx = 0,
  'ALTER TABLE provider_calls ADD INDEX idx_provider_calls_card_funding (card_funding_attempt_id, started_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_card_funding_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'provider_calls'
    AND constraint_name = 'fk_provider_calls_card_funding'
);
SET @sql := IF(@has_card_funding_fk = 0,
  'ALTER TABLE provider_calls ADD CONSTRAINT fk_provider_calls_card_funding FOREIGN KEY (card_funding_attempt_id) REFERENCES card_funding_attempts(id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
