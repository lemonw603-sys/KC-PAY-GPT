-- Settled card top-ups are historical records and must not permanently fence
-- the card.  Keep the funds fence only while a provider side effect is live
-- or unresolved (ACTIVE/UNKNOWN), so a later low-balance scan can prepare a
-- new idempotent top-up after the previous one has settled and been spent.
-- The migration is additive to the ledger: no rows are deleted or rewritten.
SET @has_card_funding_fence := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'card_funding_attempts'
    AND COLUMN_NAME = 'funds_fence_card_id'
);
SET @card_funding_fence_ddl := IF(
  @has_card_funding_fence = 1,
  'ALTER TABLE card_funding_attempts MODIFY COLUMN funds_fence_card_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN funds_risk_state IN (''ACTIVE'',''UNKNOWN'') THEN card_id ELSE NULL END) STORED',
  'DO 0'
);
PREPARE card_funding_fence_stmt FROM @card_funding_fence_ddl;
EXECUTE card_funding_fence_stmt;
DEALLOCATE PREPARE card_funding_fence_stmt;
