import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { transitionOrder } from '../src/db/repositories/order-repository.js';
import { claimNextTask } from '../src/db/repositories/task-repository.js';
import { OrderStatus } from '../src/domain/order-status.js';
import { recordProviderCall } from '../src/providers/provider-call-recorder.js';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { encryptSecret } from '../src/security/secret-box.js';
import { createWorkflowHandlers } from '../src/workers/workflow-handlers.js';
import { runWorkerIteration } from '../src/workers/worker-runtime.js';
import { createOrderIntakeService } from '../src/services/order-intake-service.js';
import { decryptSecret } from '../src/security/secret-box.js';
import { sessionFixture } from '../test-support/session-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationSessionKey = Buffer.alloc(32, 7);

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
     (id, public_no, cdk_id, status, card_type_id, open_card_amount,
      session_ciphertext, card_purchase_idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      overrides.publicNo || `TEST-${orderId}`,
      cdkId,
      overrides.status || OrderStatus.CREATED,
      '7',
      '25.000000',
      encryptSecret(JSON.stringify({ accessToken: 'fixture-token', account: { id: 'acct-1' } }), integrationSessionKey),
      overrides.purchaseKey || `purchase-${orderId}`
    ]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  return { cdkId, orderId };
}

async function removeOrder(pool, { cdkId, orderId }) {
  await pool.query('DELETE FROM tasks WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM provider_calls WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM refund_cases WHERE order_id = ?', [orderId]);
  const [cards] = await pool.query('SELECT id FROM cards WHERE order_id = ?', [orderId]);
  for (const card of cards) {
    await pool.query('DELETE FROM card_transactions WHERE card_id = ?', [card.id]);
  }
  await pool.query('DELETE FROM cards WHERE order_id = ?', [orderId]);
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

test('workflow repository commits card and recharge handoffs atomically', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool);
  const workflow = createWorkflowRepository(pool, {
    sessionEncryptionKey: integrationSessionKey
  });
  try {
    const initial = await workflow.loadOrderContext(fixture.orderId);
    assert.equal(initial.session.accessToken, 'fixture-token');
    assert.equal(initial.order.card_type_id, '7');
    assert.equal(initial.card, null);

    await workflow.transition(
      fixture.orderId,
      OrderStatus.CARD_PURCHASING,
      'integration test purchase start'
    );

    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key)
       VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?)`,
      [fixture.orderId, `submit-recharge:${fixture.orderId}`]
    );
    await assert.rejects(
      workflow.commitPurchasedCard(fixture.orderId, {
        providerCardId: 'provider-card-fixture',
        cardTypeId: 7,
        last4: '4242',
        fundedAmount: '25.000000',
        currentBalance: '25.000000',
        currency: 'USD'
      }),
      /Duplicate entry/
    );
    const [[rolledBackPurchase]] = await pool.query(
      `SELECT o.status, COUNT(c.id) AS card_count
       FROM orders o LEFT JOIN cards c ON c.order_id = o.id
       WHERE o.id = ? GROUP BY o.id`,
      [fixture.orderId]
    );
    assert.equal(rolledBackPurchase.status, OrderStatus.CARD_PURCHASING);
    assert.equal(rolledBackPurchase.card_count, 0);
    await pool.query('DELETE FROM tasks WHERE dedupe_key = ?', [
      `submit-recharge:${fixture.orderId}`
    ]);

    await workflow.commitPurchasedCard(fixture.orderId, {
      providerCardId: 'provider-card-fixture',
      cardTypeId: 7,
      last4: '4242',
      fundedAmount: '25.000000',
      currentBalance: '25.000000',
      currency: 'USD'
    });

    const afterCard = await workflow.loadOrderContext(fixture.orderId);
    assert.equal(afterCard.order.status, OrderStatus.CARD_READY);
    assert.equal(afterCard.card.provider_card_id, 'provider-card-fixture');

    await workflow.transition(
      fixture.orderId,
      OrderStatus.SUBMITTING,
      'integration test submit start'
    );

    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key)
       VALUES (?, 'POLL_RECHARGE', 'PENDING', ?)`,
      [fixture.orderId, `poll-recharge:${fixture.orderId}`]
    );
    await assert.rejects(
      workflow.commitRechargeSubmission(fixture.orderId, {
        orderNo: 'fixture-order-12',
        cardKey: 'DIRECT-fixture'
      }),
      /Duplicate entry/
    );
    const [[rolledBackSubmission]] = await pool.query(
      `SELECT status, recharge_order_no, recharge_card_key
       FROM orders WHERE id = ?`,
      [fixture.orderId]
    );
    assert.deepEqual(rolledBackSubmission, {
      status: OrderStatus.SUBMITTING,
      recharge_order_no: null,
      recharge_card_key: null
    });
    await pool.query('DELETE FROM tasks WHERE dedupe_key = ?', [
      `poll-recharge:${fixture.orderId}`
    ]);

    await workflow.commitRechargeSubmission(fixture.orderId, {
      orderNo: 'fixture-order-12',
      cardKey: 'DIRECT-fixture'
    });

    const [[stored]] = await pool.query(
      `SELECT status, recharge_order_no, recharge_card_key
       FROM orders WHERE id = ?`,
      [fixture.orderId]
    );
    assert.deepEqual(stored, {
      status: OrderStatus.RECHARGE_PROCESSING,
      recharge_order_no: 'fixture-order-12',
      recharge_card_key: 'DIRECT-fixture'
    });
    const [tasks] = await pool.query(
      'SELECT task_type, status FROM tasks WHERE order_id = ? ORDER BY id',
      [fixture.orderId]
    );
    assert.deepEqual(tasks, [
      { task_type: 'SUBMIT_RECHARGE', status: 'PENDING' },
      { task_type: 'POLL_RECHARGE', status: 'PENDING' }
    ]);
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('order intake atomically redeems one CDK and creates an encrypted queued order', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const cdkId = id();
  const cdk = `CDK-${id()}`;
  const cdkHash = crypto.createHash('sha256').update(cdk).digest('hex');
  const nowMs = Date.parse('2026-08-17T00:00:00.000Z');
  const session = sessionFixture({ nowMs });
  const createCustomerOrder = createOrderIntakeService({
    pool,
    sessionEncryptionKey: integrationSessionKey,
    now: () => nowMs
  });
  let created;
  await pool.query(
    `INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'AVAILABLE')`,
    [cdkId, cdkHash]
  );
  try {
    await assert.rejects(
      createCustomerOrder({ cdk, session }),
      (error) => error.code === 'ORDERING_PAUSED'
    );
    await pool.query(
      `UPDATE app_settings SET setting_value = 'true'
       WHERE setting_key = 'accept_new_orders'`
    );
    await assert.rejects(
      createCustomerOrder({ cdk, session }),
      (error) => error.code === 'ORDERING_NOT_CONFIGURED'
    );
    await pool.query(
      `UPDATE app_settings SET setting_value = CASE setting_key
         WHEN 'default_card_type_id' THEN '7'
         WHEN 'default_open_card_amount' THEN '25'
         ELSE setting_value END
       WHERE setting_key IN ('default_card_type_id', 'default_open_card_amount')`
    );

    const concurrent = await Promise.allSettled([
      createCustomerOrder({ cdk, session }),
      createCustomerOrder({ cdk, session })
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => (
      result.status === 'rejected' && result.reason?.code === 'CDK_UNAVAILABLE'
    )).length, 1);
    created = concurrent.find((result) => result.status === 'fulfilled').value;
    assert.equal(created.status, OrderStatus.CREATED);
    assert.match(created.publicNo, /^PJV1-[A-Za-z0-9_-]{20}$/);

    const [[order]] = await pool.query(
      `SELECT status, customer_email, chatgpt_account_id, card_type_id,
              open_card_amount, session_ciphertext
       FROM orders WHERE id = ?`,
      [created.orderId]
    );
    assert.equal(order.status, OrderStatus.CREATED);
    assert.equal(order.customer_email, 'fixture@example.com');
    assert.equal(order.chatgpt_account_id, 'account-fixture');
    assert.equal(order.card_type_id, '7');
    assert.equal(order.open_card_amount, '25.000000');
    assert.deepEqual(
      JSON.parse(decryptSecret(order.session_ciphertext, integrationSessionKey)),
      session
    );
    const [[redeemed]] = await pool.query(
      'SELECT status, order_id, code_hash FROM cdks WHERE id = ?',
      [cdkId]
    );
    assert.deepEqual(redeemed, {
      status: 'REDEEMED',
      order_id: created.orderId,
      code_hash: cdkHash
    });
    const [tasks] = await pool.query(
      'SELECT task_type, status FROM tasks WHERE order_id = ?',
      [created.orderId]
    );
    assert.deepEqual(tasks, [{ task_type: 'PURCHASE_CARD', status: 'PENDING' }]);
    const [events] = await pool.query(
      `SELECT from_status, to_status, actor_type
       FROM order_events WHERE order_id = ?`,
      [created.orderId]
    );
    assert.deepEqual(events, [{
      from_status: null,
      to_status: OrderStatus.CREATED,
      actor_type: 'CUSTOMER'
    }]);
  } finally {
    await pool.query(
      `UPDATE app_settings SET setting_value = CASE setting_key
         WHEN 'accept_new_orders' THEN 'false'
         ELSE '' END
       WHERE setting_key IN (
         'accept_new_orders', 'default_card_type_id', 'default_open_card_amount'
       )`
    );
    if (created) {
      await removeOrder(pool, { cdkId, orderId: created.orderId });
    } else {
      await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
    }
    await pool.end();
  }
});

test('worker runs a full fake-provider workflow while enforcing runtime gates', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool);
  const providerActions = [];
  const workflow = createWorkflowRepository(pool, {
    sessionEncryptionKey: integrationSessionKey
  });
  const cardProvider = {
    purchaseCard: async () => {
      providerActions.push('purchase');
      return { data: { card: { id: 'fake-card-e2e' } } };
    },
    card: async () => {
      providerActions.push('card-details');
      return { data: { number: '4242424242424242', cvv: '123' } };
    }
  };
  const rechargeProvider = {
    createDirectOrder: async () => {
      providerActions.push('create-recharge');
      return { orderNo: 'fake-order-e2e', cardKey: 'DIRECT-fake-e2e' };
    },
    queryStatus: async () => {
      providerActions.push('poll-recharge');
      return { status: 'success', isSubscriptionCancelled: 0 };
    }
  };
  const handlers = createWorkflowHandlers({
    workflow,
    cardProvider,
    rechargeProvider,
    recordCall: (input) => recordProviderCall({ pool, ...input }),
    mapPurchasedCard: () => ({
      providerCardId: 'fake-card-e2e',
      cardTypeId: 7,
      last4: '4242',
      fundedAmount: '25.000000',
      currentBalance: '25.000000',
      currency: 'USD'
    }),
    mapCardCredentials: () => ({
      cardNumber: '4242424242424242',
      expMonth: 12,
      expYear: 2032,
      cvv: '123'
    }),
    wait: async () => {}
  });
  const iteration = (overrides = {}) => runWorkerIteration({
    pool,
    workerId: 'fake-e2e-worker',
    handlers,
    providerReadsEnabled: true,
    providerWritesEnabled: true,
    ...overrides
  });

  try {
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key)
       VALUES (?, 'PURCHASE_CARD', 'PENDING', ?)`,
      [fixture.orderId, `purchase-card:${fixture.orderId}`]
    );

    const blocked = await iteration({ providerWritesEnabled: false });
    assert.equal(blocked.handled, false);
    assert.deepEqual(providerActions, []);

    await pool.query(
      `UPDATE app_settings SET setting_value = 'true'
       WHERE setting_key = 'dispatch_new_recharges'`
    );
    assert.equal((await iteration()).status, 'COMPLETED');
    assert.equal((await iteration()).status, 'COMPLETED');

    await pool.query(
      `UPDATE app_settings SET setting_value = 'false'
       WHERE setting_key = 'dispatch_new_recharges'`
    );
    await pool.query(
      `UPDATE tasks SET available_at = CURRENT_TIMESTAMP(3)
       WHERE order_id = ? AND task_type = 'POLL_RECHARGE'`,
      [fixture.orderId]
    );
    assert.equal((await iteration({ providerWritesEnabled: false })).status, 'COMPLETED');

    const [[order]] = await pool.query(
      `SELECT status, recharge_order_no, recharge_card_key
       FROM orders WHERE id = ?`,
      [fixture.orderId]
    );
    assert.deepEqual(order, {
      status: OrderStatus.RECHARGE_SUCCESS,
      recharge_order_no: 'fake-order-e2e',
      recharge_card_key: 'DIRECT-fake-e2e'
    });
    const [tasks] = await pool.query(
      'SELECT task_type, status FROM tasks WHERE order_id = ? ORDER BY id',
      [fixture.orderId]
    );
    assert.deepEqual(tasks, [
      { task_type: 'PURCHASE_CARD', status: 'COMPLETED' },
      { task_type: 'SUBMIT_RECHARGE', status: 'COMPLETED' },
      { task_type: 'POLL_RECHARGE', status: 'COMPLETED' }
    ]);
    assert.deepEqual(providerActions, [
      'purchase',
      'card-details',
      'create-recharge',
      'poll-recharge'
    ]);
  } finally {
    await pool.query(
      `UPDATE app_settings SET setting_value = 'false'
       WHERE setting_key = 'dispatch_new_recharges'`
    );
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('provider call audit persists only a redacted summary', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
  const fixture = await createOrder(pool);
  try {
    await recordProviderCall({
      pool,
      orderId: fixture.orderId,
      provider: 'hnskj',
      operation: 'fixture_read',
      requestKey: `fixture-${fixture.orderId}`,
      action: async () => ({
        ok: true,
        apiKey: 'nhs_must-not-persist',
        cardNumber: '4242424242424242'
      }),
      summarize: (value) => value
    });

    const [[row]] = await pool.query(
      `SELECT outcome, response_summary_json
       FROM provider_calls WHERE order_id = ?`,
      [fixture.orderId]
    );
    const summary = typeof row.response_summary_json === 'string'
      ? JSON.parse(row.response_summary_json)
      : row.response_summary_json;
    assert.equal(row.outcome, 'SUCCESS');
    assert.deepEqual(summary, {
      ok: true,
      apiKey: '[REDACTED]',
      cardNumber: '[REDACTED]'
    });
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
