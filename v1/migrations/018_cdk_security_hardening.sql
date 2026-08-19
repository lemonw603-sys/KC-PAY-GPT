ALTER TABLE cdks
  ADD COLUMN hash_version VARCHAR(32) NOT NULL DEFAULT 'sha256-v1' AFTER code_hash,
  ADD KEY idx_cdks_hash_version (hash_version, code_hash);

ALTER TABLE cdk_batches
  MODIFY COLUMN codes_ciphertext MEDIUMBLOB NULL;

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('admin_session_version', '1')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

CREATE TABLE IF NOT EXISTS cdk_admin_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(48) NOT NULL,
  batch_no VARCHAR(64) NULL,
  actor_id VARCHAR(128) NOT NULL DEFAULT 'admin',
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_cdk_admin_events_created (created_at),
  KEY idx_cdk_admin_events_batch (batch_no, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
