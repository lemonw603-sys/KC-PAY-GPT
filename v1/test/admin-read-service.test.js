import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminReadService } from '../src/services/admin-read-service.js';
import { encryptSecret } from '../src/security/secret-box.js';

const adminCardKey = Buffer.alloc(32, 19);

function queuedPool(results) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (!results.length) throw new Error('Unexpected query');
      return [results.shift(), []];
    }
  };
}

test('admin overview maps aggregate values without exposing raw records', async () => {
  const pool = queuedPool([
    [{ total: 10, today: 2, successful: 8, processing: 1, reviewing: 1 }],
    [{ status: 'RECHARGE_SUCCESS', count: 8 }],
    [{ status: 'AVAILABLE', count: 20 }],
    [{ setting_key: 'accept_new_orders', setting_value: 'false', updated_at: new Date('2026-08-17T00:00:00Z') }],
    [{ status: 'REFUND_DETECTED', count: 1 }],
    [{ count: 1 }],
    [{ available: 7, provisioning: 1, assigned: 2 }],
    [{ setting_value: '5' }]
  ]);
  const result = await createAdminReadService({ pool }).getOverview();
  assert.equal(result.metrics.successRate, 80);
  assert.equal(result.metrics.todayOrders, 2);
  assert.deepEqual(result.orderStatuses, [{ status: 'RECHARGE_SUCCESS', count: 8 }]);
  assert.deepEqual(result.cardStock, {
    available: 7, provisioning: 1, assigned: 2, lowThreshold: 5, low: false
  });
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
});

test('admin order list validates filters and maps only card summaries', async () => {
  const pool = queuedPool([
    [{ total: 1 }],
    [{
      public_no: 'PJV1-DEMO', status: 'SUBMIT_UNKNOWN', customer_email: 'a@example.com',
      chatgpt_account_id: 'acct', recharge_order_no: null, failure_code: 'TIMEOUT',
      actual_payment_amount: '1150.000000', actual_payment_currency: 'PHP',
      created_at: new Date('2026-08-17T00:00:00Z'), updated_at: new Date('2026-08-17T00:01:00Z'),
      finished_at: null, last4: '4242', current_balance: '25.000000', currency: 'USD',
      refund_status: 'MONITORING',
      card_number_ciphertext: encryptSecret('4242424242424242', adminCardKey)
    }]
  ]);
  const result = await createAdminReadService({ pool, sessionEncryptionKey: adminCardKey }).listOrders({
    page: '1', pageSize: '20', status: 'REVIEW_REQUIRED', q: 'PJV1'
  });
  assert.equal(result.total, 1);
  assert.deepEqual(result.orders[0].card, {
    cardNumber: '4242424242424242', last4: '4242', currentBalance: '25.000000',
    currency: 'USD', refundStatus: 'MONITORING'
  });
  assert.equal(result.orders[0].actualPaymentAmount, '1150.000000');
  assert.equal(result.orders[0].actualPaymentCurrency, 'PHP');
  assert.deepEqual(pool.queries[0].values.slice(0, 4), [
    'CARD_FAILED', 'SUBMIT_UNKNOWN', 'RECHARGE_FAILED', 'RECONCILIATION_REQUIRED'
  ]);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);

  await assert.rejects(
    () => createAdminReadService({ pool: queuedPool([]) }).listOrders({ status: 'NOT_A_STATUS' }),
    /Invalid status/
  );
});

test('admin order detail exposes the full PAN but not CVV or Session', async () => {
  const pool = queuedPool([
    [{
      id: 'order-1', public_no: 'PJV1-DEMO', status: 'CREATED', plan_type: 'plus',
      open_card_amount: '16.000000', minimum_required_card_balance: '15.500000',
      actual_payment_amount: null, actual_payment_currency: null,
      provider_card_id: 'card-1', last4: '4242', card_status: 'active',
      card_number_ciphertext: encryptSecret('4242424242424242', adminCardKey),
      created_at: new Date(), updated_at: new Date()
    }],
    [], [{
      task_type: 'PREPARE_RECHARGE', status: 'COMPLETED', attempts: 1, max_attempts: 5,
      permit_status: null, permit_expires_at: null
    }, {
      task_type: 'SUBMIT_RECHARGE', status: 'PENDING', attempts: 0, max_attempts: 5,
      permit_status: null, permit_expires_at: null
    }], [], [], []
  ]);
  const result = await createAdminReadService({
    pool, sessionEncryptionKey: adminCardKey
  }).getOrder('PJV1-DEMO');
  assert.equal(result.order.publicNo, 'PJV1-DEMO');
  assert.equal(result.order.minimumRequiredCardBalance, '15.500000');
  assert.equal(result.card.cardNumber, '4242424242424242');
  assert.equal(Object.hasOwn(result.card, 'cvv'), false);
  assert.deepEqual(result.paymentGate, {
    prepaymentReady: true,
    submissionLocked: true,
    permitStatus: 'LOCKED',
    permitExpiresAt: null,
    submissionTaskStatus: 'PENDING',
    submissionAttempts: 0
  });
  assert.deepEqual(result.transactions, []);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
  assert.equal(pool.queries.some(({ sql }) => /\bcvv\b/i.test(sql)), false);
});

test('manual transaction sync queues only a read task and deduplicates active work', async () => {
  const queries = [];
  const responses = [
    [[{ setting_value: 'true' }], []],
    [[{ id: 'order-1', card_id: 'card-1' }], []],
    [[], []],
    [{ affectedRows: 1 }, []]
  ];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      const result = responses.shift();
      if (!result) throw new Error('Unexpected query');
      return result;
    }
  };
  const pool = { async getConnection() { return connection; } };
  const result = await createAdminReadService({ pool }).requestCardTransactionSync('PJV1-DEMO');
  assert.deepEqual(result, { queued: true, taskStatus: 'PENDING' });
  assert.match(queries[3].sql, /SYNC_CARD_TRANSACTIONS/);
  assert.equal(queries[3].values[0], 'order-1');
  assert.match(queries[3].values[1], /^manual-sync:order-1:/);

  const activeConnection = {
    ...connection,
    async query(sql, values = []) {
      if (/SELECT setting_value/.test(sql)) return [[{ setting_value: 'true' }], []];
      if (/SELECT o\.id/.test(sql)) return [[{ id: 'order-1', card_id: 'card-1' }], []];
      if (/SELECT status FROM tasks/.test(sql)) return [[{ status: 'RUNNING' }], []];
      throw new Error('should not insert while active');
    }
  };
  const activeResult = await createAdminReadService({ pool: { async getConnection() { return activeConnection; } } })
    .requestCardTransactionSync('PJV1-DEMO');
  assert.deepEqual(activeResult, { queued: false, taskStatus: 'RUNNING' });
});
