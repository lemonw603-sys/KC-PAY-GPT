import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { recordSucceededOrders, resolveDeliveredSuccessAlertsSql } from '../src/db/repositories/order-success-push.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';
import { JUST_USED_CARD_SQL, RESERVED_CARDS_SQL } from '../src/services/card-supply-scheduler-service.js';

// D-409（2026-09-29）：「充值成功」推送、推送记录不再把已发出的改成 CANCELLED、调度器两条卡查询——真 MySQL 上跑。
// 用法：v1/scripts/mysql-tests.sh test/push-d409-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';
const PLUS = '00000000-0000-4000-8000-000000000201';
const ROUTE = '00000000-0000-4000-8000-000000000301';
const HV = '00000000-0000-4000-8000-000000000103';
const id = () => crypto.randomUUID();

async function order(pool, status, { finishedMinutesAgo = 1, createdSecondsBefore = 110, email = 'a.chen@example.com' } = {}) {
  const orderId = id(); const cdkId = id();
  await pool.query(`INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`, [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(
    `INSERT INTO orders (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance, session_ciphertext,
       card_purchase_idempotency_key, product_id, fulfillment_route_id, frozen_card_provider_account_id, route_resolution_status,
       customer_email, finished_at, created_at)
     VALUES (?, ?, ?, ?, '23', 16, 16, ?, ?, ?, ?, ?, 'RESOLVED', ?,
       NOW(3) - INTERVAL ? MINUTE, NOW(3) - INTERVAL ? MINUTE - INTERVAL ? SECOND)`,
    [orderId, `PJV1-sp-${orderId.slice(0, 8)}`, cdkId, status, Buffer.from('x'), `purchase-${orderId}`, PLUS, ROUTE, HV, email,
      finishedMinutesAgo, finishedMinutesAgo, createdSecondsBefore]);
  return orderId;
}
const successAlerts = async (pool) => (await pool.query(
  `SELECT a.order_id, a.title, a.message, a.status, a.severity FROM operator_alerts a WHERE a.alert_type = 'ORDER_RECHARGE_SUCCEEDED' ORDER BY a.created_at`))[0];

test('D-409 充值成功：刚成功的单每单一条（产品 · 用时），30 分钟前的、失败的、演练单不推；再跑一轮不重复', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const fresh = await order(pool, 'RECHARGE_SUCCESS');
    await order(pool, 'RECHARGE_SUCCESS', { finishedMinutesAgo: 45 });
    await order(pool, 'RECHARGE_FAILED');
    // 演练单：有运行记录、没有正式运行（rehearsalOrderSql）
    const rehearsal = await order(pool, 'RECHARGE_SUCCESS');
    const attemptId = id();
    const profileId = id();
    await pool.query(`INSERT INTO executor_profiles (id, profile_code, profile_version, adapter_version, executor_kind, runtime_id)
      VALUES (?, ?, 1, 'test', 'BROWSER', 'test')`, [profileId, `sp-${profileId.slice(0, 8)}`]);
    await pool.query("INSERT INTO recharge_attempts (id, order_id, executor_kind) VALUES (?, ?, 'BROWSER')", [attemptId, rehearsal]);
    await pool.query(`INSERT INTO browser_runs (id, recharge_attempt_id, executor_profile_id, account_key_hmac, run_no,
        start_operation_key, status, payment_state, worker_id)
      VALUES (?, ?, ?, ?, 1, ?, 'FAILED_SAFE', 'NOT_STARTED', 'production-readonly-1')`,
    [id(), attemptId, profileId, crypto.randomBytes(32).toString('hex'), `op-${crypto.randomBytes(12).toString('hex')}`]);

    const connection = await pool.getConnection();
    try {
      assert.equal(await recordSucceededOrders(connection), 1);
      assert.equal(await recordSucceededOrders(connection), 0, '第二轮不重复开');
    } finally { connection.release(); }
    const rows = await successAlerts(pool);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].order_id, rows[0].title, rows[0].message, rows[0].status, rows[0].severity],
      [fresh, '充值成功', 'Plus · 用时 1 分 50 秒', 'OPEN', 'info']);

    // 推送入队 → 发出 → 收掉；收掉后推送记录仍是 SENT（欠账 32）
    const repo = createAlertNotificationRepository(pool);
    await repo.enqueueOpenAlerts();
    const delivery = await repo.claimNext();
    assert.equal(delivery.type, 'ORDER_RECHARGE_SUCCEEDED');
    assert.equal(delivery.customerEmail, 'a.chen@example.com');
    await repo.markSent(delivery.id, { incidentVersion: delivery.incidentVersion });
    await pool.query(resolveDeliveredSuccessAlertsSql());
    assert.equal((await successAlerts(pool))[0].status, 'RESOLVED', '推完就收，不堆在后台');
    await repo.enqueueOpenAlerts();
    const [[n]] = await pool.query('SELECT status, sent_at IS NOT NULL AS sent FROM alert_notifications WHERE id = ?', [delivery.id]);
    assert.deepEqual([n.status, Number(n.sent)], ['SENT', 1], '告警关了，已发出的推送记录不改成 CANCELLED');
  } finally { await pool.end(); }
});

test('D-409 调度器两条卡查询：进行中订单占着的卡数、一小时内刚用掉的卡尾号', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const card = async (last4) => {
      const cardId = id();
      await pool.query(`INSERT INTO cards (id, provider_account_id, provider_card_id, external_card_id, card_type_id, status, intake_status,
          inventory_status, sync_tier, currency, funded_amount, current_balance, last4)
        VALUES (?, ?, ?, ?, '23', 'active', 'ACCEPTED', 'AVAILABLE', 'MANUAL_IMPORT', 'USD', 16, 16, ?)`, [cardId, HV, `sp-${cardId}`, `sp-${cardId}`, last4]);
      return cardId;
    };
    const ledger = (cardId, orderId, status, consumedMinutesAgo = null) => pool.query(
      `INSERT INTO card_consumption_ledger (id, card_id, order_id, product_id, status, amount, currency, consumed_at)
       VALUES (?, ?, ?, ?, ?, 16, 'USD', IF(? IS NULL, NULL, NOW(3) - INTERVAL ? MINUTE))`,
      [id(), cardId, orderId, PLUS, status, consumedMinutesAgo, consumedMinutesAgo ?? 0]);
    const held = await card('1111');
    await ledger(held, await order(pool, 'RECHARGE_PROCESSING'), 'RESERVED');
    await ledger(await card('2222'), await order(pool, 'RECHARGE_FAILED'), 'RELEASED');
    await ledger(await card('3333'), await order(pool, 'RECHARGE_SUCCESS'), 'CONSUMED', 90);
    await ledger(await card('5270'), await order(pool, 'RECHARGE_SUCCESS'), 'CONSUMED', 2);
    const [[reserved]] = await pool.query(RESERVED_CARDS_SQL, [HV, PLUS]);
    assert.equal(Number(reserved.count), 1, '只算 RESERVED');
    const [[justUsed]] = await pool.query(JUST_USED_CARD_SQL, [HV, PLUS]);
    assert.equal(justUsed.last4, '5270', '一小时内最近用掉的那张');
    const [[none]] = await pool.query(RESERVED_CARDS_SQL, ['00000000-0000-4000-8000-000000000101', PLUS]);
    assert.equal(Number(none.count), 0, '按台分开');
  } finally { await pool.end(); }
});

test('D-409 两轮巡检同时捡到同一单：只开一条、不报错（第二轮的插入等第一轮提交后被跳过）', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const orderId = await order(pool, 'RECHARGE_SUCCESS');
    const first = await pool.getConnection();
    const second = await pool.getConnection();
    try {
      await first.beginTransaction();
      // 同一个库里前面的测试也留了刚成功的单，所以这里只断言「至少捡到这一单」，数量不写死
      assert.ok(await recordSucceededOrders(first) >= 1);
      // 第二轮看不到第一轮还没提交的那条（可重复读），会去插同一个 dedupe_key，被唯一键锁住等第一轮提交
      const racing = recordSucceededOrders(second);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await first.commit();
      assert.ok(await racing >= 1, '第二轮也认为该开，但插入被跳过、不报错');
    } finally { first.release(); second.release(); }
    const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM operator_alerts WHERE dedupe_key = ?`, [`order-succeeded:${orderId}`]);
    assert.equal(Number(n.n), 1);
  } finally { await pool.end(); }
});
