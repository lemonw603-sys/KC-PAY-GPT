import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import {
  reserveCardConsumption,
  transitionCardConsumptionInTransaction
} from '../src/services/card-consumption-ledger-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('MySQL serializes concurrent card capacity and preserves unknown consumption', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；卡片消费账本集成测试只在隔离数据库运行'
}, async () => {
  const pool = mysql.createPool(databaseUrl);
  const suffix = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const orders = Array.from({ length: 4 }, () => ({ cdkId: crypto.randomUUID(), orderId: crypto.randomUUID() }));
  try {
    for (const { cdkId, orderId } of orders) {
      await pool.query("INSERT INTO cdks (id, code_hash, status, order_id) VALUES (?, SHA2(?,256), 'REDEEMED', NULL)", [cdkId, cdkId]);
      await pool.query(
        `INSERT INTO orders
         (id, public_no, cdk_id, status, plan_type, product_id, session_ciphertext,
          card_purchase_idempotency_key)
         VALUES (?, ?, ?, 'CARD_READY', 'plus', '00000000-0000-4000-8000-000000000201',
          'fixture', ?)`,
        [orderId, `ledger-${suffix.slice(0, 8)}-${orderId.slice(0, 8)}`, cdkId, `ledger-purchase-${orderId}`]
      );
      await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    }
    await pool.query(
      `INSERT INTO cards
       (id, provider_account_id, order_id, provider_card_id, external_card_id, card_type_id,
        status, funded_amount, current_balance, currency, inventory_status, intake_status)
       VALUES (?, '00000000-0000-4000-8000-000000000101', NULL, ?, ?, '16',
        'active', 16, 16, 'USD', 'AVAILABLE', 'ACCEPTED')`,
      [cardId, `ledger-${suffix}`, `ledger-${suffix}`]
    );

    const settled = await Promise.allSettled(orders.map(({ orderId }) => reserveCardConsumption(pool, {
      cardId, orderId, maxPayments: 3
    })));
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 3);
    const rejection = settled.find(item => item.status === 'rejected');
    assert.equal(rejection.reason.code, 'CARD_CONSUMPTION_LIMIT');

    const reservations = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
    await transitionCardConsumptionInTransaction(pool, {
      id: reservations[0].id, targetStatus: 'CONSUMED'
    });
    await transitionCardConsumptionInTransaction(pool, {
      id: reservations[1].id, targetStatus: 'RECONCILIATION'
    });
    await transitionCardConsumptionInTransaction(pool, {
      id: reservations[2].id, targetStatus: 'RELEASED', reason: 'definitely not submitted'
    });
    const [[counts]] = await pool.query(
      `SELECT SUM(status='CONSUMED') consumed, SUM(status='RECONCILIATION') reconciliation,
              SUM(status='RELEASED') released
       FROM card_consumption_ledger WHERE card_id = ?`, [cardId]
    );
    assert.deepEqual(
      [Number(counts.consumed), Number(counts.reconciliation), Number(counts.released)],
      [1, 1, 1]
    );
  } finally {
    await pool.query('DELETE FROM card_consumption_ledger WHERE card_id = ?', [cardId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    for (const { cdkId, orderId } of orders.reverse()) {
      await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
      await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
    }
    await pool.end();
  }
});
