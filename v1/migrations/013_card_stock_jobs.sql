CREATE TABLE IF NOT EXISTS card_stock_jobs (
  id CHAR(36) PRIMARY KEY,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  card_type_id VARCHAR(128) NOT NULL,
  amount DECIMAL(18,6) NOT NULL,
  requested_count INT UNSIGNED NOT NULL,
  opened_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(1000) NULL,
  leased_by VARCHAR(128) NULL,
  leased_until TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at TIMESTAMP(3) NULL,
  finished_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_card_stock_jobs_claim (status, created_at),
  KEY idx_card_stock_jobs_recent (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
