import assert from 'node:assert/strict';
import test from 'node:test';
import { MANUAL_FULFILLMENT_CONFIRMATION, createManualFulfillmentService } from '../src/services/manual-fulfillment-service.js';

// 假连接：按 SQL 特征回答；记录所有语句，便于断言「拒绝时没写任何东西」。
function scripted({ order, evidence, cdk = null, card = null }) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); }, async commit() { calls.push('COMMIT'); }, async rollback() { calls.push('ROLLBACK'); }, release() {},
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/SELECT id, status, version, assigned_card_id, cdk_id FROM orders/.test(sql)) return [order ? [order] : []];
      if (/AS live_or_paid_attempts/.test(sql)) return [[evidence]];
      if (/FROM cdks WHERE id = \?/.test(sql)) return [cdk ? [cdk] : []];
      if (/FROM cards WHERE id = \?/.test(sql)) return [card ? [card] : []];
      if (/^UPDATE|^INSERT/.test(sql.trim())) return [{ affectedRows: 1 }];
      return [[]];
    }
  };
  return { calls, pool: { async getConnection() { return connection; } } };
}
const clean = { live_or_paid_attempts: 0, consumed_ledger: 0, runs_past_arming: 0, payment_submits: 0, open_runs: 0, recharge_order_no: null, recharge_card_key: null };
const writes = (calls) => calls.filter((c) => typeof c === 'object' && /^(UPDATE|INSERT)/.test(c.sql.trim()));

test('D-356 ⑤: confirmation word is fixed and exported for the endpoint', () => {
  assert.equal(MANUAL_FULFILLMENT_CONFIRMATION, '我已在系统外手工充值成功');
});

test('refuses when any system payment evidence exists, without writing', async () => {
  for (const [key, value] of [['live_or_paid_attempts', 1], ['consumed_ledger', 1], ['runs_past_arming', 1], ['payment_submits', 1], ['open_runs', 1], ['recharge_order_no', 'Z123']]) {
    const { calls, pool } = scripted({ order: { id: 'o1', status: 'CARD_READY', version: 3, assigned_card_id: 'c1', cdk_id: 'k1' }, evidence: { ...clean, [key]: value } });
    await assert.rejects(createManualFulfillmentService({ pool }).closeManuallyFulfilled('PJV1-x'),
      (error) => error.code === 'MANUAL_FULFILLMENT_PAYMENT_EVIDENCE' && error.detail[key] === value, key);
    assert.equal(writes(calls).length, 0, `${key}: 拒绝时不许写`);
    assert.ok(calls.includes('ROLLBACK'));
  }
});

test('refuses statuses outside the closable set and unknown orders', async () => {
  const { pool } = scripted({ order: { id: 'o1', status: 'RECHARGE_PROCESSING', version: 1, assigned_card_id: null, cdk_id: 'k1' }, evidence: clean });
  await assert.rejects(createManualFulfillmentService({ pool }).closeManuallyFulfilled('PJV1-x'), (e) => e.code === 'MANUAL_FULFILLMENT_NOT_ELIGIBLE');
  const missing = scripted({ order: null, evidence: clean });
  await assert.rejects(createManualFulfillmentService({ pool: missing.pool }).closeManuallyFulfilled('PJV1-y'), (e) => e.code === 'ORDER_NOT_FOUND' && e.status === 404);
});

test('a clean CARD_READY order closes as RECHARGE_SUCCESS with renewal review, card released, ledger released', async () => {
  const { calls, pool } = scripted({ order: { id: 'o1', status: 'CARD_READY', version: 3, assigned_card_id: 'c1', cdk_id: 'k1' }, evidence: clean, card: { id: 'c1', last4: '8718', sync_tier: 'MANUAL_IMPORT' } });
  const result = await createManualFulfillmentService({ pool }).closeManuallyFulfilled('PJV1-x', { actorId: 'lemon', reason: 'hand paid' });
  assert.equal(result.previousStatus, 'CARD_READY'); assert.equal(result.cardUsed, false); assert.equal(result.cardLast4, '8718'); assert.equal(result.cdk, 'kept REDEEMED');
  const sqls = writes(calls).map((c) => c.sql.replace(/\s+/g, ' '));
  assert.ok(sqls.some((q) => /UPDATE orders SET status = 'RECHARGE_SUCCESS', cancellation_review_required = 1/.test(q)));
  assert.ok(sqls.some((q) => /UPDATE card_consumption_ledger SET status = \?/.test(q)) || calls.some((c) => typeof c === 'object' && /card_consumption_ledger/.test(c.sql)), '账本走 transitionCardConsumptionInTransaction');
  assert.ok(sqls.some((q) => /UPDATE card_assignment_history SET status = 'RELEASED'/.test(q)), '分配释放');
  assert.ok(!sqls.some((q) => /inventory_status = 'DEPLETED'/.test(q)), '卡没用 → 不置 DEPLETED');
  assert.ok(sqls.some((q) => /INSERT INTO order_events/.test(q) && /'RECHARGE_SUCCESS', 'ADMIN'/.test(q)));
  assert.ok(calls.includes('COMMIT'));
});

test('RECHARGE_FAILED: rebinds a free CDK, refuses a taken one, never accepts cardUsed', async () => {
  const order = { id: 'o1', status: 'RECHARGE_FAILED', version: 5, assigned_card_id: null, cdk_id: 'k1' };
  const free = scripted({ order, evidence: clean, cdk: { id: 'k1', status: 'AVAILABLE', order_id: null, batch_no: 'B1' } });
  const result = await createManualFulfillmentService({ pool: free.pool }).closeManuallyFulfilled('PJV1-x');
  assert.equal(result.cdk, 'rebound REDEEMED');
  assert.ok(writes(free.calls).some((c) => /UPDATE cdks SET status = 'REDEEMED', order_id = \?/.test(c.sql)));
  assert.ok(writes(free.calls).some((c) => /cdk_delivery_events/.test(c.sql) && /'REBOUND'/.test(c.sql)));

  const taken = scripted({ order, evidence: clean, cdk: { id: 'k1', status: 'REDEEMED', order_id: 'other', batch_no: 'B1' } });
  await assert.rejects(createManualFulfillmentService({ pool: taken.pool }).closeManuallyFulfilled('PJV1-x'), (e) => e.code === 'MANUAL_FULFILLMENT_CDK_TAKEN');
  assert.equal(writes(taken.calls).length, 0);

  const used = scripted({ order, evidence: clean, cdk: { id: 'k1', status: 'AVAILABLE', order_id: null, batch_no: 'B1' } });
  await assert.rejects(createManualFulfillmentService({ pool: used.pool }).closeManuallyFulfilled('PJV1-x', { cardUsed: true }), (e) => e.code === 'MANUAL_FULFILLMENT_CARD_USED_NOT_ALLOWED');
});

test('dryRun runs every check and every statement, then rolls back', async () => {
  const { calls, pool } = scripted({ order: { id: 'o1', status: 'WAITING_FOR_SESSION', version: 2, assigned_card_id: null, cdk_id: 'k1' }, evidence: clean });
  const result = await createManualFulfillmentService({ pool }).closeManuallyFulfilled('PJV1-x', { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.ok(writes(calls).length > 0);
  assert.ok(calls.includes('ROLLBACK') && !calls.includes('COMMIT'));
});
