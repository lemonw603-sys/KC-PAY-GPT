import assert from 'node:assert/strict';
import test from 'node:test';
import { createManualCancellationService, ManualCancellationError } from '../src/services/manual-cancellation-service.js';

function poolFixture(orderRow) {
  const queries = [];
  const connection = {
    async beginTransaction() { queries.push({ sql: 'BEGIN' }); },
    async commit() { queries.push({ sql: 'COMMIT' }); },
    async rollback() { queries.push({ sql: 'ROLLBACK' }); },
    release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT id, status, version/.test(sql)) return [orderRow ? [orderRow] : [], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  return { queries, pool: { async getConnection() { return connection; } } };
}

const PUBLIC_NO = 'PJV1-7EYSr3AZfjVl5JZQwTZt';
const ok = { confirmation: `已取消续费 ${PUBLIC_NO}`, note: 'fadadadacai2027 已在设置里关闭' };

test('records a manual cancellation for a CANCELLATION_REVIEW_REQUIRED order', async () => {
  const fixture = poolFixture({ id: 'o1', status: 'CANCELLATION_REVIEW_REQUIRED', version: 7, subscription_cancelled: 0, cancellation_review_required: 1 });
  const service = createManualCancellationService({ pool: fixture.pool });
  const result = await service(PUBLIC_NO, ok);
  assert.deepEqual(result, { publicNo: PUBLIC_NO, status: 'RECHARGE_SUCCESS', subscriptionCancelled: 1, replayed: false });
  const update = fixture.queries.find(({ sql }) => /UPDATE orders SET status = 'RECHARGE_SUCCESS', subscription_cancelled = 1/.test(sql));
  assert.ok(update, 'orders row is updated');
  assert.deepEqual(update.values, ['o1', 7], 'optimistic lock on version');
  const event = fixture.queries.find(({ sql }) => /INSERT INTO order_events/.test(sql));
  assert.equal(event.values[1], 'CANCELLATION_REVIEW_REQUIRED');
  assert.match(event.values[4], /manualCancellation/);
  assert.equal(fixture.queries.at(-1).sql, 'COMMIT');
});

test('is idempotent once the order already records a cancelled subscription', async () => {
  const fixture = poolFixture({ id: 'o1', status: 'RECHARGE_SUCCESS', version: 9, subscription_cancelled: 1, cancellation_review_required: 0 });
  const service = createManualCancellationService({ pool: fixture.pool });
  const result = await service(PUBLIC_NO, ok);
  assert.equal(result.replayed, true);
  assert.equal(fixture.queries.some(({ sql }) => /UPDATE orders/.test(sql)), false);
  assert.equal(fixture.queries.some(({ sql }) => /INSERT INTO order_events/.test(sql)), false);
});

test('refuses orders that never paid or are still unknown', async () => {
  for (const status of ['CARD_READY', 'RECHARGE_PROCESSING', 'SUBMIT_UNKNOWN', 'RECHARGE_FAILED', 'CLOSED']) {
    const fixture = poolFixture({ id: 'o1', status, version: 1, subscription_cancelled: 0, cancellation_review_required: 0 });
    const service = createManualCancellationService({ pool: fixture.pool });
    await assert.rejects(service(PUBLIC_NO, ok),
      (error) => error instanceof ManualCancellationError && error.code === 'MANUAL_CANCELLATION_NOT_ELIGIBLE');
    assert.equal(fixture.queries.some(({ sql }) => /UPDATE orders/.test(sql)), false, status);
    assert.equal(fixture.queries.at(-1).sql, 'ROLLBACK', status);
  }
});

test('requires the exact confirmation literal and a known order', async () => {
  const fixture = poolFixture({ id: 'o1', status: 'CANCELLATION_REVIEW_REQUIRED', version: 1, subscription_cancelled: 0, cancellation_review_required: 1 });
  const service = createManualCancellationService({ pool: fixture.pool });
  await assert.rejects(service(PUBLIC_NO, { confirmation: 'wrong' }),
    (error) => error.code === 'MANUAL_CANCELLATION_CONFIRMATION_REQUIRED' && error.status === 400);
  const missing = createManualCancellationService({ pool: poolFixture(null).pool });
  await assert.rejects(missing(PUBLIC_NO, ok), (error) => error.code === 'ADMIN_ORDER_NOT_FOUND' && error.status === 404);
});
