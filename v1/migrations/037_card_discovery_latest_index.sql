-- Speed up latest-per-provider-card intake queries used by the admin overview.
-- Additive and replay-safe; no provider or card writes are performed.
SET @ddl := IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'card_discoveries'
      AND INDEX_NAME = 'idx_card_discoveries_latest'
  ),
  'SELECT 1',
  'ALTER TABLE card_discoveries ADD INDEX idx_card_discoveries_latest (provider_account_id, external_card_id, first_seen_at, id)'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
