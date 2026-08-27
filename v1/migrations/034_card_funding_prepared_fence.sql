-- Prevent concurrent schedulers from creating two PREPARED funding attempts
-- for the same card. Active/unknown/settled attempts already have a separate
-- funds fence in migration 030.
SELECT COUNT(*) INTO @duplicate_prepared_funding_cards
FROM (
  SELECT card_id FROM card_funding_attempts
  WHERE status = 'PREPARED'
  GROUP BY card_id HAVING COUNT(*) > 1
) duplicate_cards;
SET @card_funding_prepared_ddl = IF(
  @duplicate_prepared_funding_cards = 0,
  'DO 0',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''duplicate PREPARED card funding attempts must be reconciled before migration 034'''
);
PREPARE card_funding_prepared_stmt FROM @card_funding_prepared_ddl;
EXECUTE card_funding_prepared_stmt;
DEALLOCATE PREPARE card_funding_prepared_stmt;

SET @card_funding_prepared_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'card_funding_attempts'
      AND COLUMN_NAME = 'prepared_card_id'
  ),
  'DO 0',
  'ALTER TABLE card_funding_attempts ADD COLUMN prepared_card_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status = ''PREPARED'' THEN card_id ELSE NULL END) STORED AFTER funds_risk_state'
);
PREPARE card_funding_prepared_stmt FROM @card_funding_prepared_ddl;
EXECUTE card_funding_prepared_stmt;
DEALLOCATE PREPARE card_funding_prepared_stmt;

SET @card_funding_prepared_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'card_funding_attempts'
      AND INDEX_NAME = 'uq_card_funding_prepared_card'
  ),
  'DO 0',
  'ALTER TABLE card_funding_attempts ADD UNIQUE INDEX uq_card_funding_prepared_card (prepared_card_id)'
);
PREPARE card_funding_prepared_stmt FROM @card_funding_prepared_ddl;
EXECUTE card_funding_prepared_stmt;
DEALLOCATE PREPARE card_funding_prepared_stmt;
