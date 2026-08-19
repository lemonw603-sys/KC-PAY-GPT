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
import {
  createAdminCdkService,
  downloadCdkBatch,
  listCdkBatches,
  revokeCdkBatch,
  storeCdkBatch
} from '../src/services/cdk-service.js';
import { createOrderStatusService } from '../src/services/order-status-service.js';
import { armRechargePermit } from '../src/services/recharge-permit-service.js';
import {
  createCardStockJobService,
  claimCardStockJob,
  updateCardStockJobProgress,
  completeCardStockJob
} from '../src/services/card-stock-job-service.js';

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
     (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance,
      session_ciphertext, card_purchase_idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      overrides.publicNo || `TEST-${orderId}`,
      cdkId,
      overrides.status || OrderStatus.CREATED,
      '7',
      '25.000000',
      '16.000000',
      encryptSecret(JSON.stringify({ accessToken: 'fixture-token', account: { id: 'acct-1' } }), integrationSessionKey),
      overrides.purchaseKey || `purchase-${orderId}`
    ]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  return { cdkId, orderId };
}

async function removeOrder(pool, { cdkId, orderId }) {
  await pool.query('DELETE FROM tasks WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM operator_alerts WHERE order_id = ?', [orderId]);
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

test('inventory assignment atomically gives one ready card to only one order', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const first = await createOrder(pool);
  const second = await createOrder(pool);
  const stockCardId = id();
  await pool.query(
    `INSERT INTO cards
     (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
      funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext)
     VALUES (?, NULL, 'AVAILABLE', 'stock-provider-1', '7', '4242', 'active',
       '16.000000', '16.000000', 'USD', 'MONITORING', ?)`,
    [stockCardId, encryptSecret(JSON.stringify({
      cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
    }), integrationSessionKey)]
  );
  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: integrationSessionKey });
  try {
    const results = await Promise.all([
      workflow.assignAvailableCard(first.orderId),
      workflow.assignAvailableCard(second.orderId)
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const [orders] = await pool.query(
      `SELECT id, status FROM orders WHERE id IN (?, ?) ORDER BY id`,
      [first.orderId, second.orderId]
    );
    assert.deepEqual(orders.map((row) => row.status).sort(), [OrderStatus.CARD_READY, OrderStatus.CREATED].sort());
    const [[card]] = await pool.query(
      `SELECT order_id, inventory_status FROM cards WHERE id = ?`, [stockCardId]
    );
    assert.ok([first.orderId, second.orderId].includes(card.order_id));
    assert.equal(card.inventory_status, 'ASSIGNED');
    const [tasks] = await pool.query(
      `SELECT task_type FROM tasks WHERE order_id = ? ORDER BY task_type`, [card.order_id]
    );
    assert.deepEqual(tasks.map((row) => row.task_type), ['PREPARE_RECHARGE', 'SUBMIT_RECHARGE']);
  } finally {
    await pool.query(`DELETE FROM operator_alerts WHERE dedupe_key = 'card-stock-low:7'`);
    await removeOrder(pool, first);
    await removeOrder(pool, second);
    await pool.query('DELETE FROM cards WHERE id = ?', [stockCardId]);
    await pool.end();
  }
});

test('card stock jobs require confirmation and move durably through the runner states', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const service = createCardStockJobService({ pool });
  let job;
  try {
    const snapshot = {
      provider: 'hnskj', syncedAt: new Date().toISOString(), purchaseEnabled: true,
      accountBalance: '100', currency: 'USD', exchangeRate: '1',
      cardLimit: { current: 0, maximum: 300, remaining: 300 },
      cardTypes: [{
        id: '7', name: 'Z-TEST', country: 'US', binPrefix: '40041606',
        effectiveCardFee: '0.5', effectiveFeeRate: '0.005',
        minimumAmount: '5', maximumAmount: '200', minimumAccountBalance: '25',
        requireMinimumAccountBalance: true, consumeRate: '0', chargebackFee: '0.4'
      }]
    };
    await pool.query(
      `INSERT INTO card_provider_snapshots (provider, payload_json, synced_at)
       VALUES ('hnskj', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), synced_at = VALUES(synced_at)`,
      [JSON.stringify(snapshot)]
    );
    await pool.query(
      `INSERT INTO card_catalog_snapshots (provider, payload_json, synced_at)
       VALUES ('hnskj', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), synced_at = VALUES(synced_at)`,
      [JSON.stringify({ providerActive: 0, unresolvedActive: 0 })]
    );
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('default_card_type_id','7')
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`
    );
    await assert.rejects(
      service.createJob({ count: 2, amount: 16, cardTypeId: '1', confirmation: 'wrong' }),
      (error) => error.code === 'CARD_STOCK_CONFIRMATION_REQUIRED'
    );
    await assert.rejects(
      service.createJob({ count: 11, amount: 5, confirmation: '开11张' }),
      (error) => error.code === 'CARD_STOCK_LARGE_BATCH_CONFIRMATION_REQUIRED'
    );
    job = await service.createJob({
      count: 11, amount: 5, cardTypeId: '1', confirmation: '开11张', largeBatchConfirmed: true
    });
    await assert.rejects(
      service.createJob({ count: 1, amount: 16, cardTypeId: '1', confirmation: '开1张' }),
      (error) => error.code === 'CARD_STOCK_JOB_ACTIVE'
    );
    const claimed = await claimCardStockJob(pool, { workerId: 'stock-worker-test' });
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.status, 'RUNNING');
    await updateCardStockJobProgress(pool, { jobId: job.id, workerId: 'stock-worker-test', openedCount: 1 });
    await completeCardStockJob(pool, { jobId: job.id, workerId: 'stock-worker-test', openedCount: 11 });
    const { jobs } = await service.listJobs();
    const completed = jobs.find((item) => item.id === job.id);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.openedCount, 11);
    assert.equal(completed.cardTypeId, '7');
    assert.equal(completed.estimatedTotal, '60.775000');
  } finally {
    if (job) await pool.query('DELETE FROM card_stock_jobs WHERE id = ?', [job.id]);
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
       VALUES (?, 'VERIFY_CARD', 'PENDING', ?)`,
      [fixture.orderId, `verify-card:${fixture.orderId}`]
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
      `verify-card:${fixture.orderId}`
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
    assert.equal(afterCard.order.status, OrderStatus.CARD_PROVISIONING);
    assert.equal(afterCard.card.provider_card_id, 'provider-card-fixture');

    await workflow.commitCardReady(fixture.orderId, {
      status: 'active', last4: '4242', currentBalance: '25.000000', currency: 'USD'
    }, {
      cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
    });
    const readyCard = await workflow.loadOrderContext(fixture.orderId);
    assert.equal(readyCard.order.status, OrderStatus.CARD_READY);
    assert.equal(readyCard.card.credentials.cardNumber, '4242424242424242');

    const firstTransaction = {
      id: 'provider-txn-1', type: 'CARD_RECHARGE', status: 'success', amount: '16', currency: 'USD',
      fee: '0', tradeTime: '2026-08-18 21:02:08', relatedTxnId: null,
      settlementStatus: 'settled', originalAmount: '982.14', originalCurrency: 'PHP',
      rawHash: crypto.createHash('sha256').update('first').digest('hex')
    };
    await workflow.commitCardTransactions(fixture.orderId, [firstTransaction], {
      currentBalance: '0.03', currency: 'USD'
    });
    await workflow.commitCardTransactions(fixture.orderId, [{
      ...firstTransaction,
      status: 'completed',
      rawHash: crypto.createHash('sha256').update('second').digest('hex')
    }]);
    const [transactions] = await pool.query(
      `SELECT provider_transaction_id, transaction_type, status, amount, currency,
              fee, trade_time_raw, related_txn_id, settlement_status,
              original_amount, original_currency
       FROM card_transactions WHERE card_id = ?`,
      [readyCard.card.id]
    );
    assert.deepEqual(transactions.filter((row) => row.provider_transaction_id === 'provider-txn-1'), [{
      provider_transaction_id: 'provider-txn-1', transaction_type: 'CARD_RECHARGE',
      status: 'completed', amount: '16.000000', currency: 'USD', fee: '0.000000',
      trade_time_raw: '2026-08-18 21:02:08', related_txn_id: null,
      settlement_status: 'settled', original_amount: '982.140000', original_currency: 'PHP'
    }]);
    const [[syncedCard]] = await pool.query(
      'SELECT current_balance, currency, last_synced_at FROM cards WHERE id = ?', [readyCard.card.id]
    );
    assert.equal(syncedCard.current_balance, '0.030000');
    assert.equal(syncedCard.currency, 'USD');
    assert.ok(syncedCard.last_synced_at instanceof Date);

    await workflow.commitCardTransactions(fixture.orderId, [{
      id: 'provider-purchase-for-refund', type: 'PURCHASE', status: 'success',
      amount: '-15.97', currency: 'USD', classification: 'UNKNOWN',
      rawHash: crypto.createHash('sha256').update('purchase-for-refund').digest('hex')
    }, {
      id: 'provider-refund-processing', type: 'REFUND', status: 'processing',
      amount: '15.97', currency: 'USD', relatedTxnId: 'provider-purchase-for-refund',
      classification: 'REFUND_CANDIDATE',
      rawHash: crypto.createHash('sha256').update('refund-processing').digest('hex')
    }]);
    const [[beforeConfirmedCandidate]] = await pool.query(
      'SELECT COUNT(*) AS count FROM refund_cases WHERE order_id = ?', [fixture.orderId]
    );
    assert.equal(beforeConfirmedCandidate.count, 0);
    await workflow.commitCardTransactions(fixture.orderId, [{
      id: 'provider-refund-success', type: 'REFUND', status: 'success',
      amount: '15.97', currency: 'USD', relatedTxnId: 'provider-purchase-for-refund',
      classification: 'REFUND_CANDIDATE',
      rawHash: crypto.createHash('sha256').update('refund-success').digest('hex')
    }]);
    const [[refundCandidate]] = await pool.query(
      `SELECT r.status, original.provider_transaction_id AS original_id,
              refund.provider_transaction_id AS refund_id
       FROM refund_cases r
       LEFT JOIN card_transactions original ON original.id = r.original_transaction_id
       LEFT JOIN card_transactions refund ON refund.id = r.refund_transaction_id
       WHERE r.order_id = ?`, [fixture.orderId]
    );
    assert.deepEqual(refundCandidate, {
      status: 'REFUND_DETECTED',
      original_id: 'provider-purchase-for-refund',
      refund_id: 'provider-refund-success'
    });
    const [[alert]] = await pool.query(
      'SELECT alert_type, status, message FROM operator_alerts WHERE order_id = ?', [fixture.orderId]
    );
    assert.equal(alert.alert_type, 'REFUND_CANDIDATE');
    assert.equal(alert.status, 'OPEN');
    assert.match(alert.message, /疑似退款/);

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
      { task_type: 'VERIFY_CARD', status: 'PENDING' },
      { task_type: 'PREPARE_RECHARGE', status: 'PENDING' },
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
         WHEN 'default_minimum_required_card_balance' THEN '16'
         ELSE setting_value END
       WHERE setting_key IN (
         'default_card_type_id', 'default_open_card_amount',
         'default_minimum_required_card_balance'
       )`
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
              open_card_amount, minimum_required_card_balance, session_ciphertext
       FROM orders WHERE id = ?`,
      [created.orderId]
    );
    assert.equal(order.status, OrderStatus.CREATED);
    assert.equal(order.customer_email, 'fixture@example.com');
    assert.equal(order.chatgpt_account_id, 'account-fixture');
    assert.equal(order.card_type_id, '7');
    assert.equal(order.open_card_amount, '25.000000');
    assert.equal(order.minimum_required_card_balance, '16.000000');
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
    assert.deepEqual(tasks, [{ task_type: 'ASSIGN_CARD', status: 'PENDING' }]);
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
         'accept_new_orders', 'default_card_type_id', 'default_open_card_amount',
         'default_minimum_required_card_balance'
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

test('CDK batches store only hashes and report input and existing duplicates', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const batchNo = `TEST-CDK-${id()}`;
  const collisionBatchNo = `TEST-CDK-COLLISION-${id()}`;
  const codes = ['PJ-ABCDEFGH', 'PJ-abcdefgh', 'PJ-ABCDEFGH'];
  try {
    const first = await storeCdkBatch(pool, codes, { batchNo });
    assert.deepEqual(first, {
      batchNo,
      planType: 'plus',
      inputCount: 3,
      duplicateInputCount: 1,
      insertedCount: 2,
      duplicateExistingCount: 0
    });
    const second = await storeCdkBatch(pool, codes, { batchNo });
    assert.deepEqual(second, {
      batchNo,
      planType: 'plus',
      inputCount: 3,
      duplicateInputCount: 1,
      insertedCount: 0,
      duplicateExistingCount: 2
    });
    await assert.rejects(
      storeCdkBatch(pool, ['PJ-ABCDEFGH', 'PJ-NEWCODEX'], {
        batchNo: collisionBatchNo,
        requireAllInserted: true
      }),
      (error) => error.code === 'GENERATED_COLLISION'
    );
    const [[rolledBack]] = await pool.query(
      'SELECT COUNT(*) AS count FROM cdks WHERE batch_no = ?',
      [collisionBatchNo]
    );
    assert.equal(rolledBack.count, 0);

    const [rows] = await pool.query(
      `SELECT code_hash, status, batch_no FROM cdks
       WHERE batch_no = ? ORDER BY code_hash`,
      [batchNo]
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => row.status === 'AVAILABLE'), true);
    assert.equal(rows.every((row) => row.batch_no === batchNo), true);
    assert.deepEqual(
      rows.map((row) => row.code_hash).sort(),
      ['PJ-ABCDEFGH', 'PJ-abcdefgh']
        .map((code) => crypto.createHash('sha256').update(code).digest('hex'))
        .sort()
    );
  } finally {
    await pool.query('DELETE FROM cdks WHERE batch_no IN (?, ?)', [batchNo, collisionBatchNo]);
    await pool.end();
  }
});

test('admin CDK generation is idempotent, recoverable, listable and revocable', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const requestKey = `test-cdk-request-${id()}`;
  const createBatch = createAdminCdkService({
    pool,
    sessionEncryptionKey: integrationSessionKey
  });
  let batchNo;
  try {
    const concurrent = await Promise.all([
      createBatch({ count: 3, requestKey }),
      createBatch({ count: 3, requestKey })
    ]);
    const created = concurrent.find((result) => !result.replayed);
    batchNo = created.batchNo;
    assert.equal(concurrent.filter((result) => !result.replayed).length, 1);
    assert.deepEqual(concurrent[0].codes, concurrent[1].codes);
    assert.equal(created.codes.length, 3);

    const [[storedBatch]] = await pool.query(
      'SELECT codes_ciphertext FROM cdk_batches WHERE batch_no = ?', [batchNo]
    );
    assert.equal(Buffer.isBuffer(storedBatch.codes_ciphertext), true);
    assert.equal(storedBatch.codes_ciphertext.includes(Buffer.from(created.codes[0])), false);

    const replayed = await createBatch({ count: 3, requestKey });
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.codes, created.codes);
    await assert.rejects(
      createBatch({ count: 2, requestKey }),
      (error) => error.code === 'IDEMPOTENCY_MISMATCH'
    );

    const downloaded = await downloadCdkBatch(pool, batchNo, integrationSessionKey);
    assert.deepEqual(downloaded.codes, created.codes);
    const listed = await listCdkBatches(pool, { limit: 100 });
    assert.equal(listed.batches.find((batch) => batch.batchNo === batchNo)?.availableCount, 3);
    assert.equal(listed.batches.find((batch) => batch.batchNo === batchNo)?.downloadable, true);

    assert.deepEqual(await revokeCdkBatch(pool, batchNo, 'integration test'), {
      batchNo, revokedCount: 3
    });
    const afterRevoke = await listCdkBatches(pool, { limit: 100 });
    assert.equal(afterRevoke.batches.find((batch) => batch.batchNo === batchNo)?.revokedCount, 3);
  } finally {
    if (batchNo) {
      await pool.query('DELETE FROM cdks WHERE batch_no = ?', [batchNo]);
      await pool.query('DELETE FROM cdk_batches WHERE batch_no = ?', [batchNo]);
    }
    await pool.end();
  }
});

test('customer status lookup recovers the same order by public number or CDK', {
  skip: !databaseUrl
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const publicNo = 'PJV1-ABCDEFGHIJKLMNOPQRST';
  const fixture = await createOrder(pool, { publicNo });
  const queryStatus = createOrderStatusService({ pool });
  try {
    const byPublicNo = await queryStatus({ publicNo });
    const byCdk = await queryStatus({ cdk: fixture.cdkId });
    assert.equal(byPublicNo.status, 'QUEUED');
    assert.deepEqual(byCdk, byPublicNo);

    await transitionOrder(pool, {
      orderId: fixture.orderId,
      toStatus: OrderStatus.CARD_PURCHASING,
      actorType: 'TEST',
      reason: 'verify customer processing mapping'
    });
    assert.equal((await queryStatus({ publicNo })).status, 'PROCESSING');
    await assert.rejects(
      queryStatus({ publicNo: publicNo.toLowerCase() }),
      (error) => error.code === 'INVALID_ORDER_QUERY' || error.code === 'ORDER_NOT_FOUND'
    );
  } finally {
    await removeOrder(pool, fixture);
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
    cardTypes: async () => ({
      data: { purchaseEnabled: true, cardTypes: [{ id: 7, cardType: 'Z-TEST' }] }
    }),
    cards: async ({ page = 1, pageSize = 50 } = {}) => ({
      data: { cards: [], total: 0, page, pageSize }
    }),
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
    queryStatus: async () => ({ status: 'success', isSubscriptionCancelled: 0 }),
    queryStatusWithSession: async () => {
      const recheck = providerActions.includes('poll-recharge');
      providerActions.push(recheck ? 'recheck-cancellation' : 'poll-recharge');
      return {
        status: 'success', isSubscriptionCancelled: recheck ? 1 : 0,
        latestSession: { accessToken: recheck ? 'latest-token-2' : 'latest-token-1', account: { id: 'acct-1' } }
      };
    }
  };
  const handlers = createWorkflowHandlers({
    workflow,
    cardProvider,
    rechargeProvider,
    recordCall: (input) => recordProviderCall({ pool, ...input }),
    mapPurchasedCard: () => 'fake-card-e2e',
    mapCardProvisioning: () => ({
      state: 'ready', status: 'active', currentBalance: 25, currency: 'USD', last4: '4242'
    }),
    mapCardCredentials: () => ({
      cardNumber: '4242424242424242',
      expMonth: 12,
      expYear: 2032,
      cvv: '123'
    }),
    buildDirectOrderRequest: (input) => ({
      method: 'POST',
      path: '/third-party/orders/direct',
      body: { ...input, planType: input.planType || 'plus' }
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
    assert.equal((await iteration()).status, 'COMPLETED');
    await pool.query(
      `UPDATE orders SET session_ciphertext = ? WHERE id = ?`,
      [encryptSecret(JSON.stringify(sessionFixture()), integrationSessionKey), fixture.orderId]
    );
    await pool.query(
      `UPDATE cards SET last_synced_at = CURRENT_TIMESTAMP(3) WHERE order_id = ?`,
      [fixture.orderId]
    );
    await armRechargePermit(pool, {
      publicNo: `TEST-${fixture.orderId}`,
      sessionEncryptionKey: integrationSessionKey
    });
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
    await pool.query(
      `UPDATE tasks SET available_at = CURRENT_TIMESTAMP(3)
       WHERE order_id = ? AND task_type = 'RECHECK_CANCELLATION'`,
      [fixture.orderId]
    );
    assert.equal((await iteration({ providerWritesEnabled: false })).status, 'COMPLETED');

    const [[order]] = await pool.query(
      `SELECT status, recharge_order_no, recharge_card_key, subscription_cancelled,
              cancellation_review_required
       FROM orders WHERE id = ?`,
      [fixture.orderId]
    );
    assert.deepEqual(order, {
      status: OrderStatus.RECHARGE_SUCCESS,
      recharge_order_no: 'fake-order-e2e',
      recharge_card_key: 'DIRECT-fake-e2e',
      subscription_cancelled: 1,
      cancellation_review_required: 0
    });
    assert.equal((await workflow.loadOrderContext(fixture.orderId)).session.accessToken, 'latest-token-2');
    const [tasks] = await pool.query(
      'SELECT task_type, status FROM tasks WHERE order_id = ? ORDER BY id',
      [fixture.orderId]
    );
    assert.deepEqual(tasks, [
      { task_type: 'PURCHASE_CARD', status: 'COMPLETED' },
      { task_type: 'VERIFY_CARD', status: 'COMPLETED' },
      { task_type: 'PREPARE_RECHARGE', status: 'COMPLETED' },
      { task_type: 'SUBMIT_RECHARGE', status: 'COMPLETED' },
      { task_type: 'POLL_RECHARGE', status: 'COMPLETED' },
      { task_type: 'RECHECK_CANCELLATION', status: 'COMPLETED' }
    ]);
    assert.deepEqual(providerActions, [
      'purchase',
      'card-details',
      'create-recharge',
      'poll-recharge',
      'recheck-cancellation'
    ]);
    const [[permit]] = await pool.query(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.rechargePermit.status')) AS status
       FROM tasks WHERE order_id = ? AND task_type = 'SUBMIT_RECHARGE'`,
      [fixture.orderId]
    );
    assert.equal(permit.status, 'CONSUMED');
    const [[createCalls]] = await pool.query(
      `SELECT COUNT(*) AS count FROM provider_calls
       WHERE order_id = ? AND provider = 'zzshu' AND operation = 'create_direct'`,
      [fixture.orderId]
    );
    assert.equal(createCalls.count, 1);
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
