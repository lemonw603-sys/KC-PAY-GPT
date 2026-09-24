import assert from 'node:assert/strict';
import test from 'node:test';
import { createTraceabilityOperationsService } from '../src/services/traceability-operations-service.js';

function poolWith(result) {
  const queries = [];
  return { queries, async query(sql, values) { queries.push({ sql, values }); return [result]; } };
}

test('adds append-only notes through an order relationship', async () => {
  const pool = poolWith({ affectedRows: 1 });
  const result = await createTraceabilityOperationsService({ pool })
    .addOrderNote('PJV1-DEMO', { note: ' 客户补充了新信息 ' });
  assert.deepEqual(result, { publicNo: 'PJV1-DEMO', note: '客户补充了新信息', recorded: true });
  assert.match(pool.queries[0].sql, /INSERT INTO order_notes/i);
  assert.match(pool.queries[0].sql, /BINARY o\.public_no = \?/i);
});

// 订单标签随 D-367 删除（addOrderTag 从未接到路由，order_tags 0 行）；保留备注的非法输入校验。
test('rejects invalid traceability input', async () => {
  const pool = poolWith({ affectedRows: 1 });
  const service = createTraceabilityOperationsService({ pool });
  assert.equal(service.addOrderTag, undefined);
  await assert.rejects(() => service.addOrderNote('bad', { note: 'x' }),
    (error) => error.code === 'ADMIN_ORDER_NOT_FOUND');
});

test('completes an unknown payment once while storing only HMAC and masked reference', async () => {
  const queries = [];
  const responses = [
    [[{ order_id: 'order-1', cdk_id: 'cdk-1', payment_id: 'payment-1',
      amount: null, currency: null, payment_channel: 'EXTERNAL_UNSPECIFIED', paid_at: null }], []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values) { queries.push({ sql, values }); return responses.shift(); }
  };
  const service = createTraceabilityOperationsService({
    pool: { async getConnection() { return connection; } },
    paymentReferenceHmacKey: Buffer.alloc(32, 44)
  });
  const result = await service.completeCustomerPayment('PJV1-DEMO', {
    amount: '199.50', currency: 'cny', channel: 'alipay',
    paidAt: '2026-08-21T10:00:00+08:00', externalReference: 'trade-secret-12345678'
  });
  assert.deepEqual(result, { publicNo: 'PJV1-DEMO', recorded: true, replayed: false });
  const update = queries.find(({ sql }) => /UPDATE customer_payments/.test(sql));
  assert.equal(update.values.includes('trade-secret-12345678'), false);
  assert.equal(update.values.some((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)), true);
  assert.match(update.values[6], /5678$/);
  assert.equal(queries.some(({ sql }) => /INSERT INTO order_notes/.test(sql)), true);
});
