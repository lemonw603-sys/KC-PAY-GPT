import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createBrowserExecutionRepository } from '../src/db/repositories/browser-execution-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';

test('Browser MySQL mapping preserves one payment action and locks unknown results for reconciliation', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；Browser MySQL 集成测试只在隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO executor_profiles
       (id, profile_code, profile_version, executor_kind, runtime_id,
        adapter_version, status, config_public_json)
       VALUES (?, ?, 1, 'BROWSER', 'MYSQL_TEST', 'MYSQL_TEST', 'ACTIVE',
         JSON_OBJECT('isolatedTest', TRUE))`,
      [profileId, `BROWSER_MYSQL_TEST_${profileId}`]
    );
    await pool.query(
      `UPDATE app_settings SET setting_value = 'true'
       WHERE setting_key = 'browser_payment_writes_enabled'`
    );
    await pool.query(
      `INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
      [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]
    );
    await pool.query(
      `INSERT INTO orders
       (id, public_no, cdk_id, status, card_type_id, open_card_amount,
        minimum_required_card_balance, session_ciphertext,
        card_purchase_idempotency_key, product_id, fulfillment_route_id,
        route_resolution_status)
       VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '7', 25, 16, ?, ?, ?, ?, 'RESOLVED')`,
      [orderId, `BROWSER-TEST-${orderId}`, cdkId, Buffer.from('isolated-test-session'),
        `browser-test-purchase-${orderId}`, productId, routeId]
    );
    await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, provider_account_id, external_card_id,
        intake_status, sync_tier, last_synced_at, last_transaction_synced_at)
       VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING',
         ?, '00000000-0000-4000-8000-000000000101', ?, 'ACCEPTED', 'ASSIGNED',
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [cardId, orderId, `browser-test-card-${cardId}`, Buffer.from('isolated-test-card'),
        `browser-test-card-${cardId}`]
    );
    await pool.query(
      `INSERT INTO recharge_attempts
       (id, order_id, fulfillment_route_id, executor_kind, status,
        funds_risk_state, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?,
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [attemptId, orderId, routeId, `browser-test:${attemptId}`]
    );
    await pool.query(
      `INSERT INTO card_consumption_ledger
       (id, card_id, order_id, recharge_attempt_id, product_id, status, amount, currency)
       VALUES (?, ?, ?, ?, ?, 'RESERVED', 25, 'USD')`,
      [crypto.randomUUID(), cardId, orderId, attemptId, productId]
    );

    const repository = createBrowserExecutionRepository(pool);
    const started = await repository.beginRun({
      attemptId, executorProfileId: profileId,
      accountKeyHmac: crypto.createHmac('sha256', 'isolated-browser-test')
        .update(orderId).digest('hex'),
      workerId: 'browser-mysql-test-worker',
      startOperationKey: `browser-start:${attemptId}`,
      runId,
      leaseSeconds: 300
    });
    const permit = await repository.issuePaymentPermit({
      runId, workerId: 'browser-mysql-test-worker',
      leaseToken: started.leaseToken,
      ttlSeconds: 120
    });
    const first = await repository.commitPaymentSubmissionIntent({
      runId, workerId: 'browser-mysql-test-worker',
      leaseToken: started.leaseToken, permitNonce: permit.permitNonce,
      operationId: `browser-submit:${attemptId}`
    });
    const replay = await repository.commitPaymentSubmissionIntent({
      runId, workerId: 'browser-mysql-test-worker',
      leaseToken: 'not-consulted-on-replay', permitNonce: 'not-consulted-on-replay',
      operationId: `browser-submit:${attemptId}`
    });
    assert.equal(first.executeExternal, true);
    assert.equal(replay.executeExternal, false);
    assert.equal(replay.idempotentReplay, true);

    await repository.markPaymentUnknown({
      runId,
      operationId: `browser-unknown:${attemptId}`,
      reasonCode: 'ISOLATED_TEST_DISCONNECT'
    });
    const recovery = await repository.getRecoveryState(runId);
    assert.equal(recovery.recoveryMode, 'RECONCILE_ONLY');
    assert.equal(recovery.fundsRiskState, 'UNKNOWN');

    const [[stored]] = await pool.query(
      `SELECT br.status AS run_status, br.payment_state,
              rat.status AS attempt_status, rat.funds_risk_state,
              o.status AS order_status,
              (SELECT COUNT(*) FROM payment_permits pp
                WHERE pp.recharge_attempt_id = rat.id AND pp.status = 'CONSUMED') AS consumed_permits,
              (SELECT COUNT(*) FROM browser_operations bo
                WHERE bo.browser_run_id = br.id AND bo.operation_type = 'PAYMENT_SUBMIT') AS submit_operations
       FROM browser_runs br
       INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
       INNER JOIN orders o ON o.id = rat.order_id
       WHERE br.id = ?`,
      [runId]
    );
    assert.deepEqual({
      runStatus: stored.run_status,
      paymentState: stored.payment_state,
      attemptStatus: stored.attempt_status,
      fundsRiskState: stored.funds_risk_state,
      orderStatus: stored.order_status,
      consumedPermits: Number(stored.consumed_permits),
      submitOperations: Number(stored.submit_operations)
    }, {
      runStatus: 'RECONCILE_ONLY',
      paymentState: 'PAYMENT_UNKNOWN',
      attemptStatus: 'SUBMIT_UNKNOWN',
      fundsRiskState: 'UNKNOWN',
      orderStatus: 'SUBMIT_UNKNOWN',
      consumedPermits: 1,
      submitOperations: 1
    });
  } finally {
    await pool.query('DELETE FROM reconciliation_cases WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_interventions WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM checkout_artifacts WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_runs WHERE id = ?', [runId]);
    await pool.query('DELETE FROM card_consumption_ledger WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [attemptId]);
    await pool.query('DELETE FROM card_assignment_history WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
    await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
    await pool.query('DELETE FROM executor_profiles WHERE id = ?', [profileId]);
    await pool.query(
      `UPDATE app_settings SET setting_value = 'false'
       WHERE setting_key = 'browser_payment_writes_enabled'`
    );
    await pool.end();
  }
});

test('Browser MySQL pre-payment abort releases every runtime and funds fence atomically', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；Browser MySQL 集成测试只在隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const secretRef = `vault://${artifactId}`;
  const accountKeyHmac = crypto.createHash('sha256').update(`account:${orderId}`).digest('hex');
  try {
    await pool.query(
      `INSERT INTO executor_profiles
       (id, profile_code, profile_version, executor_kind, runtime_id,
        adapter_version, status, config_public_json)
       VALUES (?, ?, 1, 'BROWSER', 'MYSQL_SAFE_ABORT_TEST', 'MYSQL_SAFE_ABORT_TEST',
         'ACTIVE', JSON_OBJECT('isolatedTest', TRUE))`,
      [profileId, `BROWSER_SAFE_ABORT_TEST_${profileId}`]
    );
    await pool.query(
      `UPDATE app_settings SET setting_value = 'true'
       WHERE setting_key = 'browser_payment_writes_enabled'`
    );
    await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')',
      [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
    await pool.query(
      `INSERT INTO orders
       (id, public_no, cdk_id, status, card_type_id, open_card_amount,
        minimum_required_card_balance, session_ciphertext,
        card_purchase_idempotency_key, product_id, fulfillment_route_id,
        route_resolution_status)
       VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '7', 25, 16, ?, ?, ?, ?, 'RESOLVED')`,
      [orderId, `BROWSER-SAFE-ABORT-${orderId}`, cdkId, Buffer.from('isolated-test-session'),
        `browser-safe-abort-purchase-${orderId}`, productId, routeId]
    );
    await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, provider_account_id, external_card_id,
        intake_status, sync_tier, last_synced_at, last_transaction_synced_at)
       VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING',
         ?, '00000000-0000-4000-8000-000000000101', ?, 'ACCEPTED', 'ASSIGNED',
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [cardId, orderId, `browser-safe-abort-card-${cardId}`,
        Buffer.from('isolated-test-card'), `browser-safe-abort-card-${cardId}`]
    );
    await pool.query(
      `INSERT INTO recharge_attempts
       (id, order_id, fulfillment_route_id, executor_kind, status,
        funds_risk_state, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?,
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [attemptId, orderId, routeId, `browser-safe-abort:${attemptId}`]
    );
    await pool.query(
      `INSERT INTO card_consumption_ledger
       (id, card_id, order_id, recharge_attempt_id, product_id, status, amount, currency)
       VALUES (?, ?, ?, ?, ?, 'RESERVED', 25, 'USD')`,
      [crypto.randomUUID(), cardId, orderId, attemptId, productId]
    );
    await pool.query(
      `INSERT INTO browser_dispatch_jobs
       (job_key, recharge_attempt_id, order_id, executor_profile_id, status,
        lease_owner, lease_token_hash, lease_until, queued_at, claimed_at)
       VALUES (?, ?, ?, ?, 'CLAIMED', 'browser-safe-abort-worker', ?,
         DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE),
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [`browser-safe-abort:${attemptId}`, attemptId, orderId, profileId,
        crypto.createHash('sha256').update('dispatch-lease').digest('hex')]
    );

    const repository = createBrowserExecutionRepository(pool);
    const started = await repository.beginRun({
      attemptId, executorProfileId: profileId, accountKeyHmac,
      workerId: 'browser-safe-abort-worker', startOperationKey: `safe-abort-start:${attemptId}`,
      runId, leaseSeconds: 300
    });
    const permit = await repository.issuePaymentPermit({
      runId, workerId: 'browser-safe-abort-worker', leaseToken: started.leaseToken,
      ttlSeconds: 120
    });
    await pool.query(
      `INSERT INTO browser_artifact_secrets
       (secret_ref, browser_run_id, key_version, iv, auth_tag, ciphertext, expires_at)
       VALUES (?, ?, 1, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 MINUTE))`,
      [secretRef, runId, Buffer.alloc(12, 1), Buffer.alloc(16, 2), Buffer.from('ciphertext')]
    );
    await pool.query(
      `INSERT INTO checkout_artifacts
       (id, browser_run_id, account_key_hmac, artifact_kind, status, secret_ref,
        url_hash, expires_at)
       VALUES (?, ?, ?, 'HOSTED_COMPLETE', 'ACTIVE', ?, ?,
         DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 MINUTE))`,
      [artifactId, runId, accountKeyHmac, secretRef,
        crypto.createHash('sha256').update(`url:${artifactId}`).digest('hex')]
    );
    await pool.query(
      `INSERT INTO execution_resource_leases
       (id, resource_type, resource_key_hmac, browser_run_id, owner_id,
        lease_token_hash, lease_until)
       VALUES (?, 'ORDER', ?, ?, 'browser-safe-abort-worker', ?,
         DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
      [crypto.randomUUID(), crypto.createHash('sha256').update(`order:${orderId}`).digest('hex'),
        runId, crypto.createHash('sha256').update('resource-lease').digest('hex')]
    );

    const aborted = await repository.abortBeforePayment({
      runId, workerId: 'browser-safe-abort-worker', leaseToken: started.leaseToken,
      operationId: `safe-abort:${attemptId}`,
      targetOrderStatus: 'WAITING_FOR_SESSION',
      reasonCode: 'SESSION_INVALID', failureReason: 'Session is invalid',
      customerActionCode: 'SESSION_INVALID'
    });
    assert.equal(aborted.runStatus, 'FAILED_SAFE');
    assert.equal(aborted.orderStatus, 'WAITING_FOR_SESSION');

    const [[stored]] = await pool.query(
      `SELECT br.status AS run_status, br.payment_state,
              rat.status AS attempt_status, rat.funds_risk_state,
              o.status AS order_status, o.customer_action_code,
              bdj.status AS dispatch_status, pp.status AS permit_status,
              ca.status AS artifact_status, bas.destroyed_at,
              bas.iv, bas.auth_tag, bas.ciphertext,
              erl.released_at
       FROM browser_runs br
       INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
       INNER JOIN orders o ON o.id = rat.order_id
       INNER JOIN browser_dispatch_jobs bdj ON bdj.recharge_attempt_id = rat.id
       INNER JOIN payment_permits pp ON pp.browser_run_id = br.id
       INNER JOIN checkout_artifacts ca ON ca.browser_run_id = br.id
       INNER JOIN browser_artifact_secrets bas ON bas.secret_ref = ca.secret_ref
       INNER JOIN execution_resource_leases erl ON erl.browser_run_id = br.id
       WHERE br.id = ?`, [runId]
    );
    assert.deepEqual({
      runStatus: stored.run_status,
      paymentState: stored.payment_state,
      attemptStatus: stored.attempt_status,
      fundsRiskState: stored.funds_risk_state,
      orderStatus: stored.order_status,
      customerActionCode: stored.customer_action_code,
      dispatchStatus: stored.dispatch_status,
      permitStatus: stored.permit_status,
      artifactStatus: stored.artifact_status
    }, {
      runStatus: 'FAILED_SAFE', paymentState: 'PAYMENT_ARMED',
      attemptStatus: 'CLEARED', fundsRiskState: 'CLEARED',
      orderStatus: 'WAITING_FOR_SESSION', customerActionCode: 'SESSION_INVALID',
      dispatchStatus: 'CANCELLED', permitStatus: 'REVOKED', artifactStatus: 'INVALIDATED'
    });
    assert.ok(stored.destroyed_at);
    assert.equal(stored.iv, null);
    assert.equal(stored.auth_tag, null);
    assert.equal(stored.ciphertext, null);
    assert.ok(stored.released_at);
    assert.equal(permit.snapshotHash.length, 64);
  } finally {
    await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM checkout_artifacts WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_artifact_secrets WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM browser_runs WHERE id = ?', [runId]);
    await pool.query('DELETE FROM card_consumption_ledger WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [attemptId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
    await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
    await pool.query('DELETE FROM executor_profiles WHERE id = ?', [profileId]);
    await pool.query(
      `UPDATE app_settings SET setting_value = 'false'
       WHERE setting_key = 'browser_payment_writes_enabled'`
    );
    await pool.end();
  }
});
