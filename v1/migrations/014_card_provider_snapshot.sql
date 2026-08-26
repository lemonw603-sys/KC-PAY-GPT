CREATE TABLE IF NOT EXISTS card_provider_snapshots (
  provider VARCHAR(32) PRIMARY KEY,
  payload_json JSON NOT NULL,
  synced_at TIMESTAMP(3) NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE card_stock_jobs
  ADD COLUMN estimated_total DECIMAL(18,6) NULL AFTER amount,
  ADD COLUMN rules_snapshot_json JSON NULL AFTER estimated_total;

ALTER TABLE cards
  ADD COLUMN card_number_ciphertext MEDIUMBLOB NULL AFTER card_credentials_ciphertext;
