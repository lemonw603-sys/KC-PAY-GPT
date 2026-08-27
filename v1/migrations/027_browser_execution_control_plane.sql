-- Browser execution control-plane mapping.
-- Additive only: production Browser writes remain disabled until a later rollout.

CREATE TABLE IF NOT EXISTS executor_profiles (
  id CHAR(36) PRIMARY KEY,
  profile_code VARCHAR(96) NOT NULL,
  profile_version INT UNSIGNED NOT NULL,
  executor_kind VARCHAR(16) NOT NULL,
  runtime_id VARCHAR(64) NOT NULL,
  adapter_version VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DISABLED',
  config_public_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retired_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_executor_profiles_code_version (profile_code, profile_version),
  KEY idx_executor_profiles_runtime (executor_kind, status),
  CONSTRAINT chk_executor_profiles_kind CHECK (executor_kind IN ('BROWSER')),
  CONSTRAINT chk_executor_profiles_status CHECK (status IN ('DISABLED', 'ACTIVE', 'RETIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @browser_control_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'recharge_attempts'
      AND COLUMN_NAME = 'executor_profile_id'
  ),
  'DO 0',
  'ALTER TABLE recharge_attempts ADD COLUMN executor_profile_id CHAR(36) NULL AFTER executor_kind'
);
PREPARE browser_control_stmt FROM @browser_control_ddl;
EXECUTE browser_control_stmt;
DEALLOCATE PREPARE browser_control_stmt;

SET @browser_control_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'recharge_attempts'
      AND CONSTRAINT_NAME = 'fk_recharge_attempts_executor_profile'
  ),
  'DO 0',
  'ALTER TABLE recharge_attempts ADD CONSTRAINT fk_recharge_attempts_executor_profile FOREIGN KEY (executor_profile_id) REFERENCES executor_profiles(id)'
);
PREPARE browser_control_stmt FROM @browser_control_ddl;
EXECUTE browser_control_stmt;
DEALLOCATE PREPARE browser_control_stmt;

CREATE TABLE IF NOT EXISTS browser_runs (
  id CHAR(36) PRIMARY KEY,
  recharge_attempt_id CHAR(36) NOT NULL,
  executor_profile_id CHAR(36) NOT NULL,
  run_no INT UNSIGNED NOT NULL,
  start_operation_key VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'READY',
  payment_state VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
  account_key_hmac CHAR(64) NOT NULL,
  worker_id VARCHAR(128) NULL,
  worker_lease_token_hash CHAR(64) NULL,
  worker_lease_until TIMESTAMP(3) NULL,
  control_state VARCHAR(24) NOT NULL DEFAULT 'AUTOMATION',
  automation_owner_id VARCHAR(128) NULL,
  human_owner_id VARCHAR(128) NULL,
  requested_by VARCHAR(128) NULL,
  selected_lane VARCHAR(96) NULL,
  last_checkpoint_sequence INT UNSIGNED NOT NULL DEFAULT 0,
  last_checkpoint_kind VARCHAR(64) NULL,
  last_error_code VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  active_attempt_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status IN ('READY', 'RUNNING', 'RECONCILE_ONLY', 'HUMAN_REQUIRED')
      THEN recharge_attempt_id ELSE NULL END
  ) STORED,
  active_account_key_hmac CHAR(64) GENERATED ALWAYS AS (
    CASE WHEN status IN ('READY', 'RUNNING', 'RECONCILE_ONLY', 'HUMAN_REQUIRED')
      THEN account_key_hmac ELSE NULL END
  ) STORED,
  UNIQUE KEY uq_browser_runs_attempt_no (recharge_attempt_id, run_no),
  UNIQUE KEY uq_browser_runs_start_operation (start_operation_key),
  UNIQUE KEY uq_browser_runs_active_attempt (active_attempt_id),
  UNIQUE KEY uq_browser_runs_active_account (active_account_key_hmac),
  KEY idx_browser_runs_worker_lease (status, worker_lease_until),
  KEY idx_browser_runs_payment_state (payment_state, updated_at),
  CONSTRAINT chk_browser_runs_status CHECK (status IN (
    'READY', 'RUNNING', 'RECONCILE_ONLY', 'HUMAN_REQUIRED', 'COMPLETED', 'FAILED_SAFE'
  )),
  CONSTRAINT chk_browser_runs_payment_state CHECK (payment_state IN (
    'NOT_STARTED', 'PAYMENT_ARMED', 'PAYMENT_SUBMITTING', 'PAYMENT_UNKNOWN',
    'PAYMENT_DECLINED', 'PAYMENT_CONFIRMED'
  )),
  CONSTRAINT chk_browser_runs_control_state CHECK (control_state IN (
    'AUTOMATION', 'REQUESTED', 'FROZEN', 'TRANSFERRED', 'RELEASED'
  )),
  CONSTRAINT fk_browser_runs_attempt FOREIGN KEY (recharge_attempt_id) REFERENCES recharge_attempts(id),
  CONSTRAINT fk_browser_runs_profile FOREIGN KEY (executor_profile_id) REFERENCES executor_profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_checkpoints (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  browser_run_id CHAR(36) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  checkpoint_kind VARCHAR(64) NOT NULL,
  payment_risk VARCHAR(16) NOT NULL DEFAULT 'NONE',
  operation_id VARCHAR(191) NULL,
  page_signature_hash CHAR(64) NULL,
  evidence_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_browser_checkpoints_sequence (browser_run_id, sequence_no),
  UNIQUE KEY uq_browser_checkpoints_operation (browser_run_id, operation_id),
  KEY idx_browser_checkpoints_kind_time (checkpoint_kind, created_at),
  CONSTRAINT chk_browser_checkpoints_risk CHECK (payment_risk IN ('NONE', 'ARMED', 'SUBMITTING', 'UNKNOWN', 'SETTLED')),
  CONSTRAINT fk_browser_checkpoints_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_operations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  browser_run_id CHAR(36) NOT NULL,
  operation_id VARCHAR(191) NOT NULL,
  operation_type VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  result_code VARCHAR(64) NULL,
  public_result_json JSON NULL,
  prepared_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_browser_operations_idempotency (browser_run_id, operation_id),
  KEY idx_browser_operations_recovery (status, prepared_at),
  CONSTRAINT chk_browser_operations_status CHECK (status IN ('COMMITTED', 'ABORTED', 'OUTCOME_UNKNOWN')),
  CONSTRAINT fk_browser_operations_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_permits (
  id CHAR(36) PRIMARY KEY,
  recharge_attempt_id CHAR(36) NOT NULL,
  browser_run_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ISSUED',
  nonce_hash CHAR(64) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  issued_to VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  issued_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumed_at TIMESTAMP(3) NULL,
  revoked_at TIMESTAMP(3) NULL,
  active_attempt_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status = 'ISSUED' THEN recharge_attempt_id ELSE NULL END
  ) STORED,
  consumed_attempt_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status = 'CONSUMED' THEN recharge_attempt_id ELSE NULL END
  ) STORED,
  UNIQUE KEY uq_payment_permits_active_attempt (active_attempt_id),
  UNIQUE KEY uq_payment_permits_consumed_attempt (consumed_attempt_id),
  KEY idx_payment_permits_expiry (status, expires_at),
  CONSTRAINT chk_payment_permits_status CHECK (status IN ('ISSUED', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT fk_payment_permits_attempt FOREIGN KEY (recharge_attempt_id) REFERENCES recharge_attempts(id),
  CONSTRAINT fk_payment_permits_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkout_artifacts (
  id CHAR(36) PRIMARY KEY,
  browser_run_id CHAR(36) NOT NULL,
  account_key_hmac CHAR(64) NOT NULL,
  artifact_kind VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  secret_ref VARCHAR(255) NOT NULL,
  url_hash CHAR(64) NOT NULL,
  checkout_hash CHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  opened_at TIMESTAMP(3) NULL,
  invalidated_at TIMESTAMP(3) NULL,
  active_account_key_hmac CHAR(64) GENERATED ALWAYS AS (
    CASE WHEN status IN ('ACTIVE', 'REVIEW_REQUIRED') THEN account_key_hmac ELSE NULL END
  ) STORED,
  UNIQUE KEY uq_checkout_artifacts_active_account (active_account_key_hmac),
  KEY idx_checkout_artifacts_run_time (browser_run_id, created_at),
  CONSTRAINT chk_checkout_artifacts_kind CHECK (artifact_kind IN ('HOSTED_COMPLETE', 'INTERNAL_SESSION_BOUND')),
  CONSTRAINT chk_checkout_artifacts_status CHECK (status IN ('ACTIVE', 'REVIEW_REQUIRED', 'INVALIDATED', 'CONSUMED')),
  CONSTRAINT fk_checkout_artifacts_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS execution_resource_leases (
  id CHAR(36) PRIMARY KEY,
  resource_type VARCHAR(32) NOT NULL,
  resource_key_hmac CHAR(64) NOT NULL,
  browser_run_id CHAR(36) NOT NULL,
  owner_id VARCHAR(128) NOT NULL,
  lease_token_hash CHAR(64) NOT NULL,
  lease_until TIMESTAMP(3) NOT NULL,
  acquired_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  heartbeat_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  released_at TIMESTAMP(3) NULL,
  release_reason VARCHAR(255) NULL,
  active_resource_key VARCHAR(100) GENERATED ALWAYS AS (
    CASE WHEN released_at IS NULL THEN CONCAT(resource_type, ':', resource_key_hmac) ELSE NULL END
  ) STORED,
  UNIQUE KEY uq_execution_resource_leases_active (active_resource_key),
  KEY idx_execution_resource_leases_expiry (released_at, lease_until),
  KEY idx_execution_resource_leases_run (browser_run_id, released_at),
  CONSTRAINT chk_execution_resource_leases_type CHECK (resource_type IN ('ACCOUNT', 'ORDER', 'CARD', 'CHECKOUT_ARTIFACT')),
  CONSTRAINT fk_execution_resource_leases_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_interventions (
  id CHAR(36) PRIMARY KEY,
  browser_run_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  requested_by VARCHAR(128) NOT NULL,
  automation_owner_id VARCHAR(128) NULL,
  human_owner_id VARCHAR(128) NULL,
  reason_code VARCHAR(64) NOT NULL,
  result_code VARCHAR(64) NULL,
  public_note VARCHAR(500) NULL,
  requested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  transferred_at TIMESTAMP(3) NULL,
  finished_at TIMESTAMP(3) NULL,
  active_run_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status IN ('REQUESTED', 'FROZEN', 'TRANSFERRED') THEN browser_run_id ELSE NULL END
  ) STORED,
  UNIQUE KEY uq_browser_interventions_active_run (active_run_id),
  KEY idx_browser_interventions_queue (status, requested_at),
  CONSTRAINT chk_browser_interventions_status CHECK (status IN ('REQUESTED', 'FROZEN', 'TRANSFERRED', 'RELEASED', 'CANCELLED')),
  CONSTRAINT fk_browser_interventions_run FOREIGN KEY (browser_run_id) REFERENCES browser_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO executor_profiles
  (id, profile_code, profile_version, executor_kind, runtime_id, adapter_version, status, config_public_json)
VALUES
  ('00000000-0000-4000-8000-000000000401', 'CHATGPT_PLUS_BROWSER_V1', 1,
   'BROWSER', 'UNFROZEN', 'UNFROZEN', 'DISABLED',
   JSON_OBJECT('productionWritesEnabled', FALSE, 'evidence', 'design-only seed'))
ON DUPLICATE KEY UPDATE profile_code = profile_code;

INSERT INTO fulfillment_routes
  (id, route_code, route_version, product_id, card_provider_account_id,
   recharge_provider_account_id, executor_kind, accepts_new_orders, immutable)
VALUES
  ('00000000-0000-4000-8000-000000000302', 'CHATGPT_PLUS_BROWSER_V1', 1,
   '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000101', NULL, 'BROWSER', 0, 1)
ON DUPLICATE KEY UPDATE route_code = route_code;

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('browser_dispatch_enabled', 'false'),
  ('browser_payment_writes_enabled', 'false')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
