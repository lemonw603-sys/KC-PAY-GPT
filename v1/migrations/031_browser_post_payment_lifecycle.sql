-- Browser post-payment lifecycle. This migration is additive and keeps all
-- payment writes disabled by default. PAYMENT_CONFIRMED is not final success:
-- Plus activation and cancellation must be observed and recorded first.
SET @browser_post_payment_ddl = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'browser_post_payment_observations'
    ),
    'SELECT 1',
    'CREATE TABLE browser_post_payment_observations (
       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       browser_run_id CHAR(36) NOT NULL,
       observation_kind VARCHAR(40) NOT NULL,
       observation_status VARCHAR(32) NOT NULL,
       evidence_hash CHAR(64) NULL,
       evidence_json JSON NULL,
       observed_at TIMESTAMP(3) NOT NULL,
       created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       UNIQUE KEY uq_browser_post_payment_observation (browser_run_id, observation_kind, observed_at),
       KEY idx_browser_post_payment_run (browser_run_id, observation_kind, observed_at),
       CONSTRAINT fk_browser_post_payment_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  )
);
PREPARE browser_post_payment_stmt FROM @browser_post_payment_ddl;
EXECUTE browser_post_payment_stmt;
DEALLOCATE PREPARE browser_post_payment_stmt;

SET @browser_post_payment_state_ddl = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'browser_runs'
        AND column_name = 'post_payment_state'
    ),
    'SELECT 1',
    'ALTER TABLE browser_runs
       ADD COLUMN post_payment_state VARCHAR(32) NOT NULL DEFAULT ''NOT_STARTED'' AFTER payment_state,
       ADD COLUMN plus_activated_at TIMESTAMP(3) NULL AFTER post_payment_state,
       ADD COLUMN cancellation_confirmed_at TIMESTAMP(3) NULL AFTER plus_activated_at'
  )
);
PREPARE browser_post_payment_state_stmt FROM @browser_post_payment_state_ddl;
EXECUTE browser_post_payment_state_stmt;
DEALLOCATE PREPARE browser_post_payment_state_stmt;

SET @browser_post_payment_index_ddl = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'browser_runs'
        AND index_name = 'idx_browser_runs_post_payment_state'
    ),
    'SELECT 1',
    'ALTER TABLE browser_runs ADD KEY idx_browser_runs_post_payment_state (post_payment_state, updated_at)'
  )
);
PREPARE browser_post_payment_index_stmt FROM @browser_post_payment_index_ddl;
EXECUTE browser_post_payment_index_stmt;
DEALLOCATE PREPARE browser_post_payment_index_stmt;

SET @browser_post_payment_check_ddl = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = 'browser_runs'
        AND constraint_name = 'chk_browser_runs_post_payment_state'
    ),
    'SELECT 1',
    'ALTER TABLE browser_runs ADD CONSTRAINT chk_browser_runs_post_payment_state CHECK (post_payment_state IN (
       ''NOT_STARTED'', ''PLUS_PENDING'', ''PLUS_CONFIRMED'', ''CANCELLATION_PENDING'',
       ''CANCELLATION_CONFIRMED'', ''POST_PAYMENT_UNKNOWN'', ''POST_PAYMENT_FAILED''
     ))'
  )
);
PREPARE browser_post_payment_check_stmt FROM @browser_post_payment_check_ddl;
EXECUTE browser_post_payment_check_stmt;
DEALLOCATE PREPARE browser_post_payment_check_stmt;
