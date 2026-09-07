import assert from 'node:assert/strict';
import test from 'node:test';
import { returnCdkForOrderInTransaction } from '../src/db/repositories/cdk-return-repository.js';

function connection({ evidence = 0, bound = true, updated = 1 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      if (/cdk-return payment evidence/.test(sql)) return [[{ payment_evidence: evidence }], []];
      if (/FROM cdks WHERE order_id/.test(sql)) return [bound ? [{ id: 'cdk-1', batch_no: 'B-1' }] : [], []];
      if (/UPDATE cdks SET status = 'AVAILABLE'/.test(sql)) return [{ affectedRows: updated }, []];
      if (/INSERT INTO cdk_delivery_events/.test(sql)) return [{ affectedRows: 1 }, []];
      throw new Error(`unexpected ${sql}`);
    },
  };
}

test('a no-payment order hands its CDK back to AVAILABLE and records a RETURNED event', async () => {
  const c = connection();
  const result = await returnCdkForOrderInTransaction(c, { orderId: 'order-1', reason: 'Browser pre-payment abort: SESSION_INVALID', actorType: 'WORKER', actorId: 'pool:lane-3', metadata: { browserRunId: 'run-1' } });
  assert.deepEqual(result, { returned: true, reasonCode: null, cdkId: 'cdk-1' });
  const update = c.queries.find(({ sql }) => /UPDATE cdks/.test(sql));
  assert.deepEqual(update.values, ['cdk-1', 'order-1']);
  assert.match(update.sql, /order_id = NULL, redeemed_at = NULL/);
  const event = c.queries.find(({ sql }) => /INSERT INTO cdk_delivery_events/.test(sql));
  assert.equal(event.values[1], 'cdk-1');
  assert.equal(event.values[3], 'pool:lane-3');
  assert.deepEqual(JSON.parse(event.values[4]), { orderId: 'order-1', reason: 'Browser pre-payment abort: SESSION_INVALID', actorType: 'WORKER', browserRunId: 'run-1' });
});

test('any payment evidence keeps the CDK bound, and an unbound CDK is left alone', async () => {
  const paid = connection({ evidence: 1 });
  assert.deepEqual(await returnCdkForOrderInTransaction(paid, { orderId: 'order-2', reason: 'x' }), { returned: false, reasonCode: 'PAYMENT_EVIDENCE', cdkId: null });
  assert.equal(paid.queries.some(({ sql }) => /UPDATE cdks/.test(sql)), false);
  const unbound = connection({ bound: false });
  assert.deepEqual(await returnCdkForOrderInTransaction(unbound, { orderId: 'order-3', reason: 'x' }), { returned: false, reasonCode: 'CDK_NOT_BOUND', cdkId: null });
  await assert.rejects(() => returnCdkForOrderInTransaction(connection(), { orderId: '' }), TypeError);
});
