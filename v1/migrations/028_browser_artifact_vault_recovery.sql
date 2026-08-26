-- Cross-process Browser artifact vault metadata.
-- Ciphertext is separated from the ordinary artifact index and requires an
-- application-supplied key version. No key or plaintext authority is stored.

CREATE TABLE IF NOT EXISTS browser_artifact_secrets (
  secret_ref VARCHAR(255) PRIMARY KEY,
  browser_run_id CHAR(36) NOT NULL,
  key_version SMALLINT UNSIGNED NOT NULL,
  iv VARBINARY(12) NULL,
  auth_tag VARBINARY(16) NULL,
  ciphertext MEDIUMBLOB NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  destroyed_at TIMESTAMP(3) NULL,
  KEY idx_browser_artifact_secrets_expiry (destroyed_at, expires_at),
  KEY idx_browser_artifact_secrets_run (browser_run_id, destroyed_at),
  CONSTRAINT fk_browser_artifact_secrets_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id),
  CONSTRAINT chk_browser_artifact_secret_material CHECK (
    (destroyed_at IS NULL AND iv IS NOT NULL AND auth_tag IS NOT NULL AND ciphertext IS NOT NULL)
    OR (destroyed_at IS NOT NULL AND iv IS NULL AND auth_tag IS NULL AND ciphertext IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @browser_vault_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'checkout_artifacts'
      AND COLUMN_NAME = 'expires_at'
  ),
  'DO 0',
  'ALTER TABLE checkout_artifacts ADD COLUMN expires_at TIMESTAMP(3) NULL AFTER created_at'
);
PREPARE browser_vault_stmt FROM @browser_vault_ddl;
EXECUTE browser_vault_stmt;
DEALLOCATE PREPARE browser_vault_stmt;

SET @browser_vault_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'checkout_artifacts'
      AND COLUMN_NAME = 'destroyed_at'
  ),
  'DO 0',
  'ALTER TABLE checkout_artifacts ADD COLUMN destroyed_at TIMESTAMP(3) NULL AFTER invalidated_at'
);
PREPARE browser_vault_stmt FROM @browser_vault_ddl;
EXECUTE browser_vault_stmt;
DEALLOCATE PREPARE browser_vault_stmt;

SET @browser_vault_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'checkout_artifacts'
      AND INDEX_NAME = 'idx_checkout_artifacts_expiry'
  ),
  'DO 0',
  'ALTER TABLE checkout_artifacts ADD INDEX idx_checkout_artifacts_expiry (status, expires_at)'
);
PREPARE browser_vault_stmt FROM @browser_vault_ddl;
EXECUTE browser_vault_stmt;
DEALLOCATE PREPARE browser_vault_stmt;

SET @browser_vault_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'checkout_artifacts'
      AND CONSTRAINT_NAME = 'fk_checkout_artifacts_secret_ref'
  ),
  'DO 0',
  'ALTER TABLE checkout_artifacts ADD CONSTRAINT fk_checkout_artifacts_secret_ref FOREIGN KEY (secret_ref) REFERENCES browser_artifact_secrets(secret_ref)'
);
PREPARE browser_vault_stmt FROM @browser_vault_ddl;
EXECUTE browser_vault_stmt;
DEALLOCATE PREPARE browser_vault_stmt;
