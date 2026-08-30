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
