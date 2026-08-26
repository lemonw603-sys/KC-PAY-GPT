-- Foundation v2 operations semantics.
-- Keep duplicate detection time separate from row maintenance time.

SET @foundation_v2_ops_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'reconciliation_cases'
      AND COLUMN_NAME = 'last_seen_at'
  ),
  'DO 0',
  'ALTER TABLE reconciliation_cases ADD COLUMN last_seen_at TIMESTAMP(3) NULL AFTER detected_at'
);
PREPARE foundation_v2_ops_stmt FROM @foundation_v2_ops_ddl;
EXECUTE foundation_v2_ops_stmt;
DEALLOCATE PREPARE foundation_v2_ops_stmt;

UPDATE reconciliation_cases
SET last_seen_at = COALESCE(last_seen_at, updated_at, detected_at)
WHERE last_seen_at IS NULL;

SET @foundation_v2_ops_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'reconciliation_cases'
      AND INDEX_NAME = 'idx_reconciliation_cases_last_seen'
  ),
  'DO 0',
  'ALTER TABLE reconciliation_cases ADD KEY idx_reconciliation_cases_last_seen (status, last_seen_at)'
);
PREPARE foundation_v2_ops_stmt FROM @foundation_v2_ops_ddl;
EXECUTE foundation_v2_ops_stmt;
DEALLOCATE PREPARE foundation_v2_ops_stmt;
