-- Link each consumption reservation to the exact funds-risk attempt.
-- Kept additive because migration 038 may already exist in an environment.
SET @card_consumption_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'card_consumption_ledger'
      AND COLUMN_NAME = 'recharge_attempt_id'),
  'DO 0',
  'ALTER TABLE card_consumption_ledger ADD COLUMN recharge_attempt_id CHAR(36) NULL AFTER order_id'
);
PREPARE card_consumption_stmt FROM @card_consumption_ddl;
EXECUTE card_consumption_stmt;
DEALLOCATE PREPARE card_consumption_stmt;

SET @card_consumption_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'card_consumption_ledger'
      AND INDEX_NAME = 'uq_card_consumption_attempt'),
  'DO 0',
  'ALTER TABLE card_consumption_ledger ADD UNIQUE INDEX uq_card_consumption_attempt (recharge_attempt_id)'
);
PREPARE card_consumption_stmt FROM @card_consumption_ddl;
EXECUTE card_consumption_stmt;
DEALLOCATE PREPARE card_consumption_stmt;

SET @card_consumption_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'card_consumption_ledger'
      AND CONSTRAINT_NAME = 'fk_card_consumption_attempt'),
  'DO 0',
  'ALTER TABLE card_consumption_ledger ADD CONSTRAINT fk_card_consumption_attempt FOREIGN KEY (recharge_attempt_id) REFERENCES recharge_attempts(id)'
);
PREPARE card_consumption_stmt FROM @card_consumption_ddl;
EXECUTE card_consumption_stmt;
DEALLOCATE PREPARE card_consumption_stmt;
