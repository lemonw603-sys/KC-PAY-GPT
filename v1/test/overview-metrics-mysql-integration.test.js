import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createAdminReadService } from '../src/services/admin-read-service.js';

// D-405 第三批（口径 Lemon 2026-09-28 定）：工作台「自动完成率」「异常支出」两格的 SQL 在真 MySQL 上跑一遍。
// 用法：v1/scripts/mysql-tests.sh test/overview-metrics-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';
const PLUS = '00000000-0000-4000-8000-000000000201';
const ROUTE = '00000000-0000-4000-8000-000000000301';
const HV = '00000000-0000-4000-8000-000000000103';
const id = () => crypto.randomUUID();

async function order(pool, status, { daysAgo = 0 } = {}) {
  const orderId = id(); const cdkId = id();
  await pool.query(`INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
    [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(
    `INSERT INTO orders (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance,
       session_ciphertext, card_purchase_idempotency_key, product_id, fulfillment_route_id, frozen_card_provider_account_id,
       route_resolution_status, created_at, finished_at)
     VALUES (?, ?, ?, ?, '23', 16, 16, ?, ?, ?, ?, ?, 'RESOLVED', NOW(3) - INTERVAL ? DAY, NOW(3) - INTERVAL ? DAY)`,
    [orderId, `PJV1-om-${orderId.slice(0, 8)}`, cdkId, status, Buffer.from('x'), `purchase-${orderId}`, PLUS, ROUTE, HV, daysAgo, daysAgo]);
  return orderId;
}
const event = (pool, orderId, actorType) => pool.query(
  `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason) VALUES (?, 'RECHARGE_SUCCESS', 'RECHARGE_SUCCESS', ?, ?, 'fixture')`,
  [orderId, actorType, actorType === 'ADMIN' ? 'admin' : actorType.toLowerCase()]);

test('D-405 自动完成率：分母＝近 7 天已结束真实单；分子＝其中成功且没有 ADMIN / OPERATOR 事件的（客户、执行器的事件不算）', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const clean = await order(pool, 'RECHARGE_SUCCESS');
    const admin = await order(pool, 'RECHARGE_SUCCESS'); await event(pool, admin, 'ADMIN');
    const operator = await order(pool, 'RECHARGE_SUCCESS'); await event(pool, operator, 'OPERATOR');
    const customer = await order(pool, 'RECHARGE_SUCCESS'); await event(pool, customer, 'CUSTOMER'); await event(pool, customer, 'WORKER');
    await order(pool, 'RECHARGE_FAILED');
    await order(pool, 'RECHARGE_SUCCESS', { daysAgo: 10 });
    await order(pool, 'RECHARGE_PROCESSING');
    void clean;
    const { metrics } = await createAdminReadService({ pool }).getOverview();
    assert.equal(metrics.recentFinishedOrders, 5, '7 天内已结束的 5 单（10 天前那单、处理中那单不算）');
    assert.equal(metrics.recentSuccessfulOrders, 4);
    assert.equal(metrics.recentAutomaticOrders, 2, '干净的 + 只有客户 / 执行器事件的');
    assert.equal(metrics.recentAutomaticRate, 40);
  } finally { await pool.end(); }
});

test('D-405 异常支出：近 7 天拒付 + 拒付手续费（按 first_seen_at），7 天外和普通扣款不算；金额整数相加', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const cardId = id();
    await pool.query(`INSERT INTO cards (id, provider_account_id, provider_card_id, external_card_id, card_type_id, status, intake_status,
        inventory_status, sync_tier, currency, funded_amount, current_balance, last4)
      VALUES (?, ?, ?, ?, '23', 'active', 'ACCEPTED', 'AVAILABLE', 'MANUAL_IMPORT', 'USD', 16, 0, '9001')`, [cardId, HV, `om-${cardId}`, `om-${cardId}`]);
    const tx = (type, amount, daysAgo) => pool.query(
      `INSERT INTO card_transactions (card_id, provider_transaction_id, transaction_type, status, amount, currency, raw_hash, first_seen_at)
       VALUES (?, ?, ?, 'x', ?, 'USD', ?, NOW(3) - INTERVAL ? DAY)`, [cardId, `om-${id()}`, type, amount, crypto.randomBytes(32).toString('hex'), daysAgo]);
    await tx('CHARGEBACK', '128.750000', 1);
    await tx('chargeback', '0.100000', 0);
    await tx('CHARGEBACK_FEE', '0.400000', 1);
    await tx('CHARGEBACK', '50.000000', 10);
    await tx('PURCHASE', '16.000000', 0);
    const { metrics } = await createAdminReadService({ pool }).getOverview();
    assert.deepEqual(metrics.abnormalSpend, {
      windowDays: 7, currency: 'USD', total: '129.250000',
      chargebacks: { amount: '128.850000', count: 2 }, chargebackFees: { amount: '0.400000', count: 1 }
    });
  } finally { await pool.end(); }
});
