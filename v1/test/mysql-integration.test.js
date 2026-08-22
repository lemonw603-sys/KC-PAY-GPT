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
  inspectCdkBatch,
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
import { createOrderCompensationService } from '../src/services/order-compensation-service.js';
import { createOrderCancellationService } from '../src/services/order-cancellation-service.js';
import {
  claimCardSyncJob,
  completeCardSyncJob,
  createCardSyncJobService,
  scheduleDueCardSyncJobs
} from '../src/services/card-sync-job-service.js';
import { commitCardTransactionsForCard } from '../src/db/repositories/card-transaction-repository.js';
import { createAdminReadService } from '../src/services/admin-read-service.js';
import { createRechargeAuthorization } from '../src/services/recharge-authorization-v2-service.js';
import { createRechargeAttemptRepository } from '../src/db/repositories/recharge-attempt-repository.js';
import { createProviderBalanceSnapshotService } from '../src/services/provider-balance-snapshot-service.js';
import { createReconciliationCaseService } from '../src/services/reconciliation-case-service.js';
import { createOperationsCsvExportService } from '../src/services/operations-csv-export-service.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';
import { createCardStockService, mapStockCard } from '../src/services/card-stock-service.js';
import { createCardFundingRepository } from '../src/db/repositories/card-funding-repository.js';
import { createCardReplenishmentSettingsService } from '../src/services/card-replenishment-settings-service.js';
import { createCardFundingScheduler } from '../src/services/card-funding-scheduler.js';
import { createTraceabilityOperationsService } from '../src/services/traceability-operations-service.js';
import { createSessionReplacementService } from '../src/services/session-replacement-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationSessionKey = Buffer.alloc(32, 7);
const integrationCdkHashKey = Buffer.alloc(32, 8);
const integrationCdkRecoveryKey = Buffer.alloc(32, 9);
const legacyCardProviderAccountId = '00000000-0000-4000-8000-000000000101';
const legacyProductId = '00000000-0000-4000-8000-000000000201';
const legacyRouteId = '00000000-0000-4000-8000-000000000301';

async function setDispatchSettings(pool, { enabled, mode }) {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('dispatch_new_recharges', 'recharge_dispatch_mode')`
  );
  const previous = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  await pool.query(
    `UPDATE app_settings SET setting_value = CASE setting_key
       WHEN 'dispatch_new_recharges' THEN ?
       WHEN 'recharge_dispatch_mode' THEN ?
       ELSE setting_value END
     WHERE setting_key IN ('dispatch_new_recharges', 'recharge_dispatch_mode')`,
    [String(enabled), mode]
  );
  return async () => {
    await pool.query(
      `UPDATE app_settings SET setting_value = CASE setting_key
         WHEN 'dispatch_new_recharges' THEN ?
         WHEN 'recharge_dispatch_mode' THEN ?
         ELSE setting_value END
       WHERE setting_key IN ('dispatch_new_recharges', 'recharge_dispatch_mode')`,
      [previous.dispatch_new_recharges, previous.recharge_dispatch_mode]
    );
  };
}

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
      session_ciphertext, card_purchase_idempotency_key, product_id,
      fulfillment_route_id, route_resolution_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESOLVED')`,
    [
      orderId,
      overrides.publicNo || `TEST-${orderId}`,
      cdkId,
      overrides.status || OrderStatus.CREATED,
      '7',
      '25.000000',
      '16.000000',
      encryptSecret(JSON.stringify({ accessToken: 'fixture-token', account: { id: 'acct-1' } }), integrationSessionKey),
      overrides.purchaseKey || `purchase-${orderId}`,
      legacyProductId,
      legacyRouteId
    ]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  return { cdkId, orderId };
}

async function removeOrder(pool, { cdkId, orderId }) {
  const [compensations] = await pool.query(
    `SELECT oc.replacement_cdk_id, c.batch_no FROM order_compensations oc
     INNER JOIN cdks c ON c.id = oc.replacement_cdk_id WHERE oc.original_order_id = ?`, [orderId]
  );
  await pool.query('DELETE FROM order_compensations WHERE original_order_id = ?', [orderId]);
  for (const compensation of compensations) {
    await pool.query('DELETE FROM cdks WHERE id = ?', [compensation.replacement_cdk_id]);
    await pool.query('DELETE FROM cdk_batches WHERE batch_no = ?', [compensation.batch_no]);
  }
  await pool.query('DELETE FROM tasks WHERE order_id = ?', [orderId]);
  await pool.query(
    `DELETE n FROM alert_notifications n
     INNER JOIN operator_alerts a ON a.id = n.alert_id WHERE a.order_id = ?`,
    [orderId]
  );
  await pool.query('DELETE FROM operator_alerts WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM reconciliation_cases WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM order_session_replacements WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM provider_calls WHERE order_id = ?', [orderId]);
  const [authorizationRows] = await pool.query(
    'SELECT DISTINCT authorization_id FROM recharge_authorization_items WHERE order_id = ?',
    [orderId]
  );
  await pool.query(
    'UPDATE recharge_authorization_items SET consumed_attempt_id = NULL WHERE order_id = ?',
    [orderId]
  );
  await pool.query('DELETE FROM recharge_attempts WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM recharge_authorization_items WHERE order_id = ?', [orderId]);
  for (const authorization of authorizationRows) {
    await pool.query('DELETE FROM recharge_authorizations WHERE id = ?', [authorization.authorization_id]);
  }
  await pool.query('DELETE FROM refund_cases WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM order_notes WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM order_tags WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM customer_payments WHERE order_id = ? OR cdk_id = ?', [orderId, cdkId]);
  await pool.query('DELETE FROM card_assignment_history WHERE order_id = ?', [orderId]);
  const [cards] = await pool.query('SELECT id FROM cards WHERE order_id = ?', [orderId]);
  for (const card of cards) {
    await pool.query('DELETE FROM card_sync_jobs WHERE card_id = ?', [card.id]);
    await pool.query('DELETE FROM card_state_events WHERE card_id = ?', [card.id]);
    await pool.query('DELETE FROM card_transactions WHERE card_id = ?', [card.id]);
  }
  await pool.query('DELETE FROM cards WHERE order_id = ?', [orderId]);
  await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
  await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
}

test('Bark notification claims are concurrency-safe and reopen after resolution', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const alertId = id();
  const dedupeKey = `bark-integration-${alertId}`;
  try {
    await pool.query(
      `INSERT INTO operator_alerts
       (id, alert_type, dedupe_key, severity, title, message, status)
       VALUES (?, 'BARK_TEST', ?, 'warning', 'Bark 集成测试', '不含资金操作', 'OPEN')`,
      [alertId, dedupeKey]
    );
    const repository = createAlertNotificationRepository(pool);
    await repository.enqueueOpenAlerts();
    const claimed = await Promise.all([repository.claimNext(), repository.claimNext()]);
    assert.equal(claimed.filter(Boolean).length, 1);
    await repository.markSent(claimed.find(Boolean).id);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await pool.query('UPDATE operator_alerts SET status = \'RESOLVED\' WHERE id = ?', [alertId]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await pool.query('UPDATE operator_alerts SET status = \'OPEN\' WHERE id = ?', [alertId]);
    await repository.enqueueOpenAlerts();
    const reopened = await repository.claimNext();
    assert.ok(reopened);
    const retry = await repository.markFailed(reopened.id, {
      error: new Error('temporary Bark test failure'),
      retryable: true,
      attemptCount: reopened.attemptCount,
      maxAttempts: 8
    });
    assert.equal(retry.exhausted, false);
    const [[retryRow]] = await pool.query(
      'SELECT status, next_attempt_at FROM alert_notifications WHERE id = ?',
      [reopened.id]
    );
    assert.equal(retryRow.status, 'RETRY');
    assert.ok(retryRow.next_attempt_at);
  } finally {
    await pool.query('DELETE FROM alert_notifications WHERE alert_id = ?', [alertId]);
    await pool.query('DELETE FROM operator_alerts WHERE id = ?', [alertId]);
    await pool.end();
  }
});

test('inventory-only card sync is durable and persists transactions without an order', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const cardId = id();
  const providerCardId = `sync-card-${cardId}`;
  try {
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
        funded_amount, current_balance, currency, refund_status)
       VALUES (?, NULL, 'AVAILABLE', ?, '7', '4242', 'active',
         '16.000000', '16.000000', 'USD', 'MONITORING')`,
      [cardId, providerCardId]
    );
    const queued = await createCardSyncJobService({ pool }).createJobs({ providerCardId });
    assert.deepEqual(queued, { requested: 1, queued: 1, alreadyActive: 0 });
    const job = await claimCardSyncJob(pool, { workerId: 'mysql-card-sync-test' });
    assert.equal(job.card_id, cardId);
    await commitCardTransactionsForCard(pool, {
      cardId,
      transactions: [{
        id: 'provider-txn-1', type: 'CARD_RECHARGE', status: 'success',
        amount: '16', currency: 'USD', classification: 'NOT_REFUND', rawHash: 'a'.repeat(64)
      }],
      cardSnapshot: { currentBalance: '16', currency: 'USD' }
    });
    await completeCardSyncJob(pool, { jobId: job.id, workerId: 'mysql-card-sync-test' });
    const [[stored]] = await pool.query(
      `SELECT c.last_transaction_synced_at, COUNT(ct.id) AS transaction_count,
          MAX(csj.status) AS sync_status
       FROM cards c LEFT JOIN card_transactions ct ON ct.card_id = c.id
       LEFT JOIN card_sync_jobs csj ON csj.card_id = c.id
       WHERE c.id = ? GROUP BY c.id`, [cardId]
    );
    assert.ok(stored.last_transaction_synced_at);
    assert.equal(Number(stored.transaction_count), 1);
    assert.equal(stored.sync_status, 'COMPLETED');
  } finally {
    await pool.query('DELETE FROM card_sync_jobs WHERE card_id = ?', [cardId]);
    await pool.query('DELETE FROM card_state_events WHERE card_id = ?', [cardId]);
    await pool.query('DELETE FROM card_transactions WHERE card_id = ?', [cardId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.end();
  }
});

test('assigned cards are periodically queued for transaction and refund observation', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const fixture = await createOrder(pool);
  const cardId = id();
  try {
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        provider_account_id, external_card_id, intake_status, sync_tier)
       VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING',
         ?, ?, 'ACCEPTED', 'ASSIGNED')`,
      [cardId, fixture.orderId, `scheduled-card-${cardId}`,
        legacyCardProviderAccountId, `scheduled-card-${cardId}`]
    );
    const now = new Date('2026-08-20T10:00:00.000Z');
    assert.deepEqual(await scheduleDueCardSyncJobs(pool, { now }), {
      enabled: true, queued: 1
    });
    assert.deepEqual(await scheduleDueCardSyncJobs(pool, { now }), {
      enabled: true, queued: 0
    });
    const claimed = await claimCardSyncJob(pool, {
      workerId: 'scheduled-card-sync-idempotency-test'
    });
    assert.equal(claimed.card_id, cardId);
    await completeCardSyncJob(pool, {
      jobId: claimed.id,
      workerId: 'scheduled-card-sync-idempotency-test'
    });
    assert.deepEqual(await scheduleDueCardSyncJobs(pool, { now }), {
      enabled: true, queued: 0
    });
    const [[job]] = await pool.query(
      'SELECT status, requested_by FROM card_sync_jobs WHERE card_id = ?', [cardId]
    );
    assert.deepEqual(job, { status: 'COMPLETED', requested_by: 'scheduler' });
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('three-way reconciliation queries run on MySQL and ignore a cancelled pre-submission order', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool, {
    publicNo: `PJV1-RECON-${Date.now()}`, status: OrderStatus.CLOSED
  });
  try {
    await pool.query(
      `UPDATE orders SET failure_code = 'CANCELLED_PRE_SUBMISSION',
         finished_at = CURRENT_TIMESTAMP(3) WHERE id = ?`, [fixture.orderId]
    );
    const service = createAdminReadService({ pool, sessionEncryptionKey: integrationSessionKey });
    const overview = await service.getOverview();
    assert.equal(overview.metrics.reconciliationIssues, 0);
    const all = await service.listOrders({ q: `PJV1-RECON-`, pageSize: 10 });
    assert.equal(all.orders.length, 1);
    assert.equal(all.orders[0].reconciliation.status, 'NOT_SUBMITTED');
    const issues = await service.listOrders({
      q: `PJV1-RECON-`, status: 'RECONCILIATION_ISSUES', pageSize: 10
    });
    assert.equal(issues.total, 0);
    const detail = await service.getOrder(all.orders[0].publicNo);
    assert.deepEqual(detail.reconciliation, {
      status: 'NOT_SUBMITTED', code: 'RECHARGE_NOT_SUBMITTED', issue: false
    });
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('order compensation is one-time and recoverable after a verified no-side-effect failure', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool, { publicNo: `PJV1-COMP-${Date.now()}` });
  const service = createOrderCompensationService({
    pool,
    cdkHashKey: integrationCdkHashKey,
    cdkRecoveryKey: integrationCdkRecoveryKey
  });
  try {
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'ASSIGN_CARD', 'DEAD', ?, 1)`,
      [fixture.orderId, `comp-dead-${fixture.orderId}`]
    );
    const [[order]] = await pool.query('SELECT public_no FROM orders WHERE id = ?', [fixture.orderId]);
    const input = { confirmation: `补发 ${order.public_no}` };
    const first = await service(order.public_no, input);
    const second = await service(order.public_no, input);
    assert.equal(second.code, first.code);
    assert.equal(second.replayed, true);
    const [[stored]] = await pool.query(
      `SELECT o.status, COUNT(oc.id) AS compensation_count,
              SUM(c.status = 'AVAILABLE') AS available_replacements
       FROM orders o LEFT JOIN order_compensations oc ON oc.original_order_id = o.id
       LEFT JOIN cdks c ON c.id = oc.replacement_cdk_id
       WHERE o.id = ? GROUP BY o.id`, [fixture.orderId]
    );
    assert.deepEqual({ status: stored.status,
      compensationCount: Number(stored.compensation_count),
      availableReplacements: Number(stored.available_replacements) },
    { status: 'CLOSED', compensationCount: 1, availableReplacements: 1 });
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('pre-submission cancellation closes the order and returns its funded card to inventory', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool, {
    publicNo: `PJV1-CANCEL-${Date.now()}`, status: OrderStatus.CARD_READY
  });
  const cardId = id();
  try {
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, assigned_at, provider_card_id, card_type_id,
        last4, status, funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, last_synced_at)
       VALUES (?, ?, 'ASSIGNED', CURRENT_TIMESTAMP(3), ?, '1', '4242', 'active',
        '16.000000', '16.000000', 'USD', 'MONITORING', ?, CURRENT_TIMESTAMP(3))`,
      [cardId, fixture.orderId, `cancel-card-${cardId}`, encryptSecret(JSON.stringify({
        cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
      }), integrationSessionKey)]
    );
    await pool.query(
      `INSERT INTO card_assignment_history
       (id, card_id, order_id, assignment_kind, status, assigned_by, assignment_reason)
       VALUES (?, ?, ?, 'NORMAL', 'ACTIVE', 'integration-test', 'cancellation fixture')`,
      [id(), cardId, fixture.orderId]
    );
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)`,
      [fixture.orderId, `cancel-submit-${fixture.orderId}`]
    );
    const [[order]] = await pool.query('SELECT public_no FROM orders WHERE id = ?', [fixture.orderId]);
    const service = createOrderCancellationService({ pool });
    const result = await service(order.public_no, { confirmation: `取消订单 ${order.public_no}` });
    assert.equal(result.cardReleased, true);
    assert.equal(result.cardInventoryStatus, 'HELD_FOR_REVIEW');
    const [[stored]] = await pool.query(
      `SELECT o.status, o.failure_code, c.order_id, c.inventory_status, t.status AS task_status
       FROM orders o INNER JOIN cards c ON c.id = ?
       INNER JOIN tasks t ON t.order_id = o.id AND t.task_type = 'SUBMIT_RECHARGE'
       WHERE o.id = ?`, [cardId, fixture.orderId]
    );
    assert.deepEqual(stored, {
      status: 'CLOSED', failure_code: 'CANCELLED_PRE_SUBMISSION', order_id: null,
      inventory_status: 'HELD_FOR_REVIEW', task_status: 'DEAD'
    });
  } finally {
    await pool.query('DELETE FROM card_assignment_history WHERE card_id = ?', [cardId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('MySQL enforces one CDK per order and records transitions atomically', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const first = await createOrder(pool);
  const second = await createOrder(pool);
  const stockCardId = id();
  await pool.query(
    `INSERT INTO cards
     (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
      funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
      provider_account_id, external_card_id, intake_status, sync_tier, last_transaction_synced_at)
     VALUES (?, NULL, 'AVAILABLE', 'stock-provider-1', '7', '4242', 'active',
       '16.000000', '16.000000', 'USD', 'MONITORING', ?, ?,
       'stock-provider-1', 'ACCEPTED', 'AVAILABLE', CURRENT_TIMESTAMP(3))`,
    [stockCardId, encryptSecret(JSON.stringify({
      cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
    }), integrationSessionKey), legacyCardProviderAccountId]
  );
  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: integrationSessionKey });
  try {
    const results = await Promise.all([
      workflow.assignAvailableCard(first.orderId),
      workflow.assignAvailableCard(second.orderId)
    ]);
    assert.equal(results.filter((result) => result?.providerCardId).length, 1);
    assert.equal(results.filter((result) => result?.waitingForCard).length, 1);
    const [orders] = await pool.query(
      `SELECT id, status FROM orders WHERE id IN (?, ?) ORDER BY id`,
      [first.orderId, second.orderId]
    );
    assert.deepEqual(orders.map((row) => row.status).sort(),
      [OrderStatus.CARD_READY, OrderStatus.WAITING_FOR_CARD].sort());
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

test('a card registered by the stock service is provider-scoped, accepted, and assignable', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const fixture = await createOrder(pool);
  const providerCardId = `registered-${id()}`;
  const stock = createCardStockService({
    pool, sessionEncryptionKey: integrationSessionKey, panHmacKey: Buffer.alloc(32, 22)
  });
  try {
    const card = mapStockCard({ data: {
      id: providerCardId, cardTypeId: '7', status: 'active', cardBalance: '16.00',
      currency: 'USD', cardNumber: '4242424242424242', cvv: '123',
      expiryMonth: 12, expiryYear: 2032
    } }, { minimumRequiredBalance: '16' });
    const registered = await stock.register(card);
    assert.equal(registered.inventoryStatus, 'AVAILABLE');
    const [[stored]] = await pool.query(
      `SELECT provider_account_id, external_card_id, intake_status, pan_hmac_version
       FROM cards WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ?`,
      [legacyCardProviderAccountId, providerCardId]
    );
    assert.deepEqual(stored, {
      provider_account_id: legacyCardProviderAccountId,
      external_card_id: providerCardId,
      intake_status: 'ACCEPTED',
      pan_hmac_version: 1
    });
    // 新入库卡只有在交易流水完成一次新鲜只读同步后，才进入可分配集合。
    await pool.query(
      `UPDATE cards
       SET last_transaction_synced_at = CURRENT_TIMESTAMP(3)
       WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ?`,
      [legacyCardProviderAccountId, providerCardId]
    );
    const assigned = await createWorkflowRepository(pool, {
      sessionEncryptionKey: integrationSessionKey, panHmacKey: Buffer.alloc(32, 22)
    }).assignAvailableCard(fixture.orderId);
    assert.equal(assigned.providerCardId, providerCardId);
  } finally {
    await pool.query('DELETE FROM operator_alerts WHERE dedupe_key = ?', [
      `card-stock-low:${legacyCardProviderAccountId}:7`
    ]);
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('card funding ledger fences duplicate balance writes and preserves unknown outcome', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const cardId = id();
  const providerCardId = `funding-${id()}`;
  const repo = createCardFundingRepository(pool);
  const key = `funding-key-${id()}`;
  try {
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
        funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
        provider_account_id, external_card_id, intake_status, sync_tier, last_transaction_synced_at)
       VALUES (?, NULL, 'AVAILABLE', ?, '7', '4242', 'active', '16.000000', '4.000000',
        'USD', 'MONITORING', ?, ?, ?, 'ACCEPTED', 'AVAILABLE', CURRENT_TIMESTAMP(3))`,
      [cardId, providerCardId, encryptSecret(JSON.stringify({ cardNumber: '4242424242424242',
        expMonth: 12, expYear: 2032, cvv: '123' }), integrationSessionKey),
        legacyCardProviderAccountId, providerCardId]
    );
    const first = await repo.prepare({ cardId, amount: '12', providerAccountId: legacyCardProviderAccountId, idempotencyKey: key,
      currency: 'USD' });
    const second = await repo.prepare({ cardId, amount: '12', providerAccountId: legacyCardProviderAccountId, idempotencyKey: key,
      currency: 'USD' });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    const begun = await repo.begin({ attemptId: first.attempt.id, provider: 'hnskj',
      providerAccountId: legacyCardProviderAccountId, requestKey: `provider-${id()}` });
    await assert.rejects(
      repo.begin({ attemptId: first.attempt.id, provider: 'hnskj',
        providerAccountId: legacyCardProviderAccountId, requestKey: `provider-${id()}` }),
      (error) => error?.code === 'CARD_FUNDING_NOT_SUBMIT_READY'
    );
    await repo.finish({ attemptId: first.attempt.id, providerCallId: begun.providerCallId,
      outcome: 'UNCERTAIN', httpStatus: 504, businessCode: 'TIMEOUT',
      responseSummary: { outcome: 'unknown' }, status: 'MANUAL_REVIEW', fundsRiskState: 'UNKNOWN' });
    const [[attempt]] = await pool.query(
      `SELECT status, funds_risk_state FROM card_funding_attempts WHERE id=?`, [first.attempt.id]
    );
    assert.deepEqual(attempt, { status: 'MANUAL_REVIEW', funds_risk_state: 'UNKNOWN' });
    const [[call]] = await pool.query(
      `SELECT outcome, card_funding_attempt_id FROM provider_calls WHERE id=?`, [begun.providerCallId]
    );
    assert.deepEqual(call, { outcome: 'UNCERTAIN', card_funding_attempt_id: first.attempt.id });
  } finally {
    await pool.query('DELETE FROM provider_calls WHERE card_funding_attempt_id IN (SELECT id FROM card_funding_attempts WHERE card_id=?)', [cardId]);
    await pool.query('DELETE FROM card_funding_attempts WHERE card_id=?', [cardId]);
    await pool.query('DELETE FROM cards WHERE id=?', [cardId]);
    await pool.end();
  }
});

test('card stock jobs require confirmation and move durably through the runner states', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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
    await assert.rejects(
      service.createJob({ count: 1, amount: 16, cardTypeId: '1', confirmation: '开1张' }),
      (error) => error.code === 'CARD_STOCK_CARD_TYPE_UNAVAILABLE'
    );
    job = await service.createJob({
      count: 11, amount: 5, cardTypeId: '7', confirmation: '开11张', largeBatchConfirmed: true
    });
    assert.equal(job.cardTypeId, '7');
    await assert.rejects(
      service.createJob({ count: 1, amount: 16, cardTypeId: '7', confirmation: '开1张' }),
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

test('card funding scheduler creates one prepared attempt for a fresh low-balance card', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const scheduler = createCardFundingScheduler({ pool });
  const cardId = id();
  const providerCardId = `low-${id()}`;
  const [[originalSetting]] = await pool.query(
    `SELECT setting_value FROM app_settings WHERE setting_key='card_balance_recharge_enabled'`
  );
  const [[originalMinimum]] = await pool.query(
    `SELECT setting_value FROM app_settings WHERE setting_key='default_minimum_required_card_balance'`
  );
  try {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('card_balance_recharge_enabled','true')
       ON DUPLICATE KEY UPDATE setting_value='true'`
    );
    await pool.query(
      `UPDATE app_settings SET setting_value='16' WHERE setting_key='default_minimum_required_card_balance'`
    );
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
        funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
        provider_account_id, external_card_id, intake_status, sync_tier, last_transaction_synced_at)
       VALUES (?, NULL, 'AVAILABLE', ?, '7', '4242', 'active', '16.000000', '4.000000',
        'USD', 'MONITORING', ?, ?, ?, 'ACCEPTED', 'AVAILABLE', CURRENT_TIMESTAMP(3))`,
      [cardId, providerCardId, encryptSecret(JSON.stringify({ cardNumber: '4242424242424242',
        expMonth: 12, expYear: 2032, cvv: '123' }), integrationSessionKey),
        legacyCardProviderAccountId, providerCardId]
    );
    const first = await scheduler.scheduleLowBalance({ limit: 10 });
    const second = await scheduler.scheduleLowBalance({ limit: 10 });
    assert.equal(first.scheduled, 1);
    assert.equal(second.scheduled, 0);
    const [[attempt]] = await pool.query(
      `SELECT status, funds_risk_state, amount, card_id FROM card_funding_attempts WHERE card_id=?`, [cardId]
    );
    assert.deepEqual(attempt, { status: 'PREPARED', funds_risk_state: 'NONE', amount: '12.000000', card_id: cardId });
  } finally {
    await pool.query('DELETE FROM card_funding_attempts WHERE card_id=?', [cardId]);
    await pool.query('DELETE FROM cards WHERE id=?', [cardId]);
    if (originalSetting) {
      await pool.query(`UPDATE app_settings SET setting_value=? WHERE setting_key='card_balance_recharge_enabled'`, [originalSetting.setting_value]);
    } else {
      await pool.query(`DELETE FROM app_settings WHERE setting_key='card_balance_recharge_enabled'`);
    }
    if (originalMinimum) {
      await pool.query(`UPDATE app_settings SET setting_value=? WHERE setting_key='default_minimum_required_card_balance'`, [originalMinimum.setting_value]);
    }
    await pool.end();
  }
});

test('replenishment daily limit is adjustable and audited with today usage', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const service = createCardReplenishmentSettingsService({ pool });
  const [[original]] = await pool.query(
    `SELECT setting_value FROM app_settings WHERE setting_key='card_replenishment_daily_limit'`
  );
  try {
    const before = await service.get();
    await service.setDailyLimit({ value: 9, actorId: 'integration-test', reason: 'test update' });
    const after = await service.get();
    assert.equal(after.dailyLimit, 9);
    assert.equal(after.usedToday >= 0, true);
    const [[event]] = await pool.query(
      `SELECT setting_key, old_value, new_value, actor_id, reason
       FROM admin_setting_events WHERE setting_key='card_replenishment_daily_limit'
       ORDER BY id DESC LIMIT 1`
    );
    assert.deepEqual(event, {
      setting_key: 'card_replenishment_daily_limit',
      old_value: String(before.dailyLimit), new_value: '9',
      actor_id: 'integration-test', reason: 'test update'
    });
  } finally {
    await pool.query(
      `UPDATE app_settings SET setting_value=? WHERE setting_key='card_replenishment_daily_limit'`,
      [original?.setting_value || '5']
    );
    await pool.query(
      `DELETE FROM admin_setting_events WHERE setting_key='card_replenishment_daily_limit' AND actor_id='integration-test'`
    );
    await pool.end();
  }
});

test('automatic replenishment reserves one card at a time and hard-stops at the daily limit', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const service = createCardStockJobService({ pool });
  const created = [];
  const keys = ['card_auto_replenishment_enabled', 'card_replenishment_daily_limit',
    'card_stock_low_threshold', 'default_card_type_id', 'default_open_card_amount',
    'default_minimum_required_card_balance'];
  const [originalRows] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const originals = new Map(originalRows.map((row) => [row.setting_key, row.setting_value]));
  try {
    const snapshot = {
      provider: 'hnskj', syncedAt: new Date().toISOString(), purchaseEnabled: true,
      accountBalance: '1000', currency: 'USD', exchangeRate: '1',
      cardLimit: { current: 0, maximum: 300, remaining: 300 },
      cardTypes: [{ id: '7', name: 'Z-TEST', country: 'US', binPrefix: '40041606',
        effectiveCardFee: '0.5', effectiveFeeRate: '0.005', minimumAmount: '5',
        maximumAmount: '200', minimumAccountBalance: '25',
        requireMinimumAccountBalance: true, consumeRate: '0', chargebackFee: '0.4' }]
    };
    await pool.query(
      `INSERT INTO card_provider_snapshots (provider, payload_json, synced_at)
       VALUES ('hnskj', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), synced_at=VALUES(synced_at)`,
      [JSON.stringify(snapshot)]
    );
    await pool.query(
      `INSERT INTO card_catalog_snapshots (provider, payload_json, synced_at)
       VALUES ('hnskj', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), synced_at=VALUES(synced_at)`,
      [JSON.stringify({ providerActive: 0, unresolvedActive: 0 })]
    );
    const values = {
      card_auto_replenishment_enabled: 'true', card_replenishment_daily_limit: '5',
      card_stock_low_threshold: '5', default_card_type_id: '7',
      default_open_card_amount: '16', default_minimum_required_card_balance: '16'
    };
    for (const [key, value] of Object.entries(values)) {
      await pool.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [key, value]
      );
    }
    const reviewJobId = id();
    await pool.query(
      `INSERT INTO card_stock_jobs
       (id, status, job_source, card_type_id, amount, requested_count, opened_count,
        error_code, error_message, finished_at)
       VALUES (?, 'REVIEW_REQUIRED', 'AUTOMATIC', '7', 16, 1, 0,
         'PROVIDER_TIMEOUT', 'uncertain purchase result', CURRENT_TIMESTAMP(3))`,
      [reviewJobId]
    );
    assert.deepEqual(await service.scheduleAutomaticJob(), {
      scheduled: false, reason: 'FUNDS_REVIEW_REQUIRED'
    });
    await pool.query('DELETE FROM card_stock_jobs WHERE id=?', [reviewJobId]);
    for (let index = 0; index < 5; index += 1) {
      const scheduled = await service.scheduleAutomaticJob();
      assert.equal(scheduled.scheduled, true);
      assert.equal(scheduled.requestedCount, 1);
      assert.equal(scheduled.usedAfter, index + 1);
      created.push(scheduled.id);
      await pool.query(
        `UPDATE card_stock_jobs SET status='COMPLETED', opened_count=1,
           finished_at=CURRENT_TIMESTAMP(3) WHERE id=?`, [scheduled.id]
      );
    }
    assert.deepEqual(await service.scheduleAutomaticJob(), {
      scheduled: false, reason: 'DAILY_LIMIT', used: 5, limit: 5
    });
    const [rows] = await pool.query(
      `SELECT job_source, requested_count, opened_count FROM card_stock_jobs
       WHERE id IN (${created.map(() => '?').join(',')})`, created
    );
    assert.equal(rows.length, 5);
    assert.equal(rows.every((row) => row.job_source === 'AUTOMATIC'
      && row.requested_count === 1 && row.opened_count === 1), true);
  } finally {
    if (created.length) {
      await pool.query(`DELETE FROM card_stock_jobs WHERE id IN (${created.map(() => '?').join(',')})`, created);
    }
    for (const key of keys) {
      if (originals.has(key)) {
        await pool.query('UPDATE app_settings SET setting_value=? WHERE setting_key=?', [originals.get(key), key]);
      } else {
        await pool.query('DELETE FROM app_settings WHERE setting_key=?', [key]);
      }
    }
    await pool.end();
  }
});

test('workflow repository commits card and recharge handoffs atomically', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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
    cdkHashKey: integrationCdkHashKey,
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
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const batchNo = `TEST-CDK-${id()}`;
  const collisionBatchNo = `TEST-CDK-COLLISION-${id()}`;
  const codes = ['PJ-ABCDEFGHJKMNPQRST234', 'PJ-23456789ABCDEFGHJKMN', 'PJ-ABCDEFGHJKMNPQRST234'];
  try {
    const first = await storeCdkBatch(pool, codes, { batchNo, cdkHashKey: integrationCdkHashKey });
    assert.deepEqual(first, {
      batchNo,
      planType: 'plus',
      inputCount: 3,
      duplicateInputCount: 1,
      insertedCount: 2,
      duplicateExistingCount: 0
    });
    const second = await storeCdkBatch(pool, codes, { batchNo, cdkHashKey: integrationCdkHashKey });
    assert.deepEqual(second, {
      batchNo,
      planType: 'plus',
      inputCount: 3,
      duplicateInputCount: 1,
      insertedCount: 0,
      duplicateExistingCount: 2
    });
    await assert.rejects(
      storeCdkBatch(pool, ['PJ-ABCDEFGHJKMNPQRST234', 'PJ-ZYXWVUTSRQ98765432AH'], {
        batchNo: collisionBatchNo,
        requireAllInserted: true,
        cdkHashKey: integrationCdkHashKey
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
      ['PJ-ABCDEFGHJKMNPQRST234', 'PJ-23456789ABCDEFGHJKMN']
        .map((code) => crypto.createHmac('sha256', integrationCdkHashKey).update(code).digest('hex'))
        .sort()
    );
  } finally {
    await pool.query('DELETE FROM cdks WHERE batch_no IN (?, ?)', [batchNo, collisionBatchNo]);
    await pool.end();
  }
});

test('admin CDK generation is idempotent, recoverable, listable and revocable', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const requestKey = `test-cdk-request-${id()}`;
  const createBatch = createAdminCdkService({
    pool,
    cdkHashKey: integrationCdkHashKey,
    cdkRecoveryKey: integrationCdkRecoveryKey
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
    const [[paymentTrace]] = await pool.query(
      `SELECT COUNT(*) AS count FROM customer_payments p
       INNER JOIN cdks c ON c.id = p.cdk_id WHERE BINARY c.batch_no = BINARY ?`,
      [batchNo]
    );
    assert.equal(Number(paymentTrace.count), 3);

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

    const downloaded = await downloadCdkBatch(pool, batchNo, integrationCdkRecoveryKey);
    assert.deepEqual(downloaded.codes, created.codes);
    const listed = await listCdkBatches(pool, { limit: 100 });
    assert.equal(listed.batches.find((batch) => batch.batchNo === batchNo)?.availableCount, 3);
    assert.equal(listed.batches.find((batch) => batch.batchNo === batchNo)?.downloadable, true);

    await assert.rejects(
      revokeCdkBatch(pool, batchNo.toLowerCase(), 'wrong-case batch'),
      (error) => error.code === 'BATCH_NOT_FOUND'
    );

    assert.deepEqual(await revokeCdkBatch(pool, batchNo, 'integration test'), {
      batchNo, revokedCount: 3
    });
    assert.deepEqual(await revokeCdkBatch(pool, batchNo, 'replayed integration test'), {
      batchNo, revokedCount: 0
    });
    const afterRevoke = await listCdkBatches(pool, { limit: 100 });
    assert.equal(afterRevoke.batches.find((batch) => batch.batchNo === batchNo)?.revokedCount, 3);
    assert.equal(afterRevoke.batches.find((batch) => batch.batchNo === batchNo)?.downloadable, true);
    const [[retainedBatch]] = await pool.query(
      'SELECT codes_ciphertext FROM cdk_batches WHERE batch_no = ?', [batchNo]
    );
    assert.equal(Buffer.isBuffer(retainedBatch.codes_ciphertext), true);
    const statusReport = await inspectCdkBatch(
      pool, batchNo, integrationCdkHashKey, integrationCdkRecoveryKey
    );
    assert.deepEqual(statusReport.codes.map((item) => item.code), created.codes);
    assert.equal(statusReport.codes.every((item) => item.status === 'REVOKED'), true);
    assert.equal(statusReport.codes.every((item) => item.revokedAt), true);
    assert.equal(statusReport.codes.every((item) => item.revokeReason === 'integration test'), true);
  } finally {
    if (batchNo) {
      await pool.query('DELETE FROM cdk_admin_events WHERE batch_no = ?', [batchNo]);
      await pool.query(
        `DELETE p FROM customer_payments p INNER JOIN cdks c ON c.id = p.cdk_id
         WHERE BINARY c.batch_no = BINARY ?`, [batchNo]
      );
      await pool.query('DELETE FROM cdks WHERE batch_no = ?', [batchNo]);
      await pool.query('DELETE FROM cdk_batches WHERE batch_no = ?', [batchNo]);
    }
    await pool.end();
  }
});

test('customer status lookup recovers the same order by public number or CDK', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const publicNo = 'PJV1-ABCDEFGHIJKLMNOPQRST';
  const fixture = await createOrder(pool, { publicNo });
  const queryStatus = createOrderStatusService({ pool, cdkHashKey: integrationCdkHashKey });
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
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const fixture = await createOrder(pool);
  const providerActions = [];
  const workflow = createWorkflowRepository(pool, {
    sessionEncryptionKey: integrationSessionKey
  });
  const rechargeAttemptRepository = createRechargeAttemptRepository(pool);
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
    rechargeAttemptRepository,
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
    await pool.query(
      `UPDATE orders SET session_ciphertext = ? WHERE id = ?`,
      [encryptSecret(JSON.stringify(sessionFixture()), integrationSessionKey), fixture.orderId]
    );
    assert.equal((await iteration()).status, 'COMPLETED');
    assert.equal((await iteration()).status, 'COMPLETED');
    assert.equal((await iteration()).status, 'COMPLETED');
    await pool.query(
      `UPDATE cards SET last_synced_at = CURRENT_TIMESTAMP(3) WHERE order_id = ?`,
      [fixture.orderId]
    );
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = 1
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    await createRechargeAuthorization(pool, {
      publicNos: [`TEST-${fixture.orderId}`], authorizedBy: 'fake-e2e-test', ttlMinutes: 10
    });
    assert.equal((await iteration()).status, 'COMPLETED');

    await pool.query(
      `UPDATE app_settings SET setting_value = 'false'
       WHERE setting_key = 'dispatch_new_recharges'`
    );
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = 0
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    await pool.query(
      `UPDATE tasks SET available_at = CURRENT_TIMESTAMP(3)
       WHERE order_id = ? AND task_type = 'POLL_RECHARGE'`,
      [fixture.orderId]
    );
    assert.equal((await iteration({ providerWritesEnabled: false })).status, 'COMPLETED');
    const [[pendingCancellation]] = await pool.query(
      `SELECT status, subscription_cancelled, cancellation_review_required, finished_at
       FROM orders WHERE id = ?`, [fixture.orderId]
    );
    assert.equal(pendingCancellation.status, OrderStatus.CANCELLATION_PENDING);
    assert.equal(pendingCancellation.subscription_cancelled, 0);
    assert.equal(pendingCancellation.cancellation_review_required, 0);
    assert.equal(pendingCancellation.finished_at, null);
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
      'card-details',
      'create-recharge',
      'poll-recharge',
      'recheck-cancellation'
    ]);
    const [[fundsAttempt]] = await pool.query(
      `SELECT rat.status, rat.funds_risk_state, rai.status AS authorization_item_status
       FROM recharge_attempts rat
       INNER JOIN recharge_authorization_items rai ON rai.id = rat.authorization_item_id
       WHERE rat.order_id = ?`,
      [fixture.orderId]
    );
    assert.deepEqual(fundsAttempt, {
      status: 'SUCCESS', funds_risk_state: 'SETTLED', authorization_item_status: 'CONSUMED'
    });
    const [[createCalls]] = await pool.query(
      `SELECT COUNT(*) AS count, MAX(outcome) AS outcome FROM provider_calls
       WHERE order_id = ? AND provider = 'zzshu' AND operation = 'create_direct'`,
      [fixture.orderId]
    );
    assert.equal(createCalls.count, 1);
    assert.equal(createCalls.outcome, 'SUCCESS');
    const [[postRechargeSync]] = await pool.query(
      `SELECT COUNT(*) AS count FROM card_sync_jobs j
       INNER JOIN cards c ON c.id = j.card_id
       WHERE c.order_id = ? AND j.requested_by = 'workflow'`, [fixture.orderId]
    );
    assert.equal(postRechargeSync.count, 1);
  } finally {
    await pool.query(
      `UPDATE app_settings SET setting_value = 'false'
       WHERE setting_key = 'dispatch_new_recharges'`
    );
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('Foundation v2 freezes authorization and persists the funds fence before submission', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const publicNo = `PJV1-V2-${crypto.randomUUID()}`;
  const fixture = await createOrder(pool, { publicNo, status: OrderStatus.CARD_READY });
  const cardId = id();
  let restoreDispatch = async () => {};
  try {
    restoreDispatch = await setDispatchSettings(pool, { enabled: true, mode: 'MANUAL' });
    await pool.query(
      `INSERT INTO cards
       (id, provider_account_id, order_id, inventory_status, intake_status,
        provider_card_id, external_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, sync_tier, last_synced_at)
       VALUES (?, ?, ?, 'ASSIGNED', 'ACCEPTED', ?, ?, '7', 'active',
         25, 25, 'USD', 'MONITORING', ?, 'ASSIGNED', CURRENT_TIMESTAMP(3))`,
      [cardId, legacyCardProviderAccountId, fixture.orderId, `v2-card-${cardId}`,
        `v2-card-${cardId}`, encryptSecret(JSON.stringify({
          cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
        }), integrationSessionKey)]
    );
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts, completed_at)
       VALUES (?, 'PREPARE_RECHARGE', 'COMPLETED', ?, 5, CURRENT_TIMESTAMP(3))`,
      [fixture.orderId, `prepare-v2:${fixture.orderId}`]
    );
    const [taskInsert] = await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)`,
      [fixture.orderId, `submit-recharge:${fixture.orderId}`]
    );
    const authorization = await createRechargeAuthorization(pool, {
      publicNos: [publicNo], authorizedBy: 'mysql-test', ttlMinutes: 10
    });
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = 1
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    await pool.query(`UPDATE tasks SET status = 'RUNNING' WHERE id = ?`, [taskInsert.insertId]);
    const repository = createRechargeAttemptRepository(pool);
    const attempt = await repository.beginAuthorizedAttempt({
      orderId: fixture.orderId,
      taskId: taskInsert.insertId,
      idempotencyKey: `recharge-submit:${fixture.orderId}`
    });
    const [[fenced]] = await pool.query(
      `SELECT o.status AS order_status, rat.funds_risk_state, rai.status AS item_status,
          pc.outcome AS call_outcome, pc.recharge_attempt_id
       FROM orders o
       INNER JOIN recharge_attempts rat ON rat.order_id = o.id
       INNER JOIN recharge_authorization_items rai ON rai.id = rat.authorization_item_id
       INNER JOIN provider_calls pc ON pc.recharge_attempt_id = rat.id
       WHERE o.id = ?`, [fixture.orderId]
    );
    assert.deepEqual(fenced, {
      order_status: 'SUBMITTING', funds_risk_state: 'ACTIVE', item_status: 'CONSUMED',
      call_outcome: 'STARTED', recharge_attempt_id: attempt.id
    });
    assert.equal(authorization.items[0].id, attempt.authorizationItemId);

    await repository.markAttemptSubmitted({
      attemptId: attempt.id,
      externalOrderId: 'external-v2-order',
      externalReference: 'DIRECT-v2-reference'
    });
    const [[committed]] = await pool.query(
      `SELECT o.status, o.recharge_order_no, o.recharge_card_key,
          c.card_credentials_ciphertext,
          SUM(t.task_type = 'POLL_RECHARGE') AS poll_tasks
       FROM orders o INNER JOIN cards c ON c.order_id = o.id
       LEFT JOIN tasks t ON t.order_id = o.id
       WHERE o.id = ? GROUP BY o.id, c.id`, [fixture.orderId]
    );
    assert.equal(committed.status, 'RECHARGE_PROCESSING');
    assert.equal(committed.recharge_order_no, 'external-v2-order');
    assert.equal(committed.recharge_card_key, 'DIRECT-v2-reference');
    assert.equal(committed.card_credentials_ciphertext, null);
    assert.equal(Number(committed.poll_tasks), 1);

    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: integrationSessionKey });
    await workflow.commitRechargeSuccess(fixture.orderId, {
      status: 'success', isSubscriptionCancelled: 0,
      paymentAmount: '20.000000', paymentCurrency: 'USD'
    });
    const [[pendingCancellation]] = await pool.query(
      `SELECT o.status, o.finished_at, rat.status AS attempt_status,
          rat.funds_risk_state, rat.finished_at AS attempt_finished_at
       FROM orders o INNER JOIN recharge_attempts rat ON rat.order_id = o.id
       WHERE o.id = ?`, [fixture.orderId]
    );
    assert.equal(pendingCancellation.status, OrderStatus.CANCELLATION_PENDING);
    assert.equal(pendingCancellation.finished_at, null);
    assert.equal(pendingCancellation.attempt_status, 'SUCCESS');
    assert.equal(pendingCancellation.funds_risk_state, 'SETTLED');
    assert.notEqual(pendingCancellation.attempt_finished_at, null);

    await workflow.commitCancellationStatus(fixture.orderId, {
      status: 'success', isSubscriptionCancelled: 1
    });
    const [[finalized]] = await pool.query(
      `SELECT status, subscription_cancelled, finished_at
       FROM orders WHERE id = ?`, [fixture.orderId]
    );
    assert.equal(finalized.status, OrderStatus.RECHARGE_SUCCESS);
    assert.equal(finalized.subscription_cancelled, 1);
    assert.notEqual(finalized.finished_at, null);
  } finally {
    await restoreDispatch();
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = 0
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('automatic fulfillment creates one funds attempt and one provider create intent under concurrency', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 6, timezone: 'Z' });
  const fixture = await createOrder(pool, { status: OrderStatus.CARD_READY });
  let originalWriteEnabled = 0;
  let restoreDispatch = async () => {};
  try {
    restoreDispatch = await setDispatchSettings(pool, { enabled: true, mode: 'AUTOMATIC' });
    const [[providerAccount]] = await pool.query(
      `SELECT write_enabled FROM provider_accounts
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    originalWriteEnabled = Number(providerAccount.write_enabled);
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = 1
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    const cardId = id();
    await pool.query(
      `INSERT INTO cards
       (id, provider_account_id, order_id, inventory_status, intake_status,
        provider_card_id, external_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, sync_tier, last_synced_at)
       VALUES (?, ?, ?, 'ASSIGNED', 'ACCEPTED', ?, ?, '7', 'active',
         25, 25, 'USD', 'MONITORING', ?, 'ASSIGNED', CURRENT_TIMESTAMP(3))`,
      [cardId, legacyCardProviderAccountId, fixture.orderId, `auto-card-${cardId}`,
        `auto-card-${cardId}`, encryptSecret(JSON.stringify({
          cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
        }), integrationSessionKey)]
    );
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts, completed_at)
       VALUES (?, 'PREPARE_RECHARGE', 'COMPLETED', ?, 5, CURRENT_TIMESTAMP(3))`,
      [fixture.orderId, `automatic-prepare:${fixture.orderId}`]
    );
    const [firstTask] = await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'SUBMIT_RECHARGE', 'RUNNING', ?, 5)`,
      [fixture.orderId, `automatic-submit-a:${fixture.orderId}`]
    );
    const [secondTask] = await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'SUBMIT_RECHARGE', 'RUNNING', ?, 5)`,
      [fixture.orderId, `automatic-submit-b:${fixture.orderId}`]
    );
    const repository = createRechargeAttemptRepository(pool);
    const results = await Promise.allSettled([
      repository.beginAuthorizedAttempt({ orderId: fixture.orderId, taskId: firstTask.insertId }),
      repository.beginAuthorizedAttempt({ orderId: fixture.orderId, taskId: secondTask.insertId })
    ]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    assert.equal(successes.length, 1);
    assert.equal(successes[0].value.authorizationMode, 'AUTOMATIC');

    const [[ledger]] = await pool.query(
      `SELECT COUNT(DISTINCT rat.id) AS attempts,
              COUNT(DISTINCT pc.id) AS create_calls,
              MAX(ra.authorization_mode) AS authorization_mode
       FROM recharge_attempts rat
       INNER JOIN recharge_authorization_items rai ON rai.id = rat.authorization_item_id
       INNER JOIN recharge_authorizations ra ON ra.id = rai.authorization_id
       INNER JOIN provider_calls pc ON pc.recharge_attempt_id = rat.id
         AND pc.operation = 'create_direct'
       WHERE rat.order_id = ?`,
      [fixture.orderId]
    );
    assert.deepEqual(ledger, {
      attempts: 1,
      create_calls: 1,
      authorization_mode: 'AUTOMATIC'
    });

    await assert.rejects(
      pool.query(
        `INSERT INTO provider_calls
         (order_id, recharge_attempt_id, provider, provider_account_id, operation,
          request_key, attempt_no, outcome, started_at)
         VALUES (?, ?, 'zzshu', '00000000-0000-4000-8000-000000000102',
           'create_direct', ?, 2, 'STARTED', CURRENT_TIMESTAMP(3))`,
        [fixture.orderId, successes[0].value.id, `duplicate-create:${fixture.orderId}`]
      ),
      (error) => error.code === 'ER_DUP_ENTRY'
    );
  } finally {
    await restoreDispatch();
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = ?
       WHERE id = '00000000-0000-4000-8000-000000000102'`,
      [originalWriteEnabled]
    );
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('a cleared attempt can be reauthorized after Session replacement with a distinct stable key', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const publicNo = `PJV1-${crypto.randomBytes(15).toString('base64url')}`;
  const fixture = await createOrder(pool, { publicNo, status: OrderStatus.CARD_READY });
  const replacement = sessionFixture({ nowMs: Date.now(), lifetimeSeconds: 7200 });
  replacement.user.email = 'retry@example.com';
  replacement.account.id = 'retry-account';
  let originalWriteEnabled = 0;
  let restoreDispatch = async () => {};
  try {
    restoreDispatch = await setDispatchSettings(pool, { enabled: true, mode: 'MANUAL' });
    const [[providerAccount]] = await pool.query(
      `SELECT write_enabled FROM provider_accounts
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    originalWriteEnabled = Number(providerAccount.write_enabled);
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = 1
       WHERE id = '00000000-0000-4000-8000-000000000102'`
    );
    const cardId = id();
    await pool.query(
      `INSERT INTO cards
       (id, provider_account_id, order_id, inventory_status, intake_status,
        provider_card_id, external_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, sync_tier, last_synced_at)
       VALUES (?, ?, ?, 'ASSIGNED', 'ACCEPTED', ?, ?, '7', 'active',
         25, 25, 'USD', 'MONITORING', ?, 'ASSIGNED', CURRENT_TIMESTAMP(3))`,
      [cardId, legacyCardProviderAccountId, fixture.orderId, `retry-card-${cardId}`,
        `retry-card-${cardId}`, encryptSecret(JSON.stringify({
          cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
        }), integrationSessionKey)]
    );
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts, completed_at)
       VALUES (?, 'PREPARE_RECHARGE', 'COMPLETED', ?, 5, CURRENT_TIMESTAMP(3))`,
      [fixture.orderId, `prepare-retry:${fixture.orderId}`]
    );
    const [taskInsert] = await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)`,
      [fixture.orderId, `submit-retry:${fixture.orderId}`]
    );
    const repository = createRechargeAttemptRepository(pool);
    const firstAuthorization = await createRechargeAuthorization(pool, {
      publicNos: [publicNo], authorizedBy: 'mysql-retry-test'
    });
    await pool.query(`UPDATE tasks SET status = 'RUNNING' WHERE id = ?`, [taskInsert.insertId]);
    const first = await repository.beginAuthorizedAttempt({
      orderId: fixture.orderId, taskId: taskInsert.insertId
    });
    await repository.markAttemptCleared({
      attemptId: first.id, resultSummary: { code: '40030' }
    });

    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: integrationSessionKey });
    await workflow.markSessionReplacementRequired(fixture.orderId);
    await createSessionReplacementService({
      pool, sessionEncryptionKey: integrationSessionKey,
      cdkHashKey: integrationCdkHashKey
    })({ publicNo, session: replacement });

    const secondAuthorization = await createRechargeAuthorization(pool, {
      publicNos: [publicNo], authorizedBy: 'mysql-retry-test'
    });
    await pool.query(
      `UPDATE tasks SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP(3)
       WHERE order_id = ? AND task_type = 'PREPARE_RECHARGE'`,
      [fixture.orderId]
    );
    await pool.query(`UPDATE tasks SET status = 'RUNNING' WHERE id = ?`, [taskInsert.insertId]);
    const second = await repository.beginAuthorizedAttempt({
      orderId: fixture.orderId, taskId: taskInsert.insertId
    });

    assert.notEqual(first.authorizationItemId, second.authorizationItemId);
    assert.equal(first.authorizationItemId, firstAuthorization.items[0].id);
    assert.equal(second.authorizationItemId, secondAuthorization.items[0].id);
    assert.notEqual(first.idempotencyKey, second.idempotencyKey);
    const [attempts] = await pool.query(
      `SELECT status, funds_risk_state, idempotency_key
       FROM recharge_attempts WHERE order_id = ? ORDER BY created_at, id`,
      [fixture.orderId]
    );
    assert.deepEqual(attempts.map((row) => [row.status, row.funds_risk_state]), [
      ['CLEARED', 'CLEARED'], ['PREPARED', 'ACTIVE']
    ]);
    assert.equal(new Set(attempts.map((row) => row.idempotency_key)).size, 2);
  } finally {
    await restoreDispatch();
    await pool.query(
      `UPDATE provider_accounts SET write_enabled = ?
       WHERE id = '00000000-0000-4000-8000-000000000102'`,
      [originalWriteEnabled]
    );
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('confirmed recharge failure clears exactly one funds attempt before closing the order', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const fixture = await createOrder(pool, { status: OrderStatus.RECHARGE_PROCESSING });
  const attemptId = id();
  try {
    await pool.query(
      `INSERT INTO recharge_attempts
       (id, order_id, executor_kind, status, funds_risk_state, submit_intent_at, submitted_at)
       VALUES (?, ?, 'API', 'PROCESSING', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [attemptId, fixture.orderId]
    );
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: integrationSessionKey });
    await workflow.commitRechargeFailure(fixture.orderId, {
      status: 'failed', failureReason: 'confirmed by provider'
    });
    const [[state]] = await pool.query(
      `SELECT o.status AS order_status, o.failure_code, o.finished_at,
          rat.status AS attempt_status, rat.funds_risk_state, rat.finished_at AS attempt_finished_at
       FROM orders o INNER JOIN recharge_attempts rat ON rat.order_id = o.id
       WHERE o.id = ?`, [fixture.orderId]
    );
    assert.equal(state.order_status, OrderStatus.RECHARGE_FAILED);
    assert.equal(state.failure_code, 'PROVIDER_CONFIRMED_FAILURE');
    assert.notEqual(state.finished_at, null);
    assert.equal(state.attempt_status, 'FAILED');
    assert.equal(state.funds_risk_state, 'CLEARED');
    assert.notEqual(state.attempt_finished_at, null);
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('a legacy task permit alone cannot enter the funds path', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const fixture = await createOrder(pool, { status: OrderStatus.CARD_READY });
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  try {
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, payload_json)
       VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?, ?)`,
      [fixture.orderId, `atomic-submit:${fixture.orderId}`,
        JSON.stringify({ rechargePermit: { status: 'ARMED', expiresAt } })]
    );
    const task = await claimNextTask(pool, {
      workerId: 'atomic-intent-worker', allowedTaskTypes: ['SUBMIT_RECHARGE'],
      rechargeDispatchMode: 'AUTOMATIC'
    });
    assert.equal(task, null);
    const [[state]] = await pool.query(
      `SELECT o.status,
          (SELECT COUNT(*) FROM recharge_attempts rat WHERE rat.order_id = o.id) AS attempts,
          (SELECT COUNT(*) FROM provider_calls pc WHERE pc.order_id = o.id) AS provider_calls
       FROM orders o WHERE o.id = ?`, [fixture.orderId]
    );
    assert.equal(state.status, OrderStatus.CARD_READY);
    assert.equal(Number(state.attempts), 0);
    assert.equal(Number(state.provider_calls), 0);
  } finally {
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('provider call audit persists only a redacted summary', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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
      claimNextTask(pool, {
        workerId: 'worker-a', leaseSeconds: 60, rechargeDispatchMode: 'AUTOMATIC'
      }),
      claimNextTask(pool, {
        workerId: 'worker-b', leaseSeconds: 60, rechargeDispatchMode: 'AUTOMATIC'
      })
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
      leaseSeconds: 90,
      rechargeDispatchMode: 'AUTOMATIC'
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
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
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

test('Foundation v2 operations SQL persists balance history and safe reconciliation data', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const observedAt = new Date(`2026-08-20T12:00:${String(Math.floor(Math.random() * 59)).padStart(2, '0')}.123Z`);
  const dedupeKey = `ops:${crypto.randomUUID()}`;
  try {
    const balances = createProviderBalanceSnapshotService({ pool });
    const first = await balances.recordSnapshot({
      providerAccountId: legacyCardProviderAccountId,
      currency: 'USD', availableBalance: '123.450000', observedAt,
      rawPayload: { data: { balance: '123.450000', apiKey: 'not-persisted' } }
    });
    const replay = await balances.recordSnapshot({
      providerAccountId: legacyCardProviderAccountId,
      currency: 'USD', availableBalance: '123.450000', observedAt,
      rawPayload: { data: { apiKey: 'not-persisted', balance: '123.450000' } }
    });
    assert.equal(first.inserted, true);
    assert.equal(replay.inserted, false);

    const cases = createReconciliationCaseService({ pool });
    await cases.upsertCase({
      caseType: 'SUBMIT_UNKNOWN_STALE', dedupeKey,
      evidence: { status: 'SUBMIT_UNKNOWN', apiKey: 'SECRET', cdkCode: 'PJ-ABCDE-FGHJK-MNPQR-ST234' }
    });
    const repeated = await cases.upsertCase({
      caseType: 'SUBMIT_UNKNOWN_STALE', dedupeKey: dedupeKey.toUpperCase(),
      severity: 'critical', evidence: { status: 'SUBMIT_UNKNOWN' }
    });
    assert.equal(repeated.dedupeKey, dedupeKey);
    const listed = await cases.listCases({ caseType: 'SUBMIT_UNKNOWN_STALE', pageSize: 100 });
    const item = listed.cases.find((entry) => entry.dedupeKey === dedupeKey);
    assert.equal(Boolean(item), true);
    assert.equal('evidence' in item, false);

    const exported = await createOperationsCsvExportService({ pool }).exportCsv({
      dataset: 'reconciliation_cases', filters: { dedupeKey }, limit: 10
    });
    assert.equal(exported.rowCount, 1);
    assert.doesNotMatch(exported.csv, /SECRET|PJ-ABCDE|apiKey/i);
  } finally {
    await pool.query('DELETE FROM reconciliation_cases WHERE dedupe_key = ?', [dedupeKey]);
    await pool.query(
      'DELETE FROM provider_balance_snapshots WHERE provider_account_id = ? AND currency = ? AND observed_at = ?',
      [legacyCardProviderAccountId, 'USD', observedAt]
    );
    await pool.end();
  }
});

test('traceability payment supplement persists an auditable payment without plaintext reference', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const fixture = await createOrder(pool);
  const publicNo = `TEST-${fixture.orderId}`;
  const paymentId = id();
  const reference = `trade-${crypto.randomUUID()}`;
  try {
    await pool.query(
       `INSERT INTO customer_payments
       (id, cdk_id, order_id, payment_status, payment_channel, recorded_by)
       VALUES (?, ?, ?, 'PAID', 'EXTERNAL_UNSPECIFIED', 'mysql-test')`,
      [paymentId, fixture.cdkId, fixture.orderId]
    );
    const service = createTraceabilityOperationsService({
      pool, paymentReferenceHmacKey: Buffer.alloc(32, 31)
    });
    const paidAt = '2026-08-21T02:00:00.000Z';
    assert.deepEqual(await service.completeCustomerPayment(publicNo, {
      amount: '199.50', currency: 'CNY', channel: 'ALIPAY', paidAt,
      externalReference: reference
    }), { publicNo, recorded: true, replayed: false });
    assert.deepEqual(await service.completeCustomerPayment(publicNo, {
      amount: '199.500000', currency: 'CNY', channel: 'ALIPAY', paidAt,
      externalReference: reference
    }), { publicNo, recorded: true, replayed: true });

    const [[stored]] = await pool.query(
      `SELECT amount, currency, payment_channel, external_reference_hmac,
              external_reference_masked
       FROM customer_payments WHERE id = ?`, [paymentId]
    );
    assert.equal(stored.amount, '199.500000');
    assert.equal(stored.currency, 'CNY');
    assert.equal(stored.payment_channel, 'ALIPAY');
    assert.match(stored.external_reference_hmac, /^[a-f0-9]{64}$/);
    assert.equal(stored.external_reference_hmac.includes(reference), false);
    assert.match(stored.external_reference_masked, new RegExp(`${reference.slice(-4)}$`));
    const [[notes]] = await pool.query(
      'SELECT COUNT(*) AS count FROM order_notes WHERE order_id = ?', [fixture.orderId]
    );
    assert.equal(notes.count, 1);
  } finally {
    await pool.query('DELETE FROM order_notes WHERE order_id = ?', [fixture.orderId]);
    await pool.query('DELETE FROM customer_payments WHERE id = ?', [paymentId]);
    await removeOrder(pool, fixture);
    await pool.end();
  }
});

test('customer replaces Session on the original MySQL order at most through the repair workflow', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；完整 MySQL 套件在服务器隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const publicNo = `PJV1-${crypto.randomBytes(15).toString('base64url')}`;
  const fixture = await createOrder(pool, { publicNo, status: OrderStatus.WAITING_FOR_SESSION });
  const nowMs = Date.parse('2026-08-21T03:00:00.000Z');
  const replacement = sessionFixture({ nowMs, lifetimeSeconds: 7200 });
  replacement.user.email = 'replacement@example.com';
  replacement.account.id = 'replacement-account';
  try {
    await pool.query(
      `UPDATE orders SET customer_action_code = 'ACCOUNT_ALREADY_PLUS',
         failure_code = 'TARGET_ACCOUNT_ALREADY_PLUS', session_repair_started_at = ?,
         session_repair_expires_at = DATE_ADD(?, INTERVAL 72 HOUR)
       WHERE id = ?`, [new Date(nowMs), new Date(nowMs), fixture.orderId]
    );
    await pool.query(
      `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'PREPARE_RECHARGE', 'COMPLETED', ?, 5),
              (?, 'SUBMIT_RECHARGE', 'DEAD', ?, 5)`,
      [fixture.orderId, `prepare-replacement:${fixture.orderId}`,
        fixture.orderId, `submit-replacement:${fixture.orderId}`]
    );
    const service = createSessionReplacementService({
      pool, sessionEncryptionKey: integrationSessionKey,
      cdkHashKey: integrationCdkHashKey, now: () => nowMs
    });
    assert.deepEqual(await service({ publicNo, session: replacement }), {
      publicNo, status: 'PROCESSING', replacementCount: 1, replacementsRemaining: 2
    });
    const [[stored]] = await pool.query(
      `SELECT status, customer_email, chatgpt_account_id, session_replacement_count,
              customer_action_code, failure_code, session_ciphertext
       FROM orders WHERE id = ?`, [fixture.orderId]
    );
    assert.equal(stored.status, OrderStatus.CARD_READY);
    assert.equal(stored.customer_email, 'replacement@example.com');
    assert.equal(stored.chatgpt_account_id, 'replacement-account');
    assert.equal(stored.session_replacement_count, 1);
    assert.equal(stored.customer_action_code, null);
    assert.equal(stored.failure_code, null);
    assert.equal(JSON.parse(decryptSecret(stored.session_ciphertext, integrationSessionKey)).accessToken,
      replacement.accessToken);
    const [tasks] = await pool.query(
      `SELECT task_type, status, attempts FROM tasks WHERE order_id = ? ORDER BY task_type`,
      [fixture.orderId]
    );
    assert.deepEqual(tasks, [
      { task_type: 'PREPARE_RECHARGE', status: 'PENDING', attempts: 0 },
      { task_type: 'SUBMIT_RECHARGE', status: 'PENDING', attempts: 0 }
    ]);
    const [[history]] = await pool.query(
      `SELECT COUNT(*) AS count FROM order_session_replacements WHERE order_id = ?`,
      [fixture.orderId]
    );
    assert.equal(history.count, 1);
  } finally {
    await pool.query('DELETE FROM order_session_replacements WHERE order_id = ?', [fixture.orderId]);
    await removeOrder(pool, fixture);
    await pool.end();
  }
});
