CREATE TABLE IF NOT EXISTS cdk_batches (
  batch_no VARCHAR(64) PRIMARY KEY,
  request_key VARCHAR(128) NOT NULL,
  plan_type VARCHAR(24) NOT NULL DEFAULT 'plus',
  requested_count INT UNSIGNED NOT NULL,
  codes_ciphertext MEDIUMBLOB NOT NULL,
  created_by VARCHAR(128) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at TIMESTAMP(3) NULL,
  revoke_reason VARCHAR(500) NULL,
  UNIQUE KEY uq_cdk_batches_request_key (request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
