import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminReadService } from '../src/services/admin-read-service.js';
import { encryptSecret } from '../src/security/secret-box.js';
import { sessionFixture } from '../test-support/session-fixture.js';

const adminCardKey = Buffer.alloc(32, 19);
const adminCdkKey = Buffer.alloc(32, 23);

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
    [{ total: 10, today: 2, successful: 8, completed_failed: 2, processing: 1,
      awaiting_confirmation: 1, reviewing: 1 }],
    [{ status: 'RECHARGE_SUCCESS', count: 8 }],
    [{ status: 'AVAILABLE', count: 20 }],
    [{ setting_key: 'accept_new_orders', setting_value: 'false', updated_at: new Date('2026-08-17T00:00:00Z') }],
    [{ status: 'REFUND_DETECTED', count: 1 }],
    [{ count: 1 }],
    [{ available: 7, provisioning: 1, assigned: 2, depleted: 1, held: 1 }],
    [{ setting_value: '5' }],
    [{ card_intake_pending: 2, funds_risk_pending: 1,
      card_funding_risk_pending: 2, card_funding_manual_review: 1,
      reconciliation_cases_open: 3, card_sync_backlog: 4 }]
  ]);
  const result = await createAdminReadService({ pool }).getOverview();
  assert.equal(result.metrics.successRate, 80);
  assert.equal(result.metrics.todayOrders, 2);
  assert.equal(result.metrics.awaitingConfirmationOrders, 1);
  assert.deepEqual(result.orderStatuses, [{ status: 'RECHARGE_SUCCESS', count: 8 }]);
  assert.deepEqual(result.cardStock, {
    available: 7, provisioning: 1, assigned: 2, depleted: 1, held: 1,
    lowThreshold: 5, low: false
  });
  assert.deepEqual(result.operationalBacklog, {
    cardIntakePending: 2, fundsRiskPending: 1,
    cardFundingRiskPending: 2, cardFundingManualReview: 1,
    reconciliationCasesOpen: 3, cardSyncBacklog: 4
  });
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
});

test('admin order list validates filters, maps card summaries, and supports CDK lookup', async () => {
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
    }], []
  ]);
  const result = await createAdminReadService({
    pool, sessionEncryptionKey: adminCardKey, cdkHashKey: adminCdkKey
  }).listOrders({
    page: '1', pageSize: '20', status: 'REVIEW_REQUIRED', q: 'PJV1'
  });
  assert.equal(result.total, 1);
  assert.deepEqual(result.orders[0].card, {
    cardNumber: '4242424242424242', last4: '4242', currentBalance: '25.000000',
    currency: 'USD', refundStatus: 'MONITORING'
  });
  assert.equal(result.orders[0].actualPaymentAmount, '1150.000000');
  assert.equal(result.orders[0].actualPaymentCurrency, 'PHP');
  assert.deepEqual(result.cdkMatches, []);
  assert.deepEqual(pool.queries[0].values.slice(0, 6), [
    'CARD_FAILED', 'WAITING_FOR_SESSION', 'SUBMIT_UNKNOWN', 'RECHARGE_FAILED',
    'CANCELLATION_REVIEW_REQUIRED', 'RECONCILIATION_REQUIRED'
  ]);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
  assert.match(pool.queries[0].sql, /EXISTS \(\s*SELECT 1 FROM cdks cdk/i);
  assert.equal(pool.queries[0].values.length, 23);
  assert.match(pool.queries[0].sql, /card_assignment_history/i);
  assert.match(pool.queries[0].sql, /customer_payments/i);

  await assert.rejects(
    () => createAdminReadService({ pool: queuedPool([]) }).listOrders({ status: 'NOT_A_STATUS' }),
    /Invalid status/
  );
});

test('admin order detail exposes the full PAN but not CVV or Session', async () => {
  const nowMs = Date.parse('2026-08-19T08:00:00.000Z');
  const pool = queuedPool([
    [{
      id: 'order-1', public_no: 'PJV1-DEMO', status: 'CARD_READY', plan_type: 'plus',
      open_card_amount: '16.000000', minimum_required_card_balance: '15.500000',
      actual_payment_amount: null, actual_payment_currency: null,
      provider_card_id: 'card-1', last4: '4242', card_status: 'active',
      current_balance: '16.000000',
      session_ciphertext: encryptSecret(JSON.stringify(sessionFixture({ nowMs })), adminCardKey),
      card_credentials_ciphertext: encryptSecret(JSON.stringify({
        cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
      }), adminCardKey),
      card_number_ciphertext: encryptSecret('4242424242424242', adminCardKey),
      last_synced_at: new Date(nowMs - 60_000),
      created_at: new Date(nowMs), updated_at: new Date(nowMs)
    }],
    [], [{
      task_type: 'PREPARE_RECHARGE', status: 'COMPLETED', attempts: 1, max_attempts: 5,
      permit_status: null, permit_expires_at: null
    }, {
      task_type: 'SUBMIT_RECHARGE', status: 'PENDING', attempts: 0, max_attempts: 5,
      permit_status: null, permit_expires_at: null
    }], [], [], [], [], [], [], [], [], [], [], [], [], []
  ]);
  const result = await createAdminReadService({
    pool, sessionEncryptionKey: adminCardKey, now: () => nowMs
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
    authorizationId: null,
    rechargeAttemptStatus: null,
    fundsRiskState: null,
    submissionTaskStatus: 'PENDING',
    submissionAttempts: 0,
    sessionValid: true,
    sessionCode: null,
    sessionExpiresAt: '2026-08-19T09:00:00.000Z',
    accessTokenExpiresAt: '2026-08-19T09:00:00.000Z',
    cardReady: true,
    cardCheckFresh: true
  });
  assert.deepEqual(result.compensation, {
    eligible: false, alreadyIssued: false, code: 'COMPENSATION_SIDE_EFFECT_RISK',
    issuedAt: null, replacementStatus: null
  });
  assert.deepEqual(result.cancellation, {
    eligible: true, alreadyCancelled: false, code: 'ORDER_CANCELLATION_ELIGIBLE',
    cardWillBeReleased: true
  });
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.traceability, {
    deliveryTrackingEnabled: false,
    cdks: [], deliveries: [], customerPayments: [], cardAssignments: [], notes: [], tags: [],
    orderRelationships: [], sessionReplacements: [],
    fulfillmentCost: {
      customerPayments: [], cardFundedAmount: [], providerConfirmedPayment: [],
      successfulCardPurchases: [], cardTransactionFees: [], exchangeRateApplied: false,
      note: '各币种保留原值；未留存的历史费用显示为空，不推算汇率或成本。'
    }
  });
  assert.equal(JSON.stringify(result).includes('fixture-signature'), false);
  assert.equal(JSON.stringify(result).includes('sessionToken'), false);
  assert.equal(pool.queries.some(({ sql }) => /\bcvv\b/i.test(sql)), false);
});

test('admin unified search supports exact PAN HMAC, tags, and bounded time filters', async () => {
  const panKey = Buffer.alloc(32, 31);
  const pool = queuedPool([[{ total: 0 }], []]);
  await createAdminReadService({ pool, panHmacKey: panKey }).listOrders({
    q: '4242-4242-4242-4242', tag: '补发',
    from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z'
  });
  const countQuery = pool.queries[0];
  assert.match(countQuery.sql, /sc\.pan_hmac = \?/i);
  assert.match(countQuery.sql, /BINARY ot\.tag = BINARY \?/i);
  assert.match(countQuery.sql, /o\.created_at >= \?/i);
  assert.match(countQuery.sql, /o\.created_at <= \?/i);
  const expectedHmac = (await import('node:crypto')).default
    .createHmac('sha256', panKey).update('4242424242424242').digest('hex');
  assert.ok(countQuery.values.includes(expectedHmac));

  await assert.rejects(
    () => createAdminReadService({ pool: queuedPool([]) }).listOrders({
      from: '2026-09-01', to: '2026-08-01'
    }),
    /Invalid time range/
  );
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
