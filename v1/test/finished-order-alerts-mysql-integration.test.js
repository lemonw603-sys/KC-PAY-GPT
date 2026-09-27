import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { resolveFinishedOrderAlertsSql } from '../src/db/repositories/stalled-order-queries.js';
import { MANUAL_USE_REASON_REGEXP } from '../src/services/daily-reconciliation-service.js';

// D-405（2026-09-27）：①订单结束且不再需要人、推送已发完的「浏览器单失败 / 要人工」提醒由巡检收掉；
// ②页面「停用 → 我拿它手动充值了」写的 MANUAL_USED 原因码，日对账要认成手动用卡（欠账 27）。
// 用法：v1/scripts/mysql-tests.sh test/finished-order-alerts-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';
const PLUS = '00000000-0000-4000-8000-000000000201';
const ROUTE_BROWSER = '00000000-0000-4000-8000-000000000302';
const BACKUP_A = '00000000-0000-4000-8000-000000000103';
const id = () => crypto.randomUUID();

test('欠账 27: the manual-use reason rule matches the page code MANUAL_USED and the old script text, not other stop causes (MySQL REGEXP)', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 1, timezone: 'Z' });
  try {
    const cases = [
      ['MANUAL_USED: 09-21 Lemon 手动补 Pro 差价', 1],
      ['retired confirmed (retire-legacy-cards:highvcc-manual-used): x', 1],
      ['manual used by operator', 1],
      ['card was manually used', 1],
      ['PROVIDER_VOIDED: 卡台作废', 0],
      ['CARD_FAULTY: 付款老失败', 0],
      ['OPERATOR_CANCELLED: 在卡台取消', 0],
      ['OTHER: 其他原因', 0]
    ];
    for (const [reason, expected] of cases) {
      const [[row]] = await pool.query('SELECT LOWER(?) REGEXP ? AS hit', [reason, MANUAL_USE_REASON_REGEXP]);
      assert.equal(Number(row.hit), expected, reason);
    }
  } finally { await pool.end(); }
});

async function order(pool, status) {
  const orderId = id(); const cdkId = id();
  await pool.query(`INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
    [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(
    `INSERT INTO orders (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance,
       session_ciphertext, card_purchase_idempotency_key, product_id, fulfillment_route_id, frozen_card_provider_account_id,
       route_resolution_status)
     VALUES (?, ?, ?, ?, '708', '16.000000', '16.000000', ?, ?, ?, ?, ?, 'RESOLVED')`,
    [orderId, `PJV1-fa-${orderId.slice(0, 8)}`, cdkId, status, Buffer.from('x'), `purchase-${orderId}`, PLUS, ROUTE_BROWSER, BACKUP_A]);
  return orderId;
}

async function alert(pool, orderId, { type = 'BROWSER_ORDER_FAILED', minutesAgo = 20, push = 'SENT' } = {}) {
  const alertId = id();
  await pool.query(
    `INSERT INTO operator_alerts (id, alert_type, dedupe_key, order_id, severity, title, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'warning', 't', 'm', 'OPEN', CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE, CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE)`,
    [alertId, type, `fa:${alertId}`, orderId, minutesAgo, minutesAgo]);
  if (push) {
    const [[a]] = await pool.query('SELECT incident_version FROM operator_alerts WHERE id = ?', [alertId]);
    await pool.query(
      `INSERT INTO alert_notifications (alert_id, channel, status, incident_version, attempt_count)
       VALUES (?, 'BARK', ?, ?, ?)`, [alertId, push, a.incident_version, push === 'SENT' ? 1 : 0]);
  }
  return alertId;
}

const statusOf = async (pool, alertId) => (await pool.query('SELECT status FROM operator_alerts WHERE id = ?', [alertId]))[0][0].status;

test('D-405: a finished order that no longer needs a person gets its failure / human-required reminder closed — only after the push went out and ten minutes passed', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
  try {
    const failed = await order(pool, 'RECHARGE_FAILED');
    const closes = await alert(pool, failed);
    const human = await alert(pool, await order(pool, 'CLOSED'), { type: 'BROWSER_HUMAN_REQUIRED' });
    const pushPending = await alert(pool, await order(pool, 'RECHARGE_FAILED'), { push: 'PENDING' });
    const pushRetry = await alert(pool, await order(pool, 'RECHARGE_FAILED'), { push: 'RETRY' });
    const tooFresh = await alert(pool, await order(pool, 'RECHARGE_FAILED'), { minutesAgo: 5 });
    const stillRunning = await alert(pool, await order(pool, 'RECHARGE_PROCESSING'));
    const stalledType = await alert(pool, await order(pool, 'RECHARGE_FAILED'), { type: 'BROWSER_ORDER_STALLED' });
    // 付款后失败（资金 SETTLED）＝仍要人看，不能收
    const paidFailed = await order(pool, 'RECHARGE_FAILED');
    await pool.query(
      `INSERT INTO recharge_attempts (id, order_id, executor_kind, status, funds_risk_state) VALUES (?, ?, 'BROWSER', 'FAILED', 'SETTLED')`,
      [id(), paidFailed]);
    const needsPerson = await alert(pool, paidFailed);

    await pool.query(resolveFinishedOrderAlertsSql());

    assert.equal(await statusOf(pool, closes), 'RESOLVED', 'finished, no person needed, push SENT, 20 minutes old');
    assert.equal(await statusOf(pool, human), 'RESOLVED', 'human-required on a CLOSED order');
    assert.equal(await statusOf(pool, pushPending), 'OPEN', 'closing now would cancel the undelivered push');
    assert.equal(await statusOf(pool, pushRetry), 'OPEN');
    assert.equal(await statusOf(pool, tooFresh), 'OPEN', 'give it ten minutes');
    assert.equal(await statusOf(pool, stillRunning), 'OPEN', 'order not finished');
    assert.equal(await statusOf(pool, stalledType), 'OPEN', 'other alert types are handled by their own rule');
    assert.equal(await statusOf(pool, needsPerson), 'OPEN', 'failed after payment still needs a person');
  } finally { await pool.end(); }
});
