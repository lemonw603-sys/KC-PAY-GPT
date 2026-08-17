import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminReadService } from '../src/services/admin-read-service.js';

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
    [{ status: 'REFUND_DETECTED', count: 1 }]
  ]);
  const result = await createAdminReadService({ pool }).getOverview();
  assert.equal(result.metrics.successRate, 80);
  assert.equal(result.metrics.todayOrders, 2);
  assert.deepEqual(result.orderStatuses, [{ status: 'RECHARGE_SUCCESS', count: 8 }]);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
});

test('admin order list validates filters and maps only card summaries', async () => {
  const pool = queuedPool([
    [{ total: 1 }],
    [{
      public_no: 'PJV1-DEMO', status: 'SUBMIT_UNKNOWN', customer_email: 'a@example.com',
      chatgpt_account_id: 'acct', recharge_order_no: null, failure_code: 'TIMEOUT',
      created_at: new Date('2026-08-17T00:00:00Z'), updated_at: new Date('2026-08-17T00:01:00Z'),
      finished_at: null, last4: '4242', current_balance: '25.000000', currency: 'USD',
      refund_status: 'MONITORING'
    }]
  ]);
  const result = await createAdminReadService({ pool }).listOrders({
    page: '1', pageSize: '20', status: 'REVIEW_REQUIRED', q: 'PJV1'
  });
  assert.equal(result.total, 1);
  assert.deepEqual(result.orders[0].card, {
    last4: '4242', currentBalance: '25.000000', currency: 'USD', refundStatus: 'MONITORING'
  });
  assert.deepEqual(pool.queries[0].values.slice(0, 3), [
    'SUBMIT_UNKNOWN', 'RECHARGE_FAILED', 'RECONCILIATION_REQUIRED'
  ]);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);

  await assert.rejects(
    () => createAdminReadService({ pool: queuedPool([]) }).listOrders({ status: 'NOT_A_STATUS' }),
    /Invalid status/
  );
});

test('admin order detail excludes session and card secrets from its queries', async () => {
  const pool = queuedPool([
    [{ id: 'order-1', public_no: 'PJV1-DEMO', status: 'CREATED', plan_type: 'plus', created_at: new Date(), updated_at: new Date() }],
    [], [], [], []
  ]);
  const result = await createAdminReadService({ pool }).getOrder('PJV1-DEMO');
  assert.equal(result.order.publicNo, 'PJV1-DEMO');
  assert.equal(result.card, null);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
});
