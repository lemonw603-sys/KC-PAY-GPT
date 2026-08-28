import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import {
  BrowserPaymentExecutor,
  MockCheckoutPaymentAdapter,
  MockPostPaymentVerifier,
} from '../src/payment-executor.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';

async function createFixture(pool, label) {
  const ids = {
    cdkId: crypto.randomUUID(), orderId: crypto.randomUUID(), cardId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(), profileId: crypto.randomUUID(), runId: crypto.randomUUID(),
  };
  await pool.query(
    `INSERT INTO executor_profiles
     (id, profile_code, profile_version, executor_kind, runtime_id, adapter_version, status, config_public_json)
     VALUES (?, ?, 1, 'BROWSER', 'MOCK_PAYMENT', 'MOCK_PAYMENT', 'ACTIVE',
       JSON_OBJECT('isolatedTest', TRUE, 'productionWritesEnabled', FALSE))`,
    [ids.profileId, `MOCK_PAYMENT_${label}_${ids.profileId}`],
  );
  await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')', [
    ids.cdkId, crypto.createHash('sha256').update(ids.cdkId).digest('hex'),
  ]);
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, card_type_id, open_card_amount,
      minimum_required_card_balance, session_ciphertext, chatgpt_account_id,
      card_purchase_idempotency_key, product_id, fulfillment_route_id, route_resolution_status)
     VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '7', 25, 16, ?, ?, ?, ?, ?, 'RESOLVED')`,
    [ids.orderId, `MOCK-PAY-${label}-${ids.orderId}`, ids.cdkId, Buffer.from('isolated-session'),
      `isolated-account-${ids.orderId}`, `mock-pay-purchase-${ids.orderId}`, productId, routeId],
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [ids.orderId, ids.cdkId]);
  await pool.query(
    `INSERT INTO cards
     (id, order_id, inventory_status, provider_card_id, card_type_id, status,
      funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
      provider_account_id, external_card_id, intake_status, sync_tier, last_synced_at)
     VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING', ?,
       '00000000-0000-4000-8000-000000000101', ?, 'ACCEPTED', 'ASSIGNED', CURRENT_TIMESTAMP(3))`,
    [ids.cardId, ids.orderId, `mock-pay-card-${ids.cardId}`, Buffer.from('isolated-card'), `mock-pay-card-${ids.cardId}`],
  );
  await pool.query(
    `INSERT INTO recharge_attempts
     (id, order_id, fulfillment_route_id, executor_kind, executor_profile_id,
      status, funds_risk_state, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'BROWSER', ?, 'PREPARED', 'ACTIVE', ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [ids.attemptId, ids.orderId, routeId, ids.profileId, `mock-payment:${ids.attemptId}`],
  );
  await pool.query(
    `INSERT INTO card_consumption_ledger
     (id, card_id, order_id, recharge_attempt_id, product_id, status, amount, currency)
     VALUES (?, ?, ?, ?, ?, 'RESERVED', 25, 'USD')`,
    [crypto.randomUUID(), ids.cardId, ids.orderId, ids.attemptId, productId],
  );
  const repository = createBrowserExecutionRepository(pool);
  const run = await repository.beginRun({
    attemptId: ids.attemptId, executorProfileId: ids.profileId,
    accountKeyHmac: crypto.createHash('sha256').update(`account:${ids.orderId}`).digest('hex'),
    workerId: `mock-payment-worker-${label}`, startOperationKey: `mock-payment-start:${ids.attemptId}`,
    runId: ids.runId, leaseSeconds: 60,
  });
  return { ids, repository, run, workerId: `mock-payment-worker-${label}` };
}

async function cleanup(pool, ids) {
  await pool.query('DELETE FROM reconciliation_cases WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [ids.orderId]);
  await pool.query('DELETE FROM browser_post_payment_observations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_runs WHERE id = ?', [ids.runId]);
  await pool.query('DELETE FROM card_consumption_ledger WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM cards WHERE id = ?', [ids.cardId]);
  await pool.query('DELETE FROM orders WHERE id = ?', [ids.orderId]);
  await pool.query('DELETE FROM cdks WHERE id = ?', [ids.cdkId]);
  await pool.query('DELETE FROM executor_profiles WHERE id = ?', [ids.profileId]);
}

function executorFor({ repository, run, workerId, outcome }) {
  const control = { async assertLeaseBeforeAction() {} };
  const integration = {
    workerId,
    async issueAuthoritativePaymentPermit() {
      return repository.issuePaymentPermit({
        runId: run.runId, workerId, leaseToken: run.leaseToken, ttlSeconds: 60,
      });
    },
  };
  const adapter = new MockCheckoutPaymentAdapter({ outcome });
  const executor = new BrowserPaymentExecutor({
    integration, executionRepository: repository, paymentAdapter: adapter,
    postPaymentVerifier: new MockPostPaymentVerifier(), enabled: true,
  });
  return { executor, control, adapter };
}

test('shared MySQL permit and post-payment state machine complete only through mock adapter', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for isolated mock payment integration',
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 6, timezone: 'Z' });
  let fixture;
  try {
    await pool.query("UPDATE app_settings SET setting_value = 'true' WHERE setting_key = 'browser_payment_writes_enabled'");
    fixture = await createFixture(pool, 'confirmed');
    const { executor, control, adapter } = executorFor({ ...fixture, outcome: 'CONFIRMED' });
    const result = await executor.execute({
      control, run: fixture.run, checkout: { kind: 'MOCK_CHECKOUT' },
      cardMaterial: { isolatedFixture: true }, operationId: `mock-submit:${fixture.ids.attemptId}`,
    });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(adapter.calls.length, 1);
    const [[stored]] = await pool.query(
      `SELECT o.status AS order_status, rat.status AS attempt_status, rat.funds_risk_state,
              br.status AS run_status, br.payment_state, br.post_payment_state,
              (SELECT COUNT(*) FROM browser_operations bo WHERE bo.browser_run_id = br.id
                AND bo.operation_type = 'PAYMENT_SUBMIT') AS submit_count
       FROM orders o JOIN recharge_attempts rat ON rat.order_id = o.id
       JOIN browser_runs br ON br.recharge_attempt_id = rat.id WHERE o.id = ?`,
      [fixture.ids.orderId],
    );
    assert.deepEqual({
      order: stored.order_status, attempt: stored.attempt_status, funds: stored.funds_risk_state,
      run: stored.run_status, payment: stored.payment_state, post: stored.post_payment_state,
      submits: Number(stored.submit_count),
    }, {
      order: 'RECHARGE_SUCCESS', attempt: 'SUCCESS', funds: 'SETTLED', run: 'COMPLETED',
      payment: 'PAYMENT_CONFIRMED', post: 'CANCELLATION_CONFIRMED', submits: 1,
    });
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
    await pool.query("UPDATE app_settings SET setting_value = 'false' WHERE setting_key = 'browser_payment_writes_enabled'");
    await pool.end();
  }
});

test('mock submission crash becomes authoritative UNKNOWN and a replay cannot submit again', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for isolated mock payment integration',
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 6, timezone: 'Z' });
  let fixture;
  try {
    await pool.query("UPDATE app_settings SET setting_value = 'true' WHERE setting_key = 'browser_payment_writes_enabled'");
    fixture = await createFixture(pool, 'unknown');
    const { executor, control, adapter } = executorFor({ ...fixture, outcome: 'UNKNOWN' });
    const input = {
      control, run: fixture.run, checkout: { kind: 'MOCK_CHECKOUT' },
      cardMaterial: { isolatedFixture: true }, operationId: `mock-submit:${fixture.ids.attemptId}`,
    };
    const first = await executor.execute(input);
    assert.equal(first.status, 'UNKNOWN');
    await assert.rejects(() => executor.execute(input));
    assert.equal(adapter.calls.length, 1);
    const [[stored]] = await pool.query(
      `SELECT o.status AS order_status, rat.status AS attempt_status, rat.funds_risk_state,
              br.status AS run_status, br.payment_state,
              (SELECT COUNT(*) FROM browser_operations bo WHERE bo.browser_run_id = br.id
                AND bo.operation_type = 'PAYMENT_SUBMIT') AS submit_count,
              (SELECT COUNT(*) FROM reconciliation_cases rc WHERE rc.recharge_attempt_id = rat.id
                AND rc.status = 'OPEN') AS open_cases
       FROM orders o JOIN recharge_attempts rat ON rat.order_id = o.id
       JOIN browser_runs br ON br.recharge_attempt_id = rat.id WHERE o.id = ?`,
      [fixture.ids.orderId],
    );
    assert.deepEqual({
      order: stored.order_status, attempt: stored.attempt_status, funds: stored.funds_risk_state,
      run: stored.run_status, payment: stored.payment_state,
      submits: Number(stored.submit_count), openCases: Number(stored.open_cases),
    }, {
      order: 'SUBMIT_UNKNOWN', attempt: 'SUBMIT_UNKNOWN', funds: 'UNKNOWN', run: 'RECONCILE_ONLY',
      payment: 'PAYMENT_UNKNOWN', submits: 1, openCases: 1,
    });
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
    await pool.query("UPDATE app_settings SET setting_value = 'false' WHERE setting_key = 'browser_payment_writes_enabled'");
    await pool.end();
  }
});
