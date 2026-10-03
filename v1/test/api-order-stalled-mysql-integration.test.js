import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { encryptSecret } from '../src/security/secret-box.js';
import { API_PROCESSING_STUCK_SQL, RESOLVE_API_STALLED_SQL, apiStuckAlert } from '../src/db/repositories/stalled-order-queries.js';
import { upsertBrowserAlertInTransaction } from '../src/db/repositories/browser-alert-repository.js';
import { PHONE_PUSH_TYPES } from '../src/domain/alert-push-policy.js';

// D-414 补记十一（Lemon 2026-10-02 同意）：API 单停在「提交中 / 充值处理中」太久要推手机。此前巡检只看 Browser 单，
// 直充平台一直 pending 时查询任务问满 1 小时放弃，订单停在 RECHARGE_PROCESSING、没人收到推送。
// 用法：v1/scripts/mysql-tests.sh test/api-order-stalled-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';

const BACKUP_A = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';
const ROUTE_API = '00000000-0000-4000-8000-000000000301';
const ROUTE_BROWSER = '00000000-0000-4000-8000-000000000302';
const KEY = Buffer.alloc(32, 7);
const id = () => crypto.randomUUID();

async function insertOrder(pool, { route = ROUTE_API, status = 'RECHARGE_PROCESSING', minutesAgo = 20, platformNo = 'ZZ-1001' } = {}) {
  const cdkId = id(); const orderId = id(); const publicNo = `PJV1-st-${orderId.slice(0, 8)}`;
  await pool.query(`INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
    [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance,
      session_ciphertext, card_purchase_idempotency_key, product_id, fulfillment_route_id,
      frozen_card_provider_account_id, route_resolution_status, recharge_order_no, updated_at)
     VALUES (?, ?, ?, ?, '708', '16.000000', '16.000000', ?, ?, ?, ?, ?, 'RESOLVED', ?,
       CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE)`,
    [orderId, publicNo, cdkId, status, encryptSecret(JSON.stringify({ accessToken: 'x' }), KEY), `purchase-${orderId}`,
      PLUS, route, BACKUP_A, platformNo, minutesAgo]
  );
  return { orderId, publicNo };
}

async function stuck(pool) {
  const [rows] = await pool.query(API_PROCESSING_STUCK_SQL, [5]);
  return rows;
}

test('API 单停在处理中超过 5 分钟才报（D-414 补记十三，时间兜底）；Browser 单、刚开始的单、已有付款不明告警的单不报；结束后自动收掉', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const old = await insertOrder(pool, { minutesAgo: 20 });
    const fresh = await insertOrder(pool, { minutesAgo: 4 });
    const submitting = await insertOrder(pool, { status: 'SUBMITTING', minutesAgo: 30, platformNo: null });
    const browser = await insertOrder(pool, { route: ROUTE_BROWSER, minutesAgo: 40 });
    const covered = await insertOrder(pool, { minutesAgo: 25 });
    await pool.query(
      `INSERT INTO operator_alerts (id, alert_type, dedupe_key, order_id, severity, title, message, status)
       VALUES (UUID(), 'ORDER_PAYMENT_UNKNOWN_REVIEW', ?, ?, 'critical', 't', 'm', 'OPEN')`,
      [`it-unknown:${covered.orderId}`, covered.orderId]);
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts, available_at)
       VALUES (?, 'POLL_RECHARGE', 'PENDING', ?, 720, CURRENT_TIMESTAMP(3))`, [old.orderId, `poll-recharge:${old.orderId}`]);

    const rows = await stuck(pool);
    const found = new Map(rows.map((row) => [row.public_no, row]));
    assert.ok(found.has(old.publicNo), '充值处理中 20 分钟：报');
    assert.ok(found.has(submitting.publicNo), '提交中 30 分钟、还没拿到平台单号：也报');
    assert.equal(found.has(fresh.publicNo), false, '才 4 分钟：不报（失败最慢 279 秒也在 5 分钟内出结果）');
    assert.equal(found.has(browser.publicNo), false, 'Browser 单另有三种巡检，这里不管');
    assert.equal(found.has(covered.publicNo), false, '已有「付款不明待核实」在管：不重复报');
    assert.equal(Number(found.get(old.publicNo).still_checking), 1, '查询任务还在：说「还在问」');
    assert.equal(Number(found.get(submitting.publicNo).still_checking), 0);

    const connection = await pool.getConnection();
    try {
      const alertOld = apiStuckAlert(found.get(old.publicNo));
      assert.equal(PHONE_PUSH_TYPES[alertOld.type], 'HUMAN', '要响手机');
      assert.match(alertOld.message, /直充平台单号 ZZ-1001/);
      assert.match(alertOld.message, /还在每 5 秒问一次平台/);
      assert.match(alertOld.message, /不会重付、不会换卡/);
      await upsertBrowserAlertInTransaction(connection, alertOld);
      const alertSubmitting = apiStuckAlert(found.get(submitting.publicNo));
      assert.match(alertSubmitting.message, /停在提交中/);
      assert.match(alertSubmitting.message, /还没拿到直充平台单号/);
      assert.match(alertSubmitting.message, /已经停止询问平台/);
      await upsertBrowserAlertInTransaction(connection, alertSubmitting);
    } finally { connection.release(); }

    const [[openRow]] = await pool.query(
      `SELECT status, message FROM operator_alerts WHERE alert_type = 'API_ORDER_STALLED' AND order_id = ?`, [old.orderId]);
    assert.equal(openRow.status, 'OPEN');
    assert.match(openRow.message, new RegExp(`订单 ${old.publicNo}`), '推送里带订单号，才知道是哪一单');

    // 这单后来结束了 → 收掉；另一单还在提交中 → 留着
    await pool.query(`UPDATE orders SET status = 'RECHARGE_SUCCESS' WHERE id = ?`, [old.orderId]);
    await pool.query(RESOLVE_API_STALLED_SQL);
    const [[closed]] = await pool.query(
      `SELECT status FROM operator_alerts WHERE alert_type = 'API_ORDER_STALLED' AND order_id = ?`, [old.orderId]);
    const [[still]] = await pool.query(
      `SELECT status FROM operator_alerts WHERE alert_type = 'API_ORDER_STALLED' AND order_id = ?`, [submitting.orderId]);
    assert.equal(closed.status, 'RESOLVED');
    assert.equal(still.status, 'OPEN');
  } finally { await pool.end(); }
});
