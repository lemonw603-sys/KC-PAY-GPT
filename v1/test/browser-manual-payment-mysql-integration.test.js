import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createBrowserExecutionRepository } from '../src/db/repositories/browser-execution-repository.js';
import { createBrowserRecoveryRepository } from '../src/db/repositories/browser-recovery-repository.js';
import { createBrowserAdminService } from '../src/services/browser-admin-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；人工付款收口集成测试只在隔离数据库运行';
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';
const hnskjAccountId = '00000000-0000-4000-8000-000000000101';

// A Browser order that reached the exact pre-payment boundary and then stalled:
// attempt PREPARED/ACTIVE, ledger RESERVED, assignment ACTIVE, dispatch CLAIMED,
// run RUNNING with a worker lease, resource leases held. This mirrors the
// production row left behind when the operator paid by hand.
async function createStalledFixture(pool, label) {
  const ids = {
    cdkId: crypto.randomUUID(), orderId: crypto.randomUUID(), cardId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(), profileId: crypto.randomUUID(), runId: crypto.randomUUID(),
    assignmentId: crypto.randomUUID()
  };
  const workerId = `manual-pay-worker-${label}`;
  await pool.query(
    `INSERT INTO executor_profiles
     (id, profile_code, profile_version, executor_kind, runtime_id, adapter_version, status, config_public_json)
     VALUES (?, ?, 1, 'BROWSER', 'MANUAL_PAY_TEST', 'MANUAL_PAY_TEST', 'ACTIVE',
       JSON_OBJECT('isolatedTest', TRUE, 'productionWritesEnabled', FALSE))`,
    [ids.profileId, `MANUAL_PAY_${label}_${ids.profileId}`]
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
    [ids.orderId, `MANUAL-${label.slice(0, 8)}-${ids.orderId}`, ids.cdkId, Buffer.from('isolated-session'),
      `isolated-account-${ids.orderId}`, `manual-pay-purchase-${ids.orderId}`, productId, routeId, hnskjAccountId]
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
    [ids.cardId, ids.orderId, `manual-pay-card-${ids.cardId}`, Buffer.from('isolated-card'),
      hnskjAccountId, `manual-pay-card-${ids.cardId}`]
  );
  await pool.query('UPDATE orders SET assigned_card_id = ? WHERE id = ?', [ids.cardId, ids.orderId]);
  await pool.query(
    `INSERT INTO card_assignment_history
     (id, card_id, order_id, assignment_kind, status, assigned_by, assignment_reason)
     VALUES (?, ?, ?, 'NORMAL', 'ACTIVE', 'test:fixture', 'stalled browser order')`,
    [ids.assignmentId, ids.cardId, ids.orderId]
  );
  await pool.query(
    `INSERT INTO recharge_attempts
     (id, order_id, fulfillment_route_id, executor_kind, executor_profile_id,
      status, funds_risk_state, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'BROWSER', ?, 'PREPARED', 'ACTIVE', ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [ids.attemptId, ids.orderId, routeId, ids.profileId, `manual-pay:${ids.attemptId}`]
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
  const run = await repository.beginRun({
    attemptId: ids.attemptId, executorProfileId: ids.profileId,
    accountKeyHmac: crypto.createHash('sha256').update(`account:${ids.orderId}`).digest('hex'),
    workerId, startOperationKey: `manual-pay-start:${ids.attemptId}`,
    runId: ids.runId, leaseSeconds: 600
  });
  await createBrowserRecoveryRepository(pool, {
    artifactKeys: new Map([[1, Buffer.alloc(32, 7)]]),
    currentArtifactKeyVersion: 1,
    resourceHmacKey: Buffer.alloc(32, 9)
  }).acquireRunResources({
    runId: ids.runId, ownerId: workerId, leaseToken: run.leaseToken, ttlSeconds: 600
  });
  return { ids, workerId };
}

async function expireAutomationLeases(pool, ids) {
  const past = new Date(Date.now() - 60_000);
  await pool.query('UPDATE browser_runs SET worker_lease_until = ? WHERE id = ?', [past, ids.runId]);
  await pool.query('UPDATE browser_dispatch_jobs SET lease_until = ? WHERE recharge_attempt_id = ?', [past, ids.attemptId]);
}

async function snapshot(pool, ids) {
  const [[row]] = await pool.query(
    `SELECT o.status AS order_status, o.version AS order_version, o.finished_at AS order_finished_at,
            rat.status AS attempt_status, rat.funds_risk_state, rat.submitted_at, rat.finished_at AS attempt_finished_at,
            br.status AS run_status, br.payment_state, br.post_payment_state, br.verification_state,
            br.control_state, br.worker_id, br.worker_lease_until, br.human_owner_id, br.last_checkpoint_kind,
            ccl.status AS ledger_status, ccl.consumed_at,
            c.inventory_status, c.current_balance,
            (SELECT status FROM card_assignment_history WHERE id = ?) AS assignment_status,
            (SELECT status FROM browser_dispatch_jobs WHERE recharge_attempt_id = rat.id) AS dispatch_status,
            (SELECT COUNT(*) FROM execution_resource_leases WHERE browser_run_id = br.id AND released_at IS NULL) AS open_leases,
            (SELECT COUNT(*) FROM browser_operations WHERE browser_run_id = br.id AND operation_type = 'PAYMENT_SUBMIT') AS submit_count,
            (SELECT COUNT(*) FROM browser_operations WHERE browser_run_id = br.id AND operation_type = 'MANUAL_PAYMENT_CONFIRMED') AS manual_evidence_count,
            (SELECT COUNT(*) FROM browser_post_payment_observations WHERE browser_run_id = br.id AND observation_kind = 'MANUAL_PAYMENT_CONFIRMED') AS observation_count,
            (SELECT COUNT(*) FROM browser_interventions WHERE browser_run_id = br.id) AS intervention_count,
            (SELECT status FROM browser_interventions WHERE browser_run_id = br.id ORDER BY requested_at DESC LIMIT 1) AS intervention_status,
            (SELECT public_note FROM browser_interventions WHERE browser_run_id = br.id ORDER BY requested_at DESC LIMIT 1) AS intervention_note,
            (SELECT COUNT(*) FROM order_events WHERE order_id = o.id AND to_status = 'RECHARGE_SUCCESS') AS success_events,
            (SELECT COUNT(*) FROM browser_checkpoints WHERE browser_run_id = br.id) AS checkpoint_count
     FROM orders o
     JOIN recharge_attempts rat ON rat.order_id = o.id
     JOIN browser_runs br ON br.recharge_attempt_id = rat.id
     JOIN card_consumption_ledger ccl ON ccl.recharge_attempt_id = rat.id
     JOIN cards c ON c.id = o.assigned_card_id
     WHERE o.id = ?`,
    [ids.assignmentId, ids.orderId]
  );
  return row;
}

async function cleanup(pool, ids) {
  await pool.query('DELETE FROM reconciliation_cases WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [ids.orderId]);
  await pool.query('DELETE FROM browser_interventions WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_post_payment_observations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM checkout_artifacts WHERE browser_run_id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_runs WHERE id = ?', [ids.runId]);
  await pool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM card_consumption_ledger WHERE recharge_attempt_id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [ids.attemptId]);
  await pool.query('DELETE FROM card_assignment_history WHERE order_id = ?', [ids.orderId]);
  await pool.query('UPDATE orders SET assigned_card_id = NULL WHERE id = ?', [ids.orderId]);
  await pool.query('DELETE FROM cards WHERE id = ?', [ids.cardId]);
  await pool.query('DELETE FROM orders WHERE id = ?', [ids.orderId]);
  await pool.query('DELETE FROM cdks WHERE id = ?', [ids.cdkId]);
  await pool.query('DELETE FROM executor_profiles WHERE id = ?', [ids.profileId]);
}

function control(pool, ids, input) {
  return createBrowserAdminService({ pool }).controlRun(ids.runId, {
    confirmation: `确认人工付款已完成 ${ids.runId}`, actorId: 'admin', ...input
  });
}

test('manual payment confirmation refuses while automation still holds live leases', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  let fixture;
  try {
    fixture = await createStalledFixture(pool, 'live-lease');
    const before = await snapshot(pool, fixture.ids);
    await assert.rejects(() => control(pool, fixture.ids, {
      action: 'CONFIRM_MANUAL_PAYMENT', operationId: `manual-pay-live:${fixture.ids.runId}`,
      manualOutcome: 'UPGRADED_20X', evidenceNote: 'operator paid 982.14 PHP with card ending 5501'
    }), { code: 'AUTOMATION_STILL_ACTIVE' });
    const after = await snapshot(pool, fixture.ids);
    assert.deepEqual(after, before);
    assert.equal(after.order_status, 'RECHARGE_PROCESSING');
    assert.equal(after.attempt_status, 'PREPARED');
    assert.equal(after.ledger_status, 'RESERVED');
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
    await pool.end();
  }
});

test('manual payment confirmation refuses when automation already submitted', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  let fixture;
  try {
    fixture = await createStalledFixture(pool, 'submitted');
    await expireAutomationLeases(pool, fixture.ids);
    await pool.query(
      `INSERT INTO browser_operations
       (browser_run_id, operation_id, operation_type, status, result_code, public_result_json, prepared_at)
       VALUES (?, ?, 'PAYMENT_SUBMIT', 'OUTCOME_UNKNOWN', NULL, JSON_OBJECT(), CURRENT_TIMESTAMP(3))`,
      [fixture.ids.runId, `submit:${fixture.ids.runId}`]
    );
    await assert.rejects(() => control(pool, fixture.ids, {
      action: 'CONFIRM_MANUAL_PAYMENT', operationId: `manual-pay-submitted:${fixture.ids.runId}`,
      manualOutcome: 'UPGRADED_20X', evidenceNote: 'operator paid by hand'
    }), { code: 'RECONCILE_ONLY' });
    const after = await snapshot(pool, fixture.ids);
    assert.equal(after.order_status, 'RECHARGE_PROCESSING');
    assert.equal(after.attempt_status, 'PREPARED');
    assert.equal(after.ledger_status, 'RESERVED');
    assert.equal(Number(after.manual_evidence_count), 0);
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
    await pool.end();
  }
});

test('UPGRADED_20X closes order, attempt, ledger, card, leases and dispatch in one transaction and replays idempotently', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  let fixture;
  try {
    fixture = await createStalledFixture(pool, 'upgraded');
    await expireAutomationLeases(pool, fixture.ids);
    const operationId = `manual-pay-upgraded:${fixture.ids.runId}`;
    const result = await control(pool, fixture.ids, {
      action: 'CONFIRM_MANUAL_PAYMENT', operationId,
      manualOutcome: 'UPGRADED_20X', evidenceNote: 'operator paid 982.14 PHP with card ending 5501; 20X active'
    });
    assert.equal(result.idempotentReplay, false);
    assert.equal(result.runStatus, 'COMPLETED');
    assert.equal(result.controlState, 'RELEASED');
    assert.equal(result.paymentState, 'PAYMENT_CONFIRMED');

    const closed = await snapshot(pool, fixture.ids);
    assert.deepEqual({
      order: closed.order_status, orderVersion: Number(closed.order_version),
      attempt: closed.attempt_status, funds: closed.funds_risk_state,
      run: closed.run_status, payment: closed.payment_state, post: closed.post_payment_state,
      verification: closed.verification_state, control: closed.control_state,
      worker: closed.worker_id, humanOwner: closed.human_owner_id,
      ledger: closed.ledger_status, inventory: closed.inventory_status, balance: closed.current_balance,
      assignment: closed.assignment_status, dispatch: closed.dispatch_status,
      openLeases: Number(closed.open_leases), submits: Number(closed.submit_count),
      manualEvidence: Number(closed.manual_evidence_count), observations: Number(closed.observation_count),
      interventions: Number(closed.intervention_count), interventionStatus: closed.intervention_status,
      successEvents: Number(closed.success_events), lastCheckpoint: closed.last_checkpoint_kind
    }, {
      order: 'RECHARGE_SUCCESS', orderVersion: 4,
      attempt: 'SUCCESS', funds: 'SETTLED',
      run: 'COMPLETED', payment: 'PAYMENT_CONFIRMED', post: 'PLUS_CONFIRMED',
      verification: 'RESOLVED', control: 'RELEASED',
      worker: null, humanOwner: 'admin',
      ledger: 'CONSUMED', inventory: 'DEPLETED', balance: null,
      assignment: 'RELEASED', dispatch: 'COMPLETED',
      openLeases: 0, submits: 0,
      manualEvidence: 1, observations: 1,
      interventions: 1, interventionStatus: 'RELEASED',
      successEvents: 1, lastCheckpoint: 'CONTROL_CONFIRM_MANUAL_PAYMENT'
    });
    assert.ok(closed.order_finished_at);
    assert.ok(closed.submitted_at);
    assert.ok(closed.consumed_at);
    assert.match(closed.intervention_note, /5501/);
    const [[risk]] = await pool.query(
      `SELECT payment_risk FROM browser_checkpoints WHERE browser_run_id = ? ORDER BY sequence_no DESC LIMIT 1`,
      [fixture.ids.runId]
    );
    assert.equal(risk.payment_risk, 'SETTLED');

    const replay = await control(pool, fixture.ids, {
      action: 'CONFIRM_MANUAL_PAYMENT', operationId,
      manualOutcome: 'UPGRADED_20X', evidenceNote: 'replayed request'
    });
    assert.equal(replay.idempotentReplay, true);
    const replayed = await snapshot(pool, fixture.ids);
    assert.equal(Number(replayed.manual_evidence_count), 1);
    assert.equal(Number(replayed.checkpoint_count), Number(closed.checkpoint_count));
    assert.equal(Number(replayed.order_version), 4);

    // Automation must never treat the closed run as claimable again.
    await assert.rejects(() => control(pool, fixture.ids, {
      action: 'CONFIRM_MANUAL_PAYMENT', operationId: `manual-pay-second:${fixture.ids.runId}`,
      manualOutcome: 'UPGRADED_20X', evidenceNote: 'second attempt'
    }), { code: 'CONTROL_STATE_CONFLICT' });
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
    await pool.end();
  }
});

test('PLUS_ACTIVE keeps the order processing until COMPLETE_20X closes it without a synthetic submit', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  let fixture;
  try {
    fixture = await createStalledFixture(pool, 'plus-only');
    await expireAutomationLeases(pool, fixture.ids);
    const first = await control(pool, fixture.ids, {
      action: 'CONFIRM_MANUAL_PAYMENT', operationId: `manual-pay-plus:${fixture.ids.runId}`,
      manualOutcome: 'PLUS_ACTIVE', evidenceNote: 'operator paid Plus; upgrade pending'
    });
    assert.equal(first.runStatus, 'HUMAN_REQUIRED');
    assert.equal(first.controlState, 'TRANSFERRED');
    const handed = await snapshot(pool, fixture.ids);
    assert.deepEqual({
      order: handed.order_status, attempt: handed.attempt_status, funds: handed.funds_risk_state,
      run: handed.run_status, payment: handed.payment_state, post: handed.post_payment_state,
      control: handed.control_state, ledger: handed.ledger_status, inventory: handed.inventory_status,
      dispatch: handed.dispatch_status, openLeases: Number(handed.open_leases),
      interventionStatus: handed.intervention_status, successEvents: Number(handed.success_events)
    }, {
      order: 'RECHARGE_PROCESSING', attempt: 'SUCCESS', funds: 'SETTLED',
      run: 'HUMAN_REQUIRED', payment: 'PAYMENT_CONFIRMED', post: 'PLUS_CONFIRMED',
      control: 'TRANSFERRED', ledger: 'CONSUMED', inventory: 'DEPLETED',
      dispatch: 'COMPLETED', openLeases: 0,
      interventionStatus: 'TRANSFERRED', successEvents: 0
    });

    const completed = await createBrowserAdminService({ pool }).controlRun(fixture.ids.runId, {
      action: 'COMPLETE_20X', operationId: `manual-20x-complete:${fixture.ids.runId}`,
      confirmation: `确认20X升级完成 ${fixture.ids.runId}`, actorId: 'admin'
    });
    assert.equal(completed.runStatus, 'COMPLETED');
    const closed = await snapshot(pool, fixture.ids);
    assert.deepEqual({
      order: closed.order_status, run: closed.run_status, control: closed.control_state,
      submits: Number(closed.submit_count), manualEvidence: Number(closed.manual_evidence_count),
      interventionStatus: closed.intervention_status, successEvents: Number(closed.success_events)
    }, {
      order: 'RECHARGE_SUCCESS', run: 'COMPLETED', control: 'RELEASED',
      submits: 0, manualEvidence: 1, interventionStatus: 'RELEASED', successEvents: 1
    });
  } finally {
    if (fixture) await cleanup(pool, fixture.ids);
    await pool.end();
  }
});
