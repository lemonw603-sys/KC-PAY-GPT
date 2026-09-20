import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnknownSubmissionResolveService, unknownSubmissionEligibility } from '../src/services/unknown-submission-resolve-service.js';

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

// ── 资格规则抽成共享定义之后的守门（2026-09-20，欠账 10）────────────────────────
// 页面按不按「确认核实结果」这个钮，和服务端拒不拒，必须是同一份规则算的。抄第二份的
// 那一刻就开始漂移：要么页面给出一个后端必然拒绝的按钮，要么藏起一个本该能点的。
test('资格规则：只有 API 路线 + 两种订单状态 + 存在未知资金的 attempt，三者齐了才合格', () => {
  const ok = { executorKind: 'API', orderStatus: 'RECONCILIATION_REQUIRED', attemptId: 'att-1' };
  assert.equal(unknownSubmissionEligibility(ok).eligible, true);
  assert.equal(unknownSubmissionEligibility({ ...ok, orderStatus: 'SUBMIT_UNKNOWN' }).eligible, true);

  // 路线不对 → 走 Browser 那套
  assert.deepEqual(
    { e: unknownSubmissionEligibility({ ...ok, executorKind: 'BROWSER' }).eligible,
      c: unknownSubmissionEligibility({ ...ok, executorKind: 'BROWSER' }).code },
    { e: false, c: 'UNKNOWN_RESOLUTION_WRONG_EXECUTOR' });
  // executor_kind 为 NULL（LEFT JOIN 没匹配上）同样不合格——与服务端 `String(x||'')` 的行为一致，
  // 不许在任何一侧偷偷兜底成 'API'，否则页面会给出后端必拒的按钮。
  assert.equal(unknownSubmissionEligibility({ ...ok, executorKind: null }).eligible, false);

  // 状态不对 / 没有那个 attempt
  for (const bad of [{ orderStatus: 'RECHARGE_SUCCESS' }, { orderStatus: 'CREATED' }, { attemptId: null }]) {
    const verdict = unknownSubmissionEligibility({ ...ok, ...bad });
    assert.equal(verdict.eligible, false, `${JSON.stringify(bad)} 不该合格`);
    assert.equal(verdict.code, 'UNKNOWN_RESOLUTION_NOT_ELIGIBLE');
  }
});

test('资格规则与收口服务不会各说各话：规则说不合格时，服务必抛同一个 code', async () => {
  for (const [bad, expected] of [
    [{ executor_kind: 'BROWSER' }, 'UNKNOWN_RESOLUTION_WRONG_EXECUTOR'],
    [{ status: 'RECHARGE_SUCCESS' }, 'UNKNOWN_RESOLUTION_NOT_ELIGIBLE'],
    [{ attempt_id: null }, 'UNKNOWN_RESOLUTION_NOT_ELIGIBLE'],
  ]) {
    const candidate = { ...row, ...bad };
    // 规则怎么说
    const verdict = unknownSubmissionEligibility({
      executorKind: candidate.executor_kind, orderStatus: candidate.status, attemptId: candidate.attempt_id });
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.code, expected);
    // 服务怎么做
    const h = harness(candidate);
    await assert.rejects(
      h.resolve('PJV1-abcdefgh', { outcome: 'CHARGED', confirmation: '已核实 PJV1-abcdefgh CHARGED', note: 'x' }),
      (error) => error.code === expected, `${JSON.stringify(bad)} 服务端该抛 ${expected}`);
    // 拒绝不能留下半个事务
    assert.ok(h.queries.some((q) => q.sql === 'ROLLBACK'), '拒绝后必须回滚');
    assert.ok(!h.queries.some((q) => q.sql === 'COMMIT'), '拒绝后不许提交');
  }
});
