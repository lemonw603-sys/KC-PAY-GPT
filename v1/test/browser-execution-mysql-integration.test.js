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
       VALUES (?, ?, ?, 'SUBMITTING', '7', 25, 16, ?, ?, ?, ?, 'RESOLVED')`,
      [orderId, `BROWSER-TEST-${orderId}`, cdkId, Buffer.from('isolated-test-session'),
        `browser-test-purchase-${orderId}`, productId, routeId]
    );
    await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, provider_account_id, external_card_id,
        intake_status, sync_tier)
       VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING',
         ?, '00000000-0000-4000-8000-000000000101', ?, 'ACCEPTED', 'ASSIGNED')`,
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
      snapshotHash: crypto.createHash('sha256').update(`snapshot:${attemptId}`).digest('hex'),
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
