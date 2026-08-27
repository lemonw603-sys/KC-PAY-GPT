ALTER TABLE cards
  ADD COLUMN last_transaction_synced_at TIMESTAMP(3) NULL AFTER last_synced_at;

CREATE TABLE IF NOT EXISTS card_sync_jobs (
  id CHAR(36) PRIMARY KEY,
  card_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  requested_by VARCHAR(128) NOT NULL DEFAULT 'admin',
  dedupe_key VARCHAR(191) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  leased_by VARCHAR(128) NULL,
  leased_until TIMESTAMP(3) NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(1000) NULL,
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_card_sync_jobs_dedupe (dedupe_key),
  KEY idx_card_sync_jobs_claim (status, available_at, created_at),
  KEY idx_card_sync_jobs_card (card_id, created_at),
  CONSTRAINT fk_card_sync_jobs_card FOREIGN KEY (card_id) REFERENCES cards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_state_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  card_id CHAR(36) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  source VARCHAR(64) NOT NULL,
  previous_json JSON NULL,
  current_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_card_state_events_card (card_id, id),
  CONSTRAINT fk_card_state_events_card FOREIGN KEY (card_id) REFERENCES cards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
