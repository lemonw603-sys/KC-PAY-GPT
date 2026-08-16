import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { transitionOrder } from '../src/db/repositories/order-repository.js';
import { claimNextTask } from '../src/db/repositories/task-repository.js';
import { OrderStatus } from '../src/domain/order-status.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

function id() {
  return crypto.randomUUID();
}

async function createOrder(pool, overrides = {}) {
  const cdkId = overrides.cdkId || id();
  const orderId = overrides.orderId || id();
  await pool.query(
    `INSERT INTO cdks (id, code_hash, status)
     VALUES (?, ?, 'REDEEMED')`,
    [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]
  );
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, session_ciphertext, card_purchase_idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      overrides.publicNo || `TEST-${orderId}`,
      cdkId,
      overrides.status || OrderStatus.CREATED,
      Buffer.from('encrypted-test-session'),
      overrides.purchaseKey || `purchase-${orderId}`
    ]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  return { cdkId, orderId };
}

async function removeOrder(pool, { cdkId, orderId }) {
  await pool.query('DELETE FROM tasks WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
  await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
}

test('MySQL enforces one CDK per order and records transitions atomically', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool);
  try {
    const transitioned = await transitionOrder(pool, {
      orderId: fixture.orderId,
      toStatus: OrderStatus.CARD_PURCHASING,
      actorType: 'TEST',
      actorId: 'mysql-integration',
      reason: 'verify atomic transition'
    });
    assert.equal(transitioned.fromStatus, OrderStatus.CREATED);
    assert.equal(transitioned.toStatus, OrderStatus.CARD_PURCHASING);

    const [events] = await pool.query(
      'SELECT from_status, to_status FROM order_events WHERE order_id = ?',
      [fixture.orderId]
    );
    assert.deepEqual(events, [{
      from_status: OrderStatus.CREATED,
      to_status: OrderStatus.CARD_PURCHASING
    }]);

    await assert.rejects(
      transitionOrder(pool, {
        orderId: fixture.orderId,
        toStatus: OrderStatus.RECHARGE_SUCCESS,
        actorType: 'TEST',
        reason: 'invalid jump must roll back'
      }),
      /Invalid order status transition/
    );
    const [[order]] = await pool.query(
      'SELECT status, version FROM orders WHERE id = ?',
      [fixture.orderId]
    );
    assert.equal(order.status, OrderStatus.CARD_PURCHASING);
    assert.equal(order.version, 2);

    await assert.rejects(
      pool.query(
        `INSERT INTO orders
         (id, public_no, cdk_id, status, session_ciphertext, card_purchase_idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id(),
          `DUP-${id()}`,
          fixture.cdkId,
          OrderStatus.CREATED,
          Buffer.from('encrypted'),
          `purchase-${id()}`
        ]
      ),
      (error) => error?.code === 'ER_DUP_ENTRY'
    );
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('only one worker claims a task and an expired lease is recoverable', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 6, timezone: 'Z' });
  const fixture = await createOrder(pool);
  try {
    const [insert] = await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'PURCHASE_CARD', 'PENDING', ?, 5)`,
      [fixture.orderId, `claim-${fixture.orderId}`]
    );

    const claims = await Promise.all([
      claimNextTask(pool, { workerId: 'worker-a', leaseSeconds: 60 }),
      claimNextTask(pool, { workerId: 'worker-b', leaseSeconds: 60 })
    ]);
    assert.equal(claims.filter(Boolean).length, 1);

    await pool.query(
      `UPDATE tasks
       SET status = 'RUNNING', leased_by = 'crashed-worker',
           leased_until = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
       WHERE id = ?`,
      [insert.insertId]
    );

    const recovered = await claimNextTask(pool, {
      workerId: 'recovery-worker',
      leaseSeconds: 90
    });
    assert.equal(recovered.id, insert.insertId);
    assert.equal(recovered.attempts, 2);

    const [[stored]] = await pool.query(
      'SELECT status, leased_by, attempts FROM tasks WHERE id = ?',
      [insert.insertId]
    );
    assert.deepEqual(stored, {
      status: 'RUNNING',
      leased_by: 'recovery-worker',
      attempts: 2
    });
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('new-order and new-recharge switches default to disabled', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
  try {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN ('accept_new_orders', 'dispatch_new_recharges')
       ORDER BY setting_key`
    );
    assert.deepEqual(rows, [
      { setting_key: 'accept_new_orders', setting_value: 'false' },
      { setting_key: 'dispatch_new_recharges', setting_value: 'false' }
    ]);
  } finally {
    await pool.end();
  }
});
