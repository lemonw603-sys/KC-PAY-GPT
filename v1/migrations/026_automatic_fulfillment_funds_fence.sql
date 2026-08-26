-- Stage 3: automatic fulfillment keeps exactly one create intent per funds attempt.
-- The generated key is NULL for reads/polls, so future executor evidence can still
-- reference the same attempt without weakening create-direct uniqueness.

-- Fail before any Stage 3 mutation if historical data would violate the new
-- uniqueness rule.  Such rows require an explicit reconciliation decision.
SELECT COUNT(*) INTO @duplicate_recharge_create_attempts
FROM (
  SELECT recharge_attempt_id
  FROM provider_calls
  WHERE operation = 'create_direct' AND recharge_attempt_id IS NOT NULL
  GROUP BY recharge_attempt_id
  HAVING COUNT(*) > 1
) duplicate_attempts;
SET @automatic_fulfillment_ddl = IF(
  @duplicate_recharge_create_attempts = 0,
  'DO 0',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''duplicate create_direct calls must be reconciled before migration 026'''
);
PREPARE automatic_fulfillment_stmt FROM @automatic_fulfillment_ddl;
EXECUTE automatic_fulfillment_stmt;
DEALLOCATE PREPARE automatic_fulfillment_stmt;

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('recharge_dispatch_mode', 'AUTOMATIC')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);

-- Evidence-bound compatibility repair: a historical create call that is
-- already a finished, definite rejection cannot have charged funds.  Link it
-- to a CLEARED attempt so the immutable Provider ledger is complete.  Unknown,
-- unfinished, successful, or externally identified calls are deliberately not
-- backfilled and remain readiness blockers.
INSERT INTO recharge_attempts
  (id, order_id, fulfillment_route_id, provider_account_id,
   authorization_item_id, executor_kind, status, funds_risk_state,
   idempotency_key, submit_intent_at, finished_at, result_summary_json,
   created_at, updated_at)
SELECT UUID(), pc.order_id, o.fulfillment_route_id,
       COALESCE(pc.provider_account_id, fr.recharge_provider_account_id),
       NULL, COALESCE(fr.executor_kind, 'API'), 'REJECTED', 'CLEARED',
       CONCAT('legacy-provider-call:', pc.id), pc.started_at,
       COALESCE(pc.finished_at, pc.started_at),
       JSON_OBJECT(
         'source', 'stage3_definite_failure_backfill',
         'outcome', pc.outcome,
         'businessCode', pc.business_code
       ),
       pc.started_at, COALESCE(pc.finished_at, pc.started_at)
FROM provider_calls pc
INNER JOIN orders o ON o.id = pc.order_id
LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
WHERE pc.operation = 'create_direct'
  AND pc.recharge_attempt_id IS NULL
  AND pc.outcome = 'DEFINITE_FAILURE'
  AND pc.finished_at IS NOT NULL
  AND o.status = 'RECHARGE_FAILED'
  AND o.recharge_order_no IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM recharge_attempts existing
    WHERE existing.idempotency_key = CONCAT('legacy-provider-call:', pc.id)
  );

UPDATE provider_calls pc
INNER JOIN recharge_attempts rat
  ON rat.order_id = pc.order_id
 AND rat.idempotency_key = CONCAT('legacy-provider-call:', pc.id)
SET pc.recharge_attempt_id = rat.id
WHERE pc.operation = 'create_direct'
  AND pc.recharge_attempt_id IS NULL
  AND pc.outcome = 'DEFINITE_FAILURE'
  AND pc.finished_at IS NOT NULL;

SET @automatic_fulfillment_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'provider_calls'
      AND COLUMN_NAME = 'recharge_create_attempt_id'
  ),
  'DO 0',
  'ALTER TABLE provider_calls ADD COLUMN recharge_create_attempt_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN operation = ''create_direct'' THEN recharge_attempt_id ELSE NULL END) STORED AFTER recharge_attempt_id'
);
PREPARE automatic_fulfillment_stmt FROM @automatic_fulfillment_ddl;
EXECUTE automatic_fulfillment_stmt;
DEALLOCATE PREPARE automatic_fulfillment_stmt;

SET @automatic_fulfillment_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'provider_calls'
      AND INDEX_NAME = 'uq_provider_calls_recharge_create_attempt'
  ),
  'DO 0',
  'ALTER TABLE provider_calls ADD UNIQUE INDEX uq_provider_calls_recharge_create_attempt (recharge_create_attempt_id)'
);
PREPARE automatic_fulfillment_stmt FROM @automatic_fulfillment_ddl;
EXECUTE automatic_fulfillment_stmt;
DEALLOCATE PREPARE automatic_fulfillment_stmt;
