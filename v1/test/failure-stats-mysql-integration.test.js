import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createFailureStatsService } from '../src/services/failure-stats-service.js';
import { PRE_PAYMENT_STUCK_SQL } from '../src/db/repositories/stalled-order-queries.js';

// D-393 / D-390：在真实 MySQL（已跑完全部迁移的隔离库）上验证两份只读 SQL 的判断。
// 单元测试里的 pool 是假的，SQL 从没被执行过（D-184 教训），所以这里造真行、跑真查询。
// 用法：FAILSTATS_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:PORT/<隔离库> node --test test/failure-stats-mysql-integration.test.js
const url = process.env.FAILSTATS_TEST_DATABASE_URL;
const skip = !url && 'FAILSTATS_TEST_DATABASE_URL 未配置；在隔离库上运行（RUNBOOK §2.8 的做法）';

const hex = (n) => randomUUID().replace(/-/g, '').repeat(2).slice(0, n);
const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
// 每次运行一个独有编号：隔离库可以反复跑这份测试，上一轮留下的行不会混进这一轮的断言。
const RUN = hex(6);

async function seed(db) {
  const profileId = randomUUID();
  await db.query(`INSERT INTO executor_profiles (id, profile_code, profile_version, adapter_version, executor_kind, runtime_id)
    VALUES (?, ?, 1, 'test', 'BROWSER', 'test')`, [profileId, `fs-${hex(8)}`]);
  let runNo = 0;
  let sequence = 0;
  async function order({ tag, status, failureCode = null, failureReason = null, createdAt = ago(60), updatedAt = createdAt }) {
    const id = randomUUID();
    const cdkId = randomUUID();
    await db.query('INSERT INTO cdks (id, code_hash) VALUES (?, ?)', [cdkId, hex(64)]);
    await db.query(`INSERT INTO orders (id, public_no, cdk_id, card_purchase_idempotency_key, session_ciphertext, status,
        failure_code, failure_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `PJV1-${tag}-${RUN}${hex(4)}`, cdkId, `idem-${hex(20)}`, Buffer.from('x'), status, failureCode, failureReason, createdAt, updatedAt]);
    const attemptId = randomUUID();
    await db.query("INSERT INTO recharge_attempts (id, order_id, executor_kind) VALUES (?, ?, 'BROWSER')", [attemptId, id]);
    return { id, attemptId, tag };
  }
  async function run(o, { worker, status = 'FAILED_SAFE', paymentState = 'NOT_STARTED', lastError = null, leaseUntil = null }) {
    runNo += 1;
    await db.query(`INSERT INTO browser_runs (id, recharge_attempt_id, executor_profile_id, account_key_hmac, run_no,
        start_operation_key, status, payment_state, worker_id, last_error_code, worker_lease_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), o.attemptId, profileId, hex(64), runNo, `op-${hex(24)}`, status, paymentState, worker, lastError, leaseUntil]);
  }
  async function event(o, action, summary, createdAt = ago(55)) {
    sequence += 1;
    await db.query(`INSERT INTO browser_run_events (job_id, order_id, sequence_no, event_type, action, summary_json, payload_digest, created_at)
      VALUES (?, ?, ?, 'freeze', ?, ?, ?, ?)`, [`brjob:${o.id}:x`, o.id, sequence, action, JSON.stringify({ action, ...summary }), hex(64), createdAt]);
  }
  async function orderEvent(o, toStatus, createdAt) {
    await db.query("INSERT INTO order_events (order_id, actor_type, reason, to_status, created_at) VALUES (?, 'SYSTEM', 'test', ?, ?)", [o.id, toStatus, createdAt]);
  }
  async function job(o, { status, leaseUntil = null }) {
    await db.query('INSERT INTO browser_dispatch_jobs (job_key, order_id, recharge_attempt_id, status, lease_until) VALUES (?, ?, ?, ?, ?)',
      [`brjob:${o.id}:${hex(6)}`, o.id, o.attemptId, status, leaseUntil]);
  }
  return { order, run, event, orderEvent, job };
}

test('failure stats: outcomes, rehearsal exclusion and where each reason\'s own words come from', { skip }, async () => {
  const db = await mysql.createPool({ uri: url, connectionLimit: 2, timezone: 'Z' });
  try {
    const s = await seed(db);
    // 统计按时间窗口数，所以这一轮的单放在一个独有的过去时间窗口里（与其它轮、其它测试都不重叠）。
    const base = new Date(Date.UTC(2000, 0, 1) + Math.floor(Math.random() * 9000) * 86_400_000);
    const at = (minutes) => new Date(base.getTime() - minutes * 60_000);
    const from = at(12 * 60);
    const to = at(-12 * 60);

    const success = await s.order({ tag: 'S1', status: 'RECHARGE_SUCCESS', createdAt: at(60) });
    await s.run(success, { worker: 'pool:lane-1', status: 'COMPLETED', paymentState: 'PAYMENT_CONFIRMED' });
    const closedAfterSuccess = await s.order({ tag: 'C1', status: 'CLOSED', createdAt: at(60) });
    await s.run(closedAfterSuccess, { worker: 'pool:lane-1', status: 'COMPLETED', paymentState: 'PAYMENT_CONFIRMED' });
    await s.orderEvent(closedAfterSuccess, 'RECHARGE_SUCCESS', at(50));
    await s.orderEvent(closedAfterSuccess, 'CLOSED', at(40));

    const nav = await s.order({ tag: 'F1', status: 'RECHARGE_FAILED', failureCode: 'CHECKOUT_NAVIGATION_FAILED', failureReason: 'Browser could not access or verify the ChatGPT checkout before payment', createdAt: at(60) });
    await s.run(nav, { worker: 'pool:lane-1', lastError: 'CHECKOUT_NAVIGATION_FAILED' });
    await s.event(nav, 'fail-closed', { reason: 'CHECKOUT_NAVIGATION_FAILED', navigationError: 'plus upgrade control must resolve to one visible button (找到 0 个)', evidenceRef: '20260926T010000Z-abc' });
    const drift = await s.order({ tag: 'F2', status: 'RECHARGE_FAILED', failureCode: 'CHECKOUT_DRIFT', failureReason: 'Browser execution stopped safely before payment', createdAt: at(30) });
    await s.run(drift, { worker: 'pool:lane-1', lastError: 'CHECKOUT_DRIFT' });
    await s.event(drift, 'payment-outcome-diagnostic', { paymentStatus: 'PRE_SUBMIT_FAILED', diagnostic: 'fill-billing-address timed out; card 4111 1111 1111 1111 field' });
    const blocked = await s.order({ tag: 'F3', status: 'RECHARGE_FAILED', failureCode: 'CHATGPT_ACCESS_BLOCKED', failureReason: 'Browser could not access or verify the ChatGPT checkout before payment', createdAt: at(60) });
    await s.run(blocked, { worker: 'pool:lane-1', lastError: 'CHATGPT_ACCESS_BLOCKED' });
    const humanVerified = await s.order({ tag: 'H1', status: 'CLOSED', failureCode: 'HUMAN_VERIFIED_NOT_CHARGED', failureReason: 'issuer declined the card at Checkout', createdAt: at(60) });
    await s.run(humanVerified, { worker: null, status: 'HUMAN_REQUIRED', paymentState: 'PAYMENT_DECLINED' });
    const customerStallClosed = await s.order({ tag: 'X1', status: 'CLOSED', failureCode: 'CANCELLED_PRE_SUBMISSION', failureReason: 'pre-payment stall: pool down', createdAt: at(60) });
    await s.run(customerStallClosed, { worker: 'pool:lane-1', lastError: 'REHEARSAL_CLOSED' });
    await s.order({ tag: 'P1', status: 'RECHARGE_PROCESSING', createdAt: at(60) });
    // 三条「正式运行」各有一张单只靠它一条成立，任何一条被删都会被抓到：
    const oneShotBeforeClick = await s.order({ tag: 'G1', status: 'RECHARGE_FAILED', failureCode: 'PAGE_DRIFT', createdAt: at(60) });
    await s.run(oneShotBeforeClick, { worker: null, lastError: 'PAGE_DRIFT' }); // 退役一次性脚本，未点付款
    const renamedButPaid = await s.order({ tag: 'S2', status: 'RECHARGE_SUCCESS', createdAt: at(60) });
    await s.run(renamedButPaid, { worker: 'some-renamed-worker', status: 'COMPLETED', paymentState: 'PAYMENT_CONFIRMED' }); // 点过付款

    const rehearsalPassed = await s.order({ tag: 'R1', status: 'CLOSED', failureCode: 'CANCELLED_PRE_SUBMISSION', createdAt: at(60) });
    await s.run(rehearsalPassed, { worker: 'production-readonly-1', lastError: 'BROWSER_REHEARSAL_STOPPED' });
    const rehearsalFailed = await s.order({ tag: 'R2', status: 'CLOSED', failureCode: 'CANCELLED_PRE_SUBMISSION', createdAt: at(60) });
    await s.run(rehearsalFailed, { worker: 'production-readonly-1', lastError: 'REHEARSAL_CLOSED' });
    const poolRehearsalMode = await s.order({ tag: 'R3', status: 'CLOSED', failureCode: 'CANCELLED_PRE_SUBMISSION', createdAt: at(60) });
    await s.run(poolRehearsalMode, { worker: 'pool:lane-1', lastError: 'BROWSER_REHEARSAL_STOPPED' });

    const outside = await s.order({ tag: 'O1', status: 'RECHARGE_FAILED', failureCode: 'CARD_DECLINED', createdAt: at(3 * 24 * 60) });
    await s.run(outside, { worker: 'pool:lane-1', lastError: 'CARD_DECLINED' });

    const stats = await createFailureStatsService({ pool: db })({ from: from.toISOString(), to: to.toISOString() });
    assert.deepEqual(stats.totals, { orders: 10, succeeded: 3, failed: 6, other: 1, rehearsalExcluded: 3 });
    const byCode = Object.fromEntries(stats.reasons.map((r) => [r.code, r]));
    assert.deepEqual(Object.keys(byCode).sort(), ['CANCELLED_PRE_SUBMISSION', 'CHATGPT_ACCESS_BLOCKED', 'CHECKOUT_DRIFT', 'CHECKOUT_NAVIGATION_FAILED', 'HUMAN_VERIFIED_NOT_CHARGED', 'PAGE_DRIFT']);
    assert.equal(byCode.CANCELLED_PRE_SUBMISSION.count, 1, 'a real customer stall closed with the runbook script still counts; rehearsals do not');
    assert.match(byCode.CANCELLED_PRE_SUBMISSION.orders[0].publicNo, /^PJV1-X1-/);
    assert.equal(byCode.CHECKOUT_NAVIGATION_FAILED.lastDetail, 'plus upgrade control must resolve to one visible button (找到 0 个)');
    assert.equal(byCode.CHECKOUT_NAVIGATION_FAILED.lastDetailSource, 'EXECUTION');
    assert.equal(byCode.CHECKOUT_NAVIGATION_FAILED.orders[0].evidenceRef, '20260926T010000Z-abc');
    assert.equal(byCode.CHECKOUT_DRIFT.lastDetail, 'fill-billing-address timed out; card [数字已隐藏] field');
    assert.equal(byCode.CHATGPT_ACCESS_BLOCKED.lastDetailSource, 'ORDER', 'no execution words recorded: fall back to what the order says');
    assert.equal(byCode.HUMAN_VERIFIED_NOT_CHARGED.lastDetail, 'issuer declined the card at Checkout');
    assert.equal(byCode.CHECKOUT_DRIFT.share, 16.7);
  } finally {
    await db.end();
  }
});

test('pre-payment stall alert: flags only orders nobody is working on (D-390)', { skip }, async () => {
  const db = await mysql.createPool({ uri: url, connectionLimit: 2, timezone: 'Z' });
  try {
    const s = await seed(db);
    const mk = (tag) => s.order({ tag, status: 'RECHARGE_PROCESSING', createdAt: ago(20), updatedAt: ago(10) });
    const stuck = await mk('K1');
    await s.job(stuck, { status: 'CLAIMED', leaseUntil: ago(10) });
    await s.run(stuck, { worker: 'pool:lane-1', status: 'RUNNING', leaseUntil: ago(10) });
    const orphaned = await mk('K2');
    await s.job(orphaned, { status: 'COMPLETED' });
    await s.run(orphaned, { worker: 'pool:lane-1', status: 'FAILED_SAFE' });
    const healthy = await mk('N1');
    await s.job(healthy, { status: 'CLAIMED', leaseUntil: new Date(Date.now() + 10 * 60_000) });
    await s.run(healthy, { worker: 'pool:lane-1', status: 'RUNNING', leaseUntil: new Date(Date.now() + 10 * 60_000) });
    const queued = await mk('N2');
    await s.job(queued, { status: 'QUEUED' });
    const justExpired = await mk('N3');
    await s.job(justExpired, { status: 'CLAIMED', leaseUntil: ago(1) });
    await s.run(justExpired, { worker: 'pool:lane-1', status: 'RUNNING', leaseUntil: ago(1) });
    const paidUnknown = await mk('N4');
    await s.job(paidUnknown, { status: 'CLAIMED', leaseUntil: ago(10) });
    await s.run(paidUnknown, { worker: 'pool:lane-1', status: 'RUNNING', paymentState: 'PAYMENT_UNKNOWN', leaseUntil: ago(10) });
    const human = await mk('N5');
    await s.job(human, { status: 'COMPLETED' });
    await s.run(human, { worker: 'pool:lane-1', status: 'HUMAN_REQUIRED' });
    const fresh = await s.order({ tag: 'N6', status: 'RECHARGE_PROCESSING', createdAt: ago(1), updatedAt: ago(1) });
    await s.job(fresh, { status: 'COMPLETED' });

    const [rows] = await db.query(PRE_PAYMENT_STUCK_SQL, [3, 3, 3]);
    const tags = rows.filter((r) => r.public_no.includes(`-${RUN}`)).map((r) => r.public_no.split('-')[1]).sort();
    assert.deepEqual(tags, ['K1', 'K2']);
  } finally {
    await db.end();
  }
});
