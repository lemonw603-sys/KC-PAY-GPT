import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import {
  closePrePaymentOrderInTransaction, createPrePaymentAbandonService, readPrePaymentCloseoutState,
} from '../src/services/pre-payment-closeout-service.js';

// D-394：后台「放弃并放卡」与 close-rehearsal-order 共用的收口，在真实 MySQL（跑完全部迁移的隔离库）上验。
// 用法：CLOSEOUT_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:PORT/<隔离库> node --test test/pre-payment-closeout-mysql-integration.test.js
const url = process.env.CLOSEOUT_TEST_DATABASE_URL;
const skip = !url && 'CLOSEOUT_TEST_DATABASE_URL 未配置；在隔离库上运行（RUNBOOK §2.8 的做法）';

const hex = (n) => randomUUID().replace(/-/g, '').repeat(2).slice(0, n);
const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
const later = (minutes) => new Date(Date.now() + minutes * 60_000);

async function fixture(db) {
  const profileId = randomUUID();
  await db.query(`INSERT INTO executor_profiles (id, profile_code, profile_version, adapter_version, executor_kind, runtime_id)
    VALUES (?, ?, 1, 'test', 'BROWSER', 'test')`, [profileId, `ab-${hex(8)}`]);
  const batchNo = `AB-${hex(10)}`;
  await db.query('INSERT INTO cdk_batches (batch_no, request_key, requested_count) VALUES (?, ?, 1)', [batchNo, `req-${hex(20)}`]);
  let runNo = 0;
  // 一张「付款前停下」的处理中单：绑着卡（分卡 ACTIVE + 账本 RESERVED）、卡密已兑换、有派单与 run。
  return async function stalledOrder({ status = 'RECHARGE_PROCESSING', lease = ago(10), paymentState = 'NOT_STARTED', submitClicked = false } = {}) {
    const orderId = randomUUID(); const cdkId = randomUUID(); const cardId = randomUUID(); const attemptId = randomUUID(); const runId = randomUUID();
    const publicNo = `PJV1-${hex(20)}`;
    await db.query('INSERT INTO cdks (id, code_hash, batch_no, status) VALUES (?, ?, ?, ?)', [cdkId, hex(64), batchNo, 'REDEEMED']);
    await db.query(`INSERT INTO orders (id, public_no, cdk_id, card_purchase_idempotency_key, session_ciphertext, status, minimum_required_card_balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 16, ?, ?)`, [orderId, publicNo, cdkId, `idem-${hex(20)}`, Buffer.from('x'), status, ago(20), ago(10)]);
    await db.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    await db.query(`INSERT INTO cards (id, card_type_id, provider_card_id, status, last4, inventory_status, current_balance, order_id, assigned_at)
      VALUES (?, 'test', ?, 'active', '4242', 'ASSIGNED', 30, ?, ?)`, [cardId, `c-${hex(12)}`, orderId, ago(20)]);
    await db.query('UPDATE orders SET assigned_card_id = ? WHERE id = ?', [cardId, orderId]);
    await db.query("INSERT INTO card_assignment_history (id, card_id, order_id, assigned_by, status) VALUES (?, ?, ?, 'test', 'ACTIVE')", [randomUUID(), cardId, orderId]);
    await db.query("INSERT INTO recharge_attempts (id, order_id, executor_kind, status, funds_risk_state) VALUES (?, ?, 'BROWSER', 'PREPARED', 'ACTIVE')", [attemptId, orderId]);
    await db.query("INSERT INTO card_consumption_ledger (id, card_id, order_id, recharge_attempt_id, status) VALUES (?, ?, ?, ?, 'RESERVED')", [randomUUID(), cardId, orderId, attemptId]);
    runNo += 1;
    await db.query(`INSERT INTO browser_runs (id, recharge_attempt_id, executor_profile_id, account_key_hmac, run_no, start_operation_key,
        status, payment_state, worker_id, worker_lease_until) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, 'pool:lane-1', ?)`,
    [runId, attemptId, profileId, hex(64), runNo, `op-${hex(24)}`, paymentState, lease]);
    await db.query("INSERT INTO browser_dispatch_jobs (job_key, order_id, recharge_attempt_id, status, lease_until) VALUES (?, ?, ?, 'CLAIMED', ?)",
      [`brjob:${orderId}:${attemptId}`, orderId, attemptId, lease]);
    if (submitClicked) {
      await db.query("INSERT INTO browser_operations (browser_run_id, operation_id, operation_type, status) VALUES (?, ?, 'PAYMENT_SUBMIT', 'COMMITTED')", [runId, `pay-${hex(12)}`]);
    }
    return { orderId, publicNo, cdkId, cardId, attemptId, runId };
  };
}

async function snapshot(db, o) {
  const one = async (sql, params) => (await db.query(sql, params))[0][0];
  return {
    order: await one('SELECT status, failure_code, assigned_card_id FROM orders WHERE id = ?', [o.orderId]),
    run: await one('SELECT status, last_error_code, worker_lease_until FROM browser_runs WHERE id = ?', [o.runId]),
    attempt: await one('SELECT status, funds_risk_state FROM recharge_attempts WHERE id = ?', [o.attemptId]),
    dispatch: await one('SELECT status FROM browser_dispatch_jobs WHERE order_id = ?', [o.orderId]),
    cdk: await one('SELECT status, order_id FROM cdks WHERE id = ?', [o.cdkId]),
    card: await one('SELECT inventory_status, order_id FROM cards WHERE id = ?', [o.cardId]),
    assignment: await one('SELECT status FROM card_assignment_history WHERE order_id = ?', [o.orderId]),
    ledger: await one('SELECT status FROM card_consumption_ledger WHERE order_id = ?', [o.orderId]),
    closedEvent: await one("SELECT actor_type, metadata_json FROM order_events WHERE order_id = ? AND to_status = 'CLOSED'", [o.orderId]),
  };
}

test('a stalled pre-payment order: dry run changes nothing, then the admin button closes it and returns the code', { skip }, async () => {
  const db = await mysql.createPool({ uri: url, connectionLimit: 3, timezone: 'Z' });
  try {
    const stalled = await (await fixture(db))();
    const state = await readPrePaymentCloseoutState(db, { id: stalled.orderId, status: 'RECHARGE_PROCESSING' });
    assert.equal(state.eligible, true, 'the drawer shows the button');

    const abandon = createPrePaymentAbandonService({ pool: db });
    const before = await snapshot(db, stalled);
    const preview = await abandon(stalled.publicNo, { dryRun: true });
    assert.equal(preview.dryRun, true);
    assert.deepEqual(await snapshot(db, stalled), before, 'a dry run is rolled back in full');

    const result = await abandon(stalled.publicNo, { actorId: 'admin-test' });
    assert.equal(result.cdkReturned, true);
    const after = await snapshot(db, stalled);
    assert.deepEqual(after.order, { status: 'CLOSED', failure_code: 'ABANDONED_PRE_PAYMENT', assigned_card_id: null });
    assert.equal(after.run.status, 'FAILED_SAFE');
    assert.equal(after.run.last_error_code, 'ADMIN_ABANDONED');
    assert.equal(after.run.worker_lease_until, null);
    assert.deepEqual(after.attempt, { status: 'CLEARED', funds_risk_state: 'CLEARED' });
    assert.equal(after.dispatch.status, 'CANCELLED');
    assert.deepEqual(after.cdk, { status: 'AVAILABLE', order_id: null }, 'the customer can redeem again');
    assert.deepEqual(after.card, { inventory_status: 'AVAILABLE', order_id: null });
    assert.equal(after.assignment.status, 'RELEASED');
    assert.equal(after.ledger.status, 'RELEASED');
    const meta = typeof after.closedEvent.metadata_json === 'string' ? JSON.parse(after.closedEvent.metadata_json) : after.closedEvent.metadata_json;
    assert.equal(meta.source, 'admin_abandon_pre_payment');
    assert.equal('closeRehearsalOrder' in meta, false, 'a real customer order must not be counted as a rehearsal (D-339)');
  } finally {
    await db.end();
  }
});

test('refusals: pool still holds it, a payment click, a run past arming, or not a pre-payment status — nothing changes', { skip }, async () => {
  const db = await mysql.createPool({ uri: url, connectionLimit: 3, timezone: 'Z' });
  try {
    const make = await fixture(db);
    const abandon = createPrePaymentAbandonService({ pool: db });
    const cases = [
      ['pre_payment lease active', await make({ lease: later(10) }), 'RUN_LEASE_ACTIVE'],
      ['clicked pay', await make({ submitClicked: true }), 'PAYMENT_EVIDENCE'],
      ['past arming', await make({ paymentState: 'PAYMENT_UNKNOWN' }), 'NOT_PRE_PAYMENT_SHAPE'],
      ['wrong status', await make({ status: 'SUBMIT_UNKNOWN' }), 'NOT_PRE_PAYMENT_STATUS'],
    ];
    for (const [name, order, code] of cases) {
      const before = await snapshot(db, order);
      await assert.rejects(abandon(order.publicNo), (e) => e.name === 'PrePaymentCloseoutRefused' && e.code === code, name);
      assert.deepEqual(await snapshot(db, order), before, `${name}: refused means untouched`);
    }
    const leased = cases[0][1];
    const state = await readPrePaymentCloseoutState(db, { id: leased.orderId, status: 'RECHARGE_PROCESSING' });
    assert.equal(state.reasonCode, 'RUN_LEASE_ACTIVE');
    assert.ok(state.shape.leaseUntil, 'the drawer can say until when');
  } finally {
    await db.end();
  }
});

test('the rehearsal script path still marks the close as a rehearsal for the success rate (D-339)', { skip }, async () => {
  const db = await mysql.createPool({ uri: url, connectionLimit: 3, timezone: 'Z' });
  const connection = await db.getConnection();
  try {
    const rehearsal = await (await fixture(db))();
    await connection.beginTransaction();
    await closePrePaymentOrderInTransaction(connection, {
      publicNo: rehearsal.publicNo, reason: 'rehearsal finished', runErrorCode: 'REHEARSAL_CLOSED',
      failureCode: 'CANCELLED_PRE_SUBMISSION', source: 'close_rehearsal_order', eventMetadata: { closeRehearsalOrder: true },
    });
    await connection.commit();
    const after = await snapshot(db, rehearsal);
    assert.equal(after.order.failure_code, 'CANCELLED_PRE_SUBMISSION');
    assert.equal(after.run.last_error_code, 'REHEARSAL_CLOSED');
    const meta = typeof after.closedEvent.metadata_json === 'string' ? JSON.parse(after.closedEvent.metadata_json) : after.closedEvent.metadata_json;
    assert.equal(meta.closeRehearsalOrder, true);
  } finally {
    connection.release();
    await db.end();
  }
});
