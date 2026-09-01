import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionRepairExpiryService } from '../src/services/session-repair-expiry-service.js';

test('expired Session replacement orders are closed through the guarded cancellation path', async () => {
  const calls = [];
  let selectionSql = '';
  const service = createSessionRepairExpiryService({
    pool: { query: async (sql) => { selectionSql = sql; return [[{ public_no: 'PJV1-EXPIRED' }], []]; } },
    cancelOrder: async (publicNo, input) => calls.push({ publicNo, input })
  });
  assert.deepEqual(await service(), { checked: 1, closed: 1, reviewRequired: 0 });
  assert.equal(calls[0].publicNo, 'PJV1-EXPIRED');
  assert.equal(calls[0].input.confirmation, '取消订单 PJV1-EXPIRED');
  assert.match(selectionSql, /funds_risk_state IN \('ACTIVE','UNKNOWN','SETTLED'\)/);
  assert.match(selectionSql, /outcome <> 'DEFINITE_FAILURE'/);
});

test('expiry cleanup never releases an order with uncertain funds', async () => {
  const service = createSessionRepairExpiryService({
    pool: { query: async () => [[{ public_no: 'PJV1-UNCERTAIN' }], []] },
    cancelOrder: async () => { const error = new Error('unsafe'); error.code = 'ORDER_CANCELLATION_SUBMISSION_RISK'; throw error; }
  });
  assert.deepEqual(await service(), { checked: 1, closed: 0, reviewRequired: 1 });
});
