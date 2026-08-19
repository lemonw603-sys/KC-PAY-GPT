import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderCancellationService } from '../src/services/order-cancellation-service.js';

function fakePool(responses) {
  const queries = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
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
    ...overrides
  };
}

test('cancellation closes an untouched order and atomically releases its card', async () => {
  const pool = fakePool([
    [[eligibleRow()], []], [[], []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCancellationService({ pool })(
    'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
  );
  assert.deepEqual(result, {
    publicNo: 'PJV1-DEMO', status: 'CLOSED', cardReleased: true, replayed: false
  });
  assert.equal(pool.queries.some(({ sql }) => /inventory_status = 'AVAILABLE'/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /CANCELLED_PRE_SUBMISSION/.test(sql)), true);
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

test('cancellation refuses a stale card even when recharge was never attempted', async () => {
  const pool = fakePool([
    [[eligibleRow({ last_synced_at: new Date(Date.now() - 16 * 60_000) })], []], [[], []]
  ]);
  await assert.rejects(
    createOrderCancellationService({ pool })(
      'PJV1-DEMO', { confirmation: '取消订单 PJV1-DEMO' }
    ),
    (error) => error.code === 'ORDER_CANCELLATION_CARD_NOT_REUSABLE'
  );
  assert.equal(pool.queries.length, 2);
});
