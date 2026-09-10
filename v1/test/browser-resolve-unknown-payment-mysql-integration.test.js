import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import mysql from 'mysql2/promise';
import { createBrowserExecutionRepository } from '../src/db/repositories/browser-execution-repository.js';
import { createBrowserAdminService } from '../src/services/browser-admin-service.js';

// F-16/F-3: a run whose payment result is unknown, or was escalated to human, had no formal
// closeout — only a hand-run SQL statement could move it. This proves the new
// RESOLVE_UNKNOWN_PAYMENT control action against a real database: both directions (the
// platform confirms it charged / confirms it did not), from both real ways a run actually
// reaches this state (MARK_PAYMENT_UNKNOWN, which never touches verification_state; and the
// automated verification lane's escalatePaymentVerification, which sets HUMAN_REQUIRED).

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；人工核实收口集成测试只在隔离数据库运行';
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';
const hnskjAccountId = '00000000-0000-4000-8000-000000000101';

// One pool for the whole file, not one per test: repeated createPool()/end() cycles in one
// process were observed to make connections flaky in the local dev container.
let pool;
before(() => { if (databaseUrl) pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' }); });
after(async () => { if (pool) await pool.end(); });

async function createFixture(pool, label) {
  const ids = {
    cdkId: crypto.randomUUID(), orderId: crypto.randomUUID(), cardId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(), profileId: crypto.randomUUID(), runId: crypto.randomUUID(),
    assignmentId: crypto.randomUUID()
  };
  const workerId = `resolve-unknown-worker-${label}`;
  await pool.query(
    `INSERT INTO executor_profiles
     (id, profile_code, profile_version, executor_kind, runtime_id, adapter_version, status, config_public_json)
     VALUES (?, ?, 1, 'BROWSER', 'RESOLVE_UNKNOWN_TEST', 'RESOLVE_UNKNOWN_TEST', 'ACTIVE',
       JSON_OBJECT('isolatedTest', TRUE, 'productionWritesEnabled', FALSE))`,
    [ids.profileId, `RESOLVE_UNKNOWN_${label}_${ids.profileId}`]
  );
  await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')', [
    ids.cdkId, crypto.createHash('sha256').update(ids.cdkId).digest('hex')
  ]);
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, version, card_type_id, open_card_amount,
      minimum_required_card_balance, session_ciphertext, chatgpt_account_id,
      card_purchase_idempotency_key, product_id, fulfillment_route_id,
      frozen_card_provider_account_id, route_resolution_status)
     VALUES (?, ?, ?, 'RECHARGE_PROCESSING', 3, '7', 16, 16, ?, ?, ?, ?, ?, ?, 'RESOLVED')`,
    [ids.orderId, `UNKPAY-${label.slice(0, 8)}-${ids.orderId}`, ids.cdkId, Buffer.from('isolated-session'),
      `isolated-account-${ids.orderId}`, `resolve-unknown-purchase-${ids.orderId}`, productId, routeId, hnskjAccountId]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [ids.orderId, ids.cdkId]);
  await pool.query(
    `INSERT INTO cards
     (id, order_id, inventory_status, provider_card_id, card_type_id, status,
      funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
      provider_account_id, external_card_id, intake_status, sync_tier, last_synced_at,
      last_transaction_synced_at)
     VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 16, 152, 'USD', 'MONITORING', ?,
       ?, ?, 'ACCEPTED', 'ASSIGNED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [ids.cardId, ids.orderId, `resolve-unknown-card-${ids.cardId}`, Buffer.from('isolated-card'),
      hnskjAccountId, `resolve-unknown-card-${ids.cardId}`]
  );
  await pool.query('UPDATE orders SET assigned_card_id = ? WHERE id = ?', [ids.cardId, ids.orderId]);
  await pool.query(
    `INSERT INTO card_assignment_history
     (id, card_id, order_id, assignment_kind, status, assigned_by, assignment_reason)
     VALUES (?, ?, ?, 'NORMAL', 'ACTIVE', 'test:fixture', 'payment result unknown')`,
    [ids.assignmentId, ids.cardId, ids.orderId]
  );
  await pool.query(
    `INSERT INTO recharge_attempts
     (id, order_id, fulfillment_route_id, executor_kind, executor_profile_id,
      status, funds_risk_state, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'BROWSER', ?, 'PREPARED', 'ACTIVE', ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [ids.attemptId, ids.orderId, routeId, ids.profileId, `resolve-unknown:${ids.attemptId}`]
  );
  await pool.query(
    `INSERT INTO card_consumption_ledger
     (id, card_id, order_id, recharge_attempt_id, product_id, status, amount, currency)
     VALUES (?, ?, ?, ?, ?, 'RESERVED', 16, 'USD')`,
    [crypto.randomUUID(), ids.cardId, ids.orderId, ids.attemptId, productId]
  );
  const repository = createBrowserExecutionRepository(pool);
  await repository.beginRun({
    attemptId: ids.attemptId, executorProfileId: ids.profileId,
    accountKeyHmac: crypto.createHash('sha256').update(`account:${ids.orderId}`).digest('hex'),
    workerId, startOperationKey: `resolve-unknown-start:${ids.attemptId}`,
    runId: ids.runId, leaseSeconds: 600
  });
  return { ids, workerId };
}

// Puts the fixture (freshly begun: RUNNING/NOT_STARTED/RECHARGE_PROCESSING) into one of the
// two real shapes a stuck run is found in — direct field writes here stand in for what
// MARK_PAYMENT_UNKNOWN / escalatePaymentVerification actually do in production (both already
// covered by their own tests elsewhere); this only sets up the *starting point*.
async function moveToStuck(pool, ids, { runStatus, verificationState, paymentState = 'PAYMENT_UNKNOWN',
  attemptStatus = 'SUBMIT_UNKNOWN', orderStatus = 'RECHARGE_PROCESSING' } = {}) {
  await pool.query(
    `UPDATE browser_runs SET status = ?, verification_state = ?, payment_state = ?,
       worker_id = NULL, worker_lease_until = NULL WHERE id = ?`,
    [runStatus, verificationState, paymentState, ids.runId]
  );
  await pool.query(`UPDATE recharge_attempts SET status = ?, funds_risk_state = 'UNKNOWN' WHERE id = ?`,
    [attemptStatus, ids.attemptId]);
  await pool.query(`UPDATE orders SET status = ? WHERE id = ?`, [orderStatus, ids.orderId]);
}

async function snapshot(pool, ids) {
  const [[row]] = await pool.query(
    `SELECT o.status AS order_status, o.version AS order_version, o.cancellation_review_required,
            rat.status AS attempt_status, rat.funds_risk_state,
            br.status AS run_status, br.payment_state, br.verification_state, br.control_state,
            ccl.status AS ledger_status,
            c.inventory_status, c.current_balance,
            (SELECT status FROM card_assignment_history WHERE id = ?) AS assignment_status,
            (SELECT status FROM cdks WHERE id = ?) AS cdk_status,
            (SELECT order_id FROM cdks WHERE id = ?) AS cdk_order_id,
            (SELECT COUNT(*) FROM order_events WHERE order_id = o.id) AS event_count
     FROM orders o
     JOIN recharge_attempts rat ON rat.order_id = o.id
     JOIN browser_runs br ON br.recharge_attempt_id = rat.id
     JOIN card_consumption_ledger ccl ON ccl.recharge_attempt_id = rat.id
     LEFT JOIN cards c ON c.id = ?
     WHERE o.id = ?`,
    [ids.assignmentId, ids.cdkId, ids.cdkId, ids.cardId, ids.orderId]
  );
  return row;
}

async function cleanup(pool, ids) {
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [ids.orderId]);
  await pool.query('DELETE FROM browser_interventions WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_post_payment_observations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_runs WHERE id = ?', [ids.runId]);
  await pool.query('DELETE FROM card_consumption_ledger WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM card_assignment_history WHERE order_id = ?', [ids.orderId]);
  await pool.query('UPDATE orders SET assigned_card_id = NULL WHERE id = ?', [ids.orderId]);
  await pool.query('DELETE FROM cards WHERE id = ?', [ids.cardId]);
  await pool.query('DELETE FROM orders WHERE id = ?', [ids.orderId]);
  await pool.query('DELETE FROM cdk_delivery_events WHERE cdk_id = ?', [ids.cdkId]);
  await pool.query('DELETE FROM cdks WHERE id = ?', [ids.cdkId]);
  await pool.query('DELETE FROM executor_profiles WHERE id = ?', [ids.profileId]);
}

function resolve(pool, ids, input) {
  return createBrowserAdminService({ pool }).controlRun(ids.runId, {
    confirmation: `确认核实结果 ${ids.runId}`, actorId: 'admin', ...input
  });
}

test('CHARGED + renewal already cancelled closes straight to RECHARGE_SUCCESS', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'charged-done');
    // MARK_PAYMENT_UNKNOWN shape: RECONCILE_ONLY, verification_state never touched (NOT_REQUIRED).
    await moveToStuck(pool, fixture.ids, { runStatus: 'RECONCILE_ONLY', verificationState: 'NOT_REQUIRED' });
    const result = await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'ChatGPT account shows Plus active, renewal already off',
      renewalCancelled: true
    });
    assert.equal(result.runStatus, 'COMPLETED');
    assert.equal(result.paymentState, 'PAYMENT_CONFIRMED');
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'RECHARGE_SUCCESS');
    assert.equal(after.cancellation_review_required, 0);
    assert.equal(after.attempt_status, 'SUCCESS');
    assert.equal(after.funds_risk_state, 'SETTLED');
    assert.equal(after.ledger_status, 'CONSUMED');
    assert.equal(after.assignment_status, 'RELEASED');
    assert.equal(after.inventory_status, 'DEPLETED');
    // replay with the same operationId must not double-write
    const replay = await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'ignored on replay', renewalCancelled: true
    });
    assert.equal(replay.idempotentReplay, true);
    const afterReplay = await snapshot(pool, fixture.ids);
    assert.equal(Number(afterReplay.event_count), Number(after.event_count));
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('CHARGED without a renewal check goes to CANCELLATION_REVIEW_REQUIRED, not straight to success', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'charged-review');
    // escalatePaymentVerification shape: HUMAN_REQUIRED both on status and verification_state.
    await moveToStuck(pool, fixture.ids, { runStatus: 'HUMAN_REQUIRED', verificationState: 'HUMAN_REQUIRED' });
    const result = await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'Plus active on the account; did not check renewal setting'
    });
    assert.equal(result.runStatus, 'COMPLETED');
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'CANCELLATION_REVIEW_REQUIRED');
    assert.equal(after.cancellation_review_required, 1);
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('NOT_CHARGED closes the order, releases the card, and returns the CDK when no payment evidence exists', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'not-charged');
    await moveToStuck(pool, fixture.ids, { runStatus: 'RECONCILE_ONLY', verificationState: 'NOT_REQUIRED' });
    const result = await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'NOT_CHARGED', evidenceNote: 'ChatGPT account still free; no charge on the card either'
    });
    assert.equal(result.runStatus, 'FAILED_SAFE');
    assert.equal(result.paymentState, 'PAYMENT_DECLINED');
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'CLOSED');
    assert.equal(after.attempt_status, 'FAILED');
    assert.equal(after.funds_risk_state, 'CLEARED');
    assert.equal(after.ledger_status, 'RELEASED');
    assert.equal(after.assignment_status, 'RELEASED');
    assert.equal(after.inventory_status, 'AVAILABLE'); // current_balance 152 >= minimum 16
    assert.equal(after.cdk_status, 'AVAILABLE');
    assert.equal(after.cdk_order_id, null);
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('NOT_CHARGED is refused once the payment is already confirmed — cannot contradict a settled charge', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'contradiction');
    await moveToStuck(pool, fixture.ids, {
      runStatus: 'HUMAN_REQUIRED', verificationState: 'HUMAN_REQUIRED', paymentState: 'PAYMENT_CONFIRMED'
    });
    const before = await snapshot(pool, fixture.ids);
    await assert.rejects(() => resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'NOT_CHARGED', evidenceNote: 'trying to contradict a confirmed charge'
    }), { code: 'PAYMENT_STATE_CONFLICT' });
    const after = await snapshot(pool, fixture.ids);
    assert.deepEqual(after, before);
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('refuses a run that is not actually stuck awaiting verification', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'not-stuck');
    // Left at its just-begun state: RUNNING/NOT_STARTED — nothing to verify yet.
    await assert.rejects(() => resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'premature'
    }), { code: 'CONTROL_STATE_CONFLICT' });
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});
