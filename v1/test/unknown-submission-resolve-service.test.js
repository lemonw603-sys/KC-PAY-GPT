import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnknownSubmissionResolveService } from '../src/services/unknown-submission-resolve-service.js';

function harness(orderRow) {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => { queries.push({ sql: 'COMMIT' }); },
    rollback: async () => { queries.push({ sql: 'ROLLBACK' }); }, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      if (flat.startsWith('SELECT o.id')) return [orderRow ? [orderRow] : []];
      return [{ affectedRows: 1 }];
    }
  };
  return { queries, resolve: createUnknownSubmissionResolveService({ pool: { getConnection: async () => connection }, clock: () => new Date('2026-09-18T12:00:00Z') }) };
}
const row = { id: 'o1', status: 'RECONCILIATION_REQUIRED', version: 4, assigned_card_id: 'c1', executor_kind: 'API',
  attempt_id: 'att-1', attempt_status: 'SUBMIT_UNKNOWN', funds_risk_state: 'UNKNOWN', authorization_item_id: 'auth-1' };

test('CHARGED: attempt settles, ledger consumed, card depleted, order delivered with cancellation unknown → retirement list + reminder', async () => {
  const h = harness(row);
  const result = await h.resolve('PJV1-abcdefgh', { outcome: 'CHARGED', confirmation: '已核实 PJV1-abcdefgh CHARGED', actorId: 'lemon', note: 'account is Plus, card charged 15.71' });
  assert.equal(result.status, 'RECHARGE_SUCCESS');
  assert.equal(result.cancellationReviewRequired, true);
  const sqls = h.queries.map((q) => q.sql);
  assert.equal(sqls.some((s) => /UPDATE recharge_attempts SET status = 'SUCCESS', funds_risk_state = 'SETTLED'/.test(s)), true);
  assert.equal(sqls.some((s) => /UPDATE card_consumption_ledger SET status = \?/.test(s) && h.queries.find((q) => q.sql === s).params[0] === 'CONSUMED'), true);
  assert.equal(sqls.some((s) => /UPDATE cards SET inventory_status = 'DEPLETED'/.test(s)), true);
  assert.equal(sqls.some((s) => /UPDATE orders SET status = 'RECHARGE_SUCCESS', subscription_cancelled = 0, cancellation_review_required = 1/.test(s)), true);
  assert.equal(sqls.some((s) => /ORDER_CANCELLATION_UNCONFIRMED/.test(s)), true);
  const event = h.queries.find((q) => /INSERT INTO order_events/.test(q.sql));
  assert.deepEqual(event.params.slice(0, 4), ['o1', 'RECONCILIATION_REQUIRED', 'RECHARGE_SUCCESS', 'lemon']);
  assert.equal(sqls.some((s) => /UPDATE operator_alerts SET status = 'RESOLVED'/.test(s)), true);
  assert.equal(sqls.some((s) => /UPDATE reconciliation_cases SET status = 'RESOLVED'/.test(s)), true);
  assert.equal(sqls.at(-1), 'COMMIT');
});

test('NOT_CHARGED: funds fence cleared, ledger released, authorization released, order failed — never re-submitted automatically', async () => {
  const h = harness({ ...row, status: 'SUBMIT_UNKNOWN' });
  const result = await h.resolve('PJV1-abcdefgh', { outcome: 'NOT_CHARGED', confirmation: '已核实 PJV1-abcdefgh NOT_CHARGED', actorId: 'lemon' });
  assert.equal(result.status, 'RECHARGE_FAILED');
  const sqls = h.queries.map((q) => q.sql);
  assert.equal(sqls.some((s) => /UPDATE recharge_attempts SET status = 'CLEARED', funds_risk_state = 'CLEARED'/.test(s)), true);
  assert.equal(h.queries.find((q) => /UPDATE card_consumption_ledger/.test(q.sql)).params[0], 'RELEASED');
  assert.equal(sqls.some((s) => /UPDATE recharge_authorization_items SET status = 'RELEASED'/.test(s)), true);
  assert.equal(sqls.some((s) => /failure_code = 'PAYMENT_NOT_CHARGED_VERIFIED'/.test(s)), true);
  assert.equal(sqls.some((s) => /INSERT INTO tasks/.test(s)), false);
});

test('refuses Browser-route orders, wrong states and a mismatched confirmation word', async () => {
  await assert.rejects(() => harness({ ...row, executor_kind: 'BROWSER' }).resolve('PJV1-abcdefgh', { outcome: 'CHARGED', confirmation: '已核实 PJV1-abcdefgh CHARGED' }),
    (error) => error.code === 'UNKNOWN_RESOLUTION_WRONG_EXECUTOR');
  await assert.rejects(() => harness({ ...row, status: 'RECHARGE_PROCESSING', attempt_id: null }).resolve('PJV1-abcdefgh', { outcome: 'CHARGED', confirmation: '已核实 PJV1-abcdefgh CHARGED' }),
    (error) => error.code === 'UNKNOWN_RESOLUTION_NOT_ELIGIBLE');
  await assert.rejects(() => harness(row).resolve('PJV1-abcdefgh', { outcome: 'CHARGED', confirmation: 'yes' }),
    (error) => error.code === 'UNKNOWN_RESOLUTION_CONFIRMATION_REQUIRED');
});
