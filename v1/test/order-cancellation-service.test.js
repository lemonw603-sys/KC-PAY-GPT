import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderCancellationService } from '../src/services/order-cancellation-service.js';

function fakePool(responses) {
  const queries = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/FROM card_consumption_ledger/.test(sql)) return [[{ id: 'usage-1', status: 'RESERVED', recharge_attempt_id: null }], []];
      if (/UPDATE card_consumption_ledger/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/UPDATE card_funding_attempts/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/UPDATE card_stock_jobs/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/UPDATE operator_alerts/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/cdk-return payment evidence/.test(sql)) return [[{ payment_evidence: 0 }], []];
      if (/FROM cdks WHERE order_id/.test(sql)) return [[{ id: 'cdk-1', batch_no: 'B-1' }], []];
      if (/UPDATE cdks SET status = 'AVAILABLE'/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/INSERT INTO cdk_delivery_events/.test(sql)) return [{ affectedRows: 1 }, []];
      const response = responses.shift();
      if (response === undefined) throw new Error(`Unexpected query: ${sql}`);
      return response;
    }
  };
  return { queries, async getConnection() { return connection; } };
}

function eligibleRow(overrides = {}) {
  return {
    id: 'order-1', public_no: 'PJV1-DEMO', status: 'CARD_READY', failure_code: null,
    recharge_order_no: null, recharge_card_key: null, minimum_required_card_balance: '16',
    card_id: 'card-1', card_type_id: '1', card_status: 'active', current_balance: '16',
    card_credentials_ciphertext: Buffer.from('encrypted'), last_synced_at: new Date(),
    submit_task_id: 7, submit_task_status: 'PENDING', submit_attempts: 0, permit_status: 'LOCKED',
    unsafe_attempt_count: 0, unsafe_provider_call_count: 0,
    browser_prepared_attempt_count: 0, browser_prepared_attempt_id: null,
    browser_authorization_item_id: null, browser_queued_dispatch_count: 0,
    browser_nonqueued_dispatch_count: 0, browser_run_count: 0,
    ...overrides
  };
}

test('cancellation safely closes a queued Browser order before any run or payment action', async () => {
  const pool = fakePool([
    [[eligibleRow({ status: 'RECHARGE_PROCESSING', browser_prepared_attempt_count: 1,
      browser_prepared_attempt_id: 'attempt-1', browser_authorization_item_id: 'auth-1',
      browser_queued_dispatch_count: 1, unsafe_attempt_count: 1 })], []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCancellationService({ pool })(
    'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO', reason: 'replaced by 20X order' }
  );
  assert.deepEqual(result, { publicNo: 'PJV1-DEMO', status: 'CLOSED', cardReleased: true,
    cardInventoryStatus: 'AVAILABLE', replayed: false });
  assert.equal(pool.queries.some(({ sql }) => /UPDATE browser_dispatch_jobs/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE recharge_attempts/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /noExternalPaymentAction/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE cdks SET status = 'AVAILABLE'/.test(sql)), true, 'a no-payment cancellation hands the CDK back');
  assert.equal(pool.queries.some(({ sql }) => /INSERT INTO cdk_delivery_events/.test(sql) ), true);
});

test('cancellation refuses a Browser order after a run exists', async () => {
  const pool = fakePool([[[eligibleRow({ status: 'RECHARGE_PROCESSING',
    browser_prepared_attempt_count: 1, browser_prepared_attempt_id: 'attempt-1',
    browser_queued_dispatch_count: 1, browser_run_count: 1, unsafe_attempt_count: 1 })], []]]);
  await assert.rejects(
    createOrderCancellationService({ pool })(
      'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
    ),
    (error) => error.code === 'ORDER_CANCELLATION_SUBMISSION_RISK'
  );
  assert.equal(pool.queries.length, 1);
});

test('cancellation closes an untouched order and releases its capacity for safe reuse', async () => {
  const pool = fakePool([
    [[eligibleRow()], []], [[], []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCancellationService({ pool })(
    'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
  );
  assert.deepEqual(result, {
    publicNo: 'PJV1-DEMO', status: 'CLOSED', cardReleased: true,
    cardInventoryStatus: 'AVAILABLE', replayed: false
  });
  assert.equal(pool.queries.some(({ sql }) => /inventory_status = CASE/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /CANCELLED_PRE_SUBMISSION/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE card_assignment_history/.test(sql)), true);
});

test('cancellation refuses an attempted recharge without changing tasks or cards', async () => {
  const pool = fakePool([[[eligibleRow({ submit_attempts: 1 })], []]]);
  await assert.rejects(
    createOrderCancellationService({ pool })(
      'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
    ),
    (error) => error.code === 'ORDER_CANCELLATION_SUBMISSION_RISK'
  );
  assert.equal(pool.queries.length, 1);
});

test('cancellation closes an untouched waiting-for-card order without inventing a card release', async () => {
  const pool = fakePool([
    [[eligibleRow({ status: 'WAITING_FOR_CARD', card_id: null, submit_task_id: null,
      assign_task_id: 22, assign_task_status: 'PENDING', assign_attempts: 0 })], []],
    [[], []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCancellationService({ pool })(
    'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO', reason: 'confirmed abandoned test order' }
  );
  assert.deepEqual(result, { publicNo: 'PJV1-DEMO', status: 'CLOSED', cardReleased: false,
    cardInventoryStatus: null, replayed: false });
  assert.equal(pool.queries.some(({ sql }) => /WAITING_FOR_CARD', 'CLOSED'/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE card_funding_attempts/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE card_stock_jobs/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE cards/.test(sql)), false);
});

test('cancellation releases assignment while freshness rules still guard reuse', async () => {
  const pool = fakePool([
    [[eligibleRow({ last_synced_at: new Date(Date.now() - 16 * 60_000) })], []], [[], []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCancellationService({ pool })(
    'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
  );
  assert.equal(result.cardInventoryStatus, 'AVAILABLE');
});

test('cancellation releases a waiting-for-session card after a definite no-funds rejection', async () => {
  const pool = fakePool([
    [[eligibleRow({ status: 'WAITING_FOR_SESSION', failure_code: 'TARGET_ACCOUNT_ALREADY_PLUS',
      submit_task_status: 'DEAD', submit_attempts: 1 })], []],
    [[], []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCancellationService({ pool })(
    'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO', reason: 'customer abandoned replacement' }
  );
  assert.equal(result.status, 'CLOSED');
  assert.equal(result.cardReleased, true);
  assert.equal(result.cardInventoryStatus, 'AVAILABLE');
  assert.equal(pool.queries.some(({ sql, values }) => /VALUES \(\?, \?, 'CLOSED'/.test(sql)
    && values[1] === 'WAITING_FOR_SESSION'), true);
});

test('cancellation keeps a waiting-for-session card locked when funds are not proven clear', async () => {
  const pool = fakePool([[[eligibleRow({ status: 'WAITING_FOR_SESSION', submit_task_status: 'DEAD',
    submit_attempts: 1, unsafe_attempt_count: 1 })], []]]);
  await assert.rejects(
    createOrderCancellationService({ pool })(
      'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
    ),
    (error) => error.code === 'ORDER_CANCELLATION_SUBMISSION_RISK'
  );
  assert.equal(pool.queries.some(({ sql }) => /UPDATE cards/.test(sql)), false);
});

test('cancellation closes a cardless waiting-for-session order and hands its CDK back', async () => {
  const pool = fakePool([
    [[eligibleRow({ status: 'WAITING_FOR_SESSION', card_id: null, submit_task_id: null, submit_task_status: null })], []],
    [[], []],                 // no zzshu create_direct call
    [{ affectedRows: 1 }, []], // tasks -> DEAD
    [{ affectedRows: 1 }, []], // orders -> CLOSED
    [{ affectedRows: 1 }, []], // order_events
  ]);
  const result = await createOrderCancellationService({ pool })('PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO', reason: 'stale' });
  assert.deepEqual(result, { publicNo: 'PJV1-DEMO', status: 'CLOSED', cardReleased: false, cardInventoryStatus: null, replayed: false });
  assert.equal(pool.queries.some(({ sql }) => /UPDATE cdks SET status = 'AVAILABLE'/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /UPDATE cards/.test(sql)), false, 'no card to release');
  assert.equal(pool.queries.some(({ sql }) => /status = 'CLOSED'/.test(sql) && /WAITING_FOR_SESSION/.test(sql)), true);
  // Any funds or provider trace still refuses.
  const risky = fakePool([[[eligibleRow({ status: 'WAITING_FOR_SESSION', card_id: null, submit_task_id: null, unsafe_attempt_count: 1 })], []]]);
  await assert.rejects(() => createOrderCancellationService({ pool: risky })('PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO', reason: 'stale' }), (e) => e.code === 'ORDER_CANCELLATION_SUBMISSION_RISK');
});
