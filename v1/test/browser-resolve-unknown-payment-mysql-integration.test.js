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

// seedCase=false 时不手写 case/告警，留给「真实产生路径」用例让系统自己造
// （手写 fixture 的 dedupe_key 是推出来的，推错了会和收口代码一起错、测试照绿，
//  所以必须另有一个用例用产生方写 key、收口方删 key 来交叉验证）。
async function createFixture(pool, label, { seedCase = true } = {}) {
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
  await pool.query(
    `INSERT INTO browser_dispatch_jobs
     (job_key, recharge_attempt_id, order_id, executor_profile_id, status,
      lease_owner, lease_token_hash, lease_until, attempt_count, claimed_at)
     VALUES (?, ?, ?, ?, 'CLAIMED', ?, ?, ?, 1, CURRENT_TIMESTAMP(3))`,
    [`browser-attempt:${ids.attemptId}`, ids.attemptId, ids.orderId, ids.profileId,
      workerId, 'a'.repeat(64), new Date(Date.now() + 10 * 60_000)]
  );
  const repository = createBrowserExecutionRepository(pool);
  await repository.beginRun({
    attemptId: ids.attemptId, executorProfileId: ids.profileId,
    accountKeyHmac: crypto.createHash('sha256').update(`account:${ids.orderId}`).digest('hex'),
    workerId, startOperationKey: `resolve-unknown-start:${ids.attemptId}`,
    runId: ids.runId, leaseSeconds: 600
  });
  // 付款不明进入待办时会同时产生一条对账 case（按 attempt 去重）和一条告警（按 order 去重）。
  // B1 之前 Browser 收口不关它们，工作台队列/告警栏会残留；这里造成 OPEN 好在收口后断言被关。
  // ⚠️ 这里的 dedupe_key 是照产生方代码推出来的，只能证明「收口能删掉同样拼法的行」；
  //    key 本身拼得对不对，由下方「真实产生路径」那个用例（seedCase:false）负责交叉验证。
  if (seedCase) {
    await pool.query(
      `INSERT INTO reconciliation_cases
       (id, case_type, status, severity, dedupe_key, order_id, recharge_attempt_id,
        evidence_json, detected_at, last_seen_at, updated_at)
       VALUES (?, 'BROWSER_PAYMENT_UNKNOWN', 'OPEN', 'critical', ?, ?, ?,
         JSON_OBJECT('seed', TRUE), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [crypto.randomUUID(), `browser-payment-unknown:${ids.attemptId}`, ids.orderId, ids.attemptId]
    );
    await pool.query(
      `INSERT INTO operator_alerts
       (id, alert_type, dedupe_key, order_id, severity, title, message, status)
       VALUES (UUID(), 'BROWSER_PAYMENT_UNKNOWN', ?, ?, 'critical', '付款点了但没拿到结果，等你核实', 'seed', 'OPEN')`,
      [`browser-browser_payment_unknown:${ids.orderId}`, ids.orderId]
    );
  }
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
            o.plan_type, o.subscription_cancelled, o.cancellation_checked_at,
            rat.status AS attempt_status, rat.funds_risk_state,
            br.status AS run_status, br.payment_state, br.verification_state, br.control_state,
            br.post_payment_state, br.cancellation_confirmed_at,
            ccl.status AS ledger_status,
            c.inventory_status, c.current_balance,
            (SELECT status FROM card_assignment_history WHERE id = ?) AS assignment_status,
            (SELECT status FROM cdks WHERE id = ?) AS cdk_status,
            (SELECT order_id FROM cdks WHERE id = ?) AS cdk_order_id,
            (SELECT COUNT(*) FROM order_events WHERE order_id = o.id) AS event_count,
            (SELECT status FROM browser_dispatch_jobs WHERE recharge_attempt_id = rat.id LIMIT 1) AS dispatch_status,
            (SELECT status FROM browser_interventions WHERE browser_run_id = br.id ORDER BY requested_at DESC LIMIT 1) AS intervention_status,
            (SELECT alert_type FROM operator_alerts WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) AS alert_type,
            (SELECT status FROM reconciliation_cases WHERE dedupe_key = CONCAT('browser-payment-unknown:', rat.id)) AS recon_case_status,
            (SELECT status FROM operator_alerts WHERE dedupe_key = CONCAT('browser-browser_payment_unknown:', o.id)) AS payment_unknown_alert_status
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
  await pool.query('DELETE FROM alert_notifications WHERE alert_id IN (SELECT id FROM operator_alerts WHERE order_id = ?)', [ids.orderId]);
  await pool.query('DELETE FROM operator_alerts WHERE order_id = ?', [ids.orderId]);
  await pool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM checkout_artifacts WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [ids.orderId]);
  await pool.query('DELETE FROM browser_interventions WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_post_payment_observations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_runs WHERE id = ?', [ids.runId]);
  await pool.query('DELETE FROM card_consumption_ledger WHERE recharge_attempt_id = ?', [ids.attemptId]);
  // 必须在删 recharge_attempts 之前：reconciliation_cases 有外键指向它。
  // 按 order 和 attempt 双条件删——系统在真实路径上产生的 case 未必带 order_id。
  await pool.query('DELETE FROM reconciliation_cases WHERE order_id = ? OR recharge_attempt_id = ?',
    [ids.orderId, ids.attemptId]);
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
    // F-46: the renewal fact the operator confirmed is written where the drawer and
    // manual-cancellation-service read it, on both the order and the run.
    assert.equal(Number(after.subscription_cancelled), 1);
    assert.ok(after.cancellation_checked_at, 'cancellation_checked_at must be set');
    assert.equal(after.post_payment_state, 'CANCELLATION_CONFIRMED');
    assert.ok(after.cancellation_confirmed_at, 'run.cancellation_confirmed_at must be set');
    assert.equal(after.dispatch_status, 'COMPLETED', 'a closed run must not leave a CLAIMED dispatch job');
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

test('CHARGED without a renewal check delivers as RECHARGE_SUCCESS with the review flag (D-248: cancellation unconfirmed never blocks delivery)', { skip }, async () => {
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
    assert.equal(after.order_status, 'RECHARGE_SUCCESS');
    assert.equal(after.cancellation_review_required, 1);
    const [[reminder]] = await pool.query(
      `SELECT COUNT(*) AS n FROM operator_alerts WHERE dedupe_key = ? AND alert_type = 'ORDER_CANCELLATION_UNCONFIRMED' AND status = 'OPEN'`,
      [`order-cancellation-unconfirmed:${fixture.ids.orderId}`]);
    assert.equal(Number(reminder.n), 1, 'the card is queued for retirement and the operator is reminded');
    assert.equal(after.subscription_cancelled, null, 'no renewal fact was confirmed, none may be written');
    assert.equal(after.post_payment_state, 'PLUS_CONFIRMED');
    assert.equal(after.cancellation_confirmed_at, null);
    assert.equal(after.dispatch_status, 'COMPLETED');
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
    assert.equal(after.dispatch_status, 'COMPLETED', 'a closed run must not leave a CLAIMED dispatch job');
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

// F-45: a Pro order is two stages (D-133). "Charged" can only mean the Plus stage; the run must
// land in the same hand-off shape recordManual20xHandoff produces, the order must stay
// RECHARGE_PROCESSING, and the existing COMPLETE_20X action must be able to finish it.
test('CHARGED on a Pro order records the Plus stage and hands off for 20X instead of closing the order', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'pro-charged');
    await pool.query("UPDATE orders SET plan_type = 'pro_20x' WHERE id = ?", [fixture.ids.orderId]);
    await moveToStuck(pool, fixture.ids, { runStatus: 'HUMAN_REQUIRED', verificationState: 'HUMAN_REQUIRED' });
    const result = await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'card shows the Plus charge; account is Plus, not yet Pro',
      renewalCancelled: true // meaningless for a Pro order and must be ignored, never close the order
    });
    assert.equal(result.runStatus, 'HUMAN_REQUIRED');
    assert.equal(result.controlState, 'TRANSFERRED');
    assert.equal(result.paymentState, 'PAYMENT_CONFIRMED');
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'RECHARGE_PROCESSING', 'a Pro order is not delivered after the Plus stage');
    assert.equal(after.cancellation_review_required, 0);
    assert.equal(after.subscription_cancelled, null);
    assert.equal(after.post_payment_state, 'PLUS_CONFIRMED');
    assert.equal(after.cancellation_confirmed_at, null);
    assert.equal(after.attempt_status, 'SUCCESS');
    assert.equal(after.funds_risk_state, 'SETTLED');
    assert.equal(after.ledger_status, 'CONSUMED');
    assert.equal(after.assignment_status, 'RELEASED');
    assert.equal(after.inventory_status, 'DEPLETED');
    assert.equal(after.intervention_status, 'TRANSFERRED', 'COMPLETE_20X needs a TRANSFERRED intervention');
    assert.equal(after.alert_type, 'BROWSER_UPGRADE_HANDOFF');
    assert.equal(after.dispatch_status, 'COMPLETED');
    // The hand-off must be finishable by the existing COMPLETE_20X action.
    const completed = await createBrowserAdminService({ pool }).controlRun(fixture.ids.runId, {
      action: 'COMPLETE_20X', operationId: `complete20x:${fixture.ids.runId}`,
      confirmation: `确认20X升级完成 ${fixture.ids.runId}`, actorId: 'admin'
    });
    assert.equal(completed.runStatus, 'COMPLETED');
    const done = await snapshot(pool, fixture.ids);
    assert.equal(done.order_status, 'RECHARGE_SUCCESS');
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('CHARGED on a Pro order stuck as SUBMIT_UNKNOWN moves the order back to RECHARGE_PROCESSING', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'pro-unknown');
    await pool.query("UPDATE orders SET plan_type = 'pro_5x' WHERE id = ?", [fixture.ids.orderId]);
    await moveToStuck(pool, fixture.ids, { runStatus: 'RECONCILE_ONLY', verificationState: 'NOT_REQUIRED', orderStatus: 'SUBMIT_UNKNOWN' });
    await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'Plus stage charged'
    });
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'RECHARGE_PROCESSING');
    assert.equal(after.run_status, 'HUMAN_REQUIRED');
    assert.equal(after.control_state, 'TRANSFERRED');
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

// F-44 against the real database: the string "false" is refused before any write.
test('a string renewalCancelled is refused and leaves every row untouched', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'string-bool');
    await moveToStuck(pool, fixture.ids, { runStatus: 'RECONCILE_ONLY', verificationState: 'NOT_REQUIRED' });
    const before = await snapshot(pool, fixture.ids);
    await assert.rejects(() => resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'CHARGED', evidenceNote: 'Plus active', renewalCancelled: 'false'
    }), { code: 'INVALID_RENEWAL_CANCELLED' });
    const after = await snapshot(pool, fixture.ids);
    assert.deepEqual(after, before);
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('F-48: the real shape — a submit click happened — still hands the CDK back on NOT_CHARGED', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'submitted-not-charged');
    await moveToStuck(pool, fixture.ids, { runStatus: 'HUMAN_REQUIRED', verificationState: 'HUMAN_REQUIRED', orderStatus: 'SUBMIT_UNKNOWN' });
    // This is what 2026-09-11's order looked like: one payment submit click, no charge.
    await pool.query(
      `INSERT INTO browser_operations (browser_run_id, operation_id, operation_type, status, result_code, prepared_at, completed_at)
       VALUES (?, ?, 'PAYMENT_SUBMIT', 'COMMITTED', 'EXTERNAL_ACTION_AUTHORIZED', NOW(3), NOW(3))`,
      [fixture.ids.runId, `submit:${fixture.ids.runId}`]
    );
    const result = await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'NOT_CHARGED', evidenceNote: 'hCaptcha blocked the checkout; account still free and card balance unchanged'
    });
    assert.equal(result.runStatus, 'FAILED_SAFE');
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'CLOSED');
    assert.equal(after.cdk_status, 'AVAILABLE', 'the customer must not be left holding a spent CDK');
    assert.equal(after.cdk_order_id, null);
    assert.equal(after.assignment_status, 'RELEASED');
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});

test('F-48: the not-charged close-out clears the funds fence before handing the CDK back', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'fence-order');
    await moveToStuck(pool, fixture.ids, { runStatus: 'HUMAN_REQUIRED', verificationState: 'HUMAN_REQUIRED', orderStatus: 'SUBMIT_UNKNOWN' });
    await pool.query(
      `INSERT INTO browser_operations (browser_run_id, operation_id, operation_type, status, result_code, prepared_at, completed_at)
       VALUES (?, ?, 'PAYMENT_SUBMIT', 'COMMITTED', 'EXTERNAL_ACTION_AUTHORIZED', NOW(3), NOW(3))`,
      [fixture.ids.runId, `submit-fence:${fixture.ids.runId}`]
    );
    await resolve(pool, fixture.ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${fixture.ids.runId}`,
      verifiedOutcome: 'NOT_CHARGED', evidenceNote: 'verified free account and unchanged card balance'
    });
    const after = await snapshot(pool, fixture.ids);
    // Order matters: the attempt fence and the ledger are cleared first, so the CDK
    // return sees no funds evidence and only the adjudicated submit click remains.
    assert.equal(after.funds_risk_state, 'CLEARED');
    assert.equal(after.ledger_status, 'RELEASED');
    assert.equal(after.cdk_status, 'AVAILABLE');
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});


test('delivered Plus cleanup can be resolved internally without revoking delivery or recharging', { skip }, async()=>{
 let fixture;
 try {
  fixture=await createFixture(pool,'delivered-cleanup'); const {ids}=fixture;
  await pool.query("UPDATE orders SET status='RECHARGE_SUCCESS',finished_at='2026-09-16 00:00:00' WHERE id=?",[ids.orderId]);
  await pool.query("UPDATE browser_runs SET status='HUMAN_REQUIRED',payment_state='PAYMENT_CONFIRMED',post_payment_state='CANCELLATION_PENDING',verification_state='HUMAN_REQUIRED' WHERE id=?",[ids.runId]);
  await pool.query("UPDATE recharge_attempts SET status='SUBMITTING',funds_risk_state='ACTIVE' WHERE id=?",[ids.attemptId]);
  await pool.query("UPDATE card_consumption_ledger SET status='CONSUMED' WHERE recharge_attempt_id=?",[ids.attemptId]);
  const input={action:'RESOLVE_UNKNOWN_PAYMENT',operationId:`cleanup:${ids.runId}`,verifiedOutcome:'CHARGED',evidenceNote:'Plus and card charge verified, renewal is now disabled'};
  await assert.rejects(()=>resolve(pool,ids,{...input,renewalCancelled:false}),e=>e.code==='CLEANUP_CONFIRMATION_REQUIRED');
  await resolve(pool,ids,{...input,renewalCancelled:true});
  const [[row]]=await pool.query('SELECT status,subscription_cancelled,finished_at FROM orders WHERE id=?',[ids.orderId]);
  assert.equal(row.status,'RECHARGE_SUCCESS');assert.equal(row.subscription_cancelled,1);
  assert.equal(row.finished_at.toISOString(),'2026-09-16T00:00:00.000Z');
  const [[run]]=await pool.query('SELECT status FROM browser_runs WHERE id=?',[ids.runId]);assert.equal(run.status,'COMPLETED');
 } finally {if(fixture)await cleanup(pool,fixture.ids)}
});

// ——— B1 的真正证明：case/告警的 dedupe_key 由「产生方」写、由「收口方」删 ———
// 上面各例的 case 是 fixture 手写 INSERT 的，key 是照产生方代码推出来的：万一推错，
// fixture 与收口代码会一起错、测试照样绿，而生产里真实的 case 永远关不掉
// （CLAUDE.md 惯犯第 3 条：曾把 cardNo 同时写进代码和夹具，真实字段是 lastFour）。
// 这个用例全程走真实路径：REQUEST → FREEZE → MARK_PAYMENT_UNKNOWN 让系统自己产生 case，
// 告警用真实的 upsertBrowserAlertInTransaction 产生，再 RESOLVE_UNKNOWN_PAYMENT 收口。
// 两边 key 对不上就会红——这才证明 B1 在生产上真能关掉那条待办。
test('B1 真实产生路径：系统自己产生的 case 与告警，收口后都被关掉（交叉验证 dedupe_key）', { skip }, async () => {
  let fixture;
  try {
    fixture = await createFixture(pool, 'real-path', { seedCase: false });
    const { ids } = fixture;

    // 1) 真实动作链把 run 交到人工手上，再由人工标「付款结果不明」——系统在这一步产生 case。
    await resolve(pool, ids, { action: 'REQUEST', operationId: `req:${ids.runId}`,
      confirmation: `请求人工接管 ${ids.runId}`, reasonCode: 'OPERATOR_REVIEW' });
    await resolve(pool, ids, { action: 'FREEZE', operationId: `frz:${ids.runId}`,
      confirmation: `冻结自动化 ${ids.runId}` });
    await resolve(pool, ids, { action: 'MARK_PAYMENT_UNKNOWN', operationId: `mark:${ids.runId}`,
      confirmation: `确认付款结果未知 ${ids.runId}` });

    // 2) 告警走真实产生器（不是手写 INSERT），key 由 browser-alert-repository 自己拼。
    const { upsertBrowserAlertInTransaction } = await import('../src/db/repositories/browser-alert-repository.js');
    await upsertBrowserAlertInTransaction(pool, {
      type: 'BROWSER_PAYMENT_UNKNOWN', orderId: ids.orderId,
      title: '付款点了但没拿到结果，等你核实', message: '真实产生路径用例',
    });

    // 3) 确认这两条确实是系统造出来的、且处于 OPEN——否则后面的断言没有意义。
    const [[caseBefore]] = await pool.query(
      'SELECT status, dedupe_key FROM reconciliation_cases WHERE recharge_attempt_id = ?', [ids.attemptId]);
    const [[alertBefore]] = await pool.query(
      "SELECT status, dedupe_key FROM operator_alerts WHERE order_id = ? AND alert_type = 'BROWSER_PAYMENT_UNKNOWN'",
      [ids.orderId]);
    assert.ok(caseBefore, '真实路径应产生一条对账 case');
    assert.equal(caseBefore.status, 'OPEN');
    assert.ok(alertBefore, '真实产生器应产生一条告警');
    assert.equal(alertBefore.status, 'OPEN');

    // 4) 正式收口。
    const result = await resolve(pool, ids, {
      action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: `resolve:${ids.runId}`,
      verifiedOutcome: 'CHARGED', renewalCancelled: true,
      evidenceNote: 'real-path: account shows Plus, renewal off',
    });
    assert.equal(result.runStatus, 'COMPLETED');

    // 5) 收口必须把「系统自己产生的」那两条关掉——B1 的 key 拼错这里就红。
    const [[caseAfter]] = await pool.query(
      'SELECT status FROM reconciliation_cases WHERE dedupe_key = ?', [caseBefore.dedupe_key]);
    const [[alertAfter]] = await pool.query(
      'SELECT status FROM operator_alerts WHERE dedupe_key = ?', [alertBefore.dedupe_key]);
    assert.equal(caseAfter.status, 'RESOLVED',
      `收口必须关掉系统产生的 case（其真实 key = ${caseBefore.dedupe_key}）`);
    assert.equal(alertAfter.status, 'RESOLVED',
      `收口必须关掉系统产生的告警（其真实 key = ${alertBefore.dedupe_key}）`);

    // 6) 顺带确认订单侧确实收口了，不是只动了 case。
    const after = await snapshot(pool, ids);
    assert.equal(after.order_status, 'RECHARGE_SUCCESS');
    assert.equal(after.attempt_status, 'SUCCESS');
    assert.equal(after.ledger_status, 'CONSUMED');
    assert.equal(after.assignment_status, 'RELEASED');
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
  }
});
