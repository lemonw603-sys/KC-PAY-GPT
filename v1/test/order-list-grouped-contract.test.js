import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminReadService } from '../src/services/admin-read-service.js';

async function capture(input, rows = []) {
  const queries = [];
  const service = createAdminReadService({ pool: { async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('AS bucket_action')) return [[{ total: 9, processing: 1, success: 4, action: 3, unknown: 1, bucket_action: 3, bucket_success: 3, bucket_failed: 2 }]];
    if (sql.startsWith('SELECT COUNT')) return [[{ total: rows.length }]];
    if (sql.includes('FROM orders o LEFT JOIN cards c')) return [rows];
    return [[]];
  } } });
  return { result: await service.listOrders(input), queries };
}

test('D-356: groupByCdk keeps only the latest attempt per CDK, in list and count', async () => {
  const { queries } = await capture({ groupByCdk: true, includeSummary: true });
  for (const q of queries.filter((x) => /FROM orders o/.test(x.sql))) {
    assert.match(q.sql, /o\.id = \(SELECT latest_try\.id FROM orders latest_try WHERE latest_try\.cdk_id = o\.cdk_id/);
    assert.match(q.sql, /ORDER BY latest_try\.created_at DESC, latest_try\.id DESC LIMIT 1\)/);
    assert.equal((q.sql.match(/\?/g) || []).length, q.values.length);
  }
});

test('D-356: product and route filters are plain predicates and stay in the summary denominator', async () => {
  const { queries } = await capture({ planType: 'pro_20x', executorKind: 'BROWSER', status: 'BUCKET_SUCCESS', includeSummary: true });
  const list = queries.find((q) => q.sql.includes('FROM orders o LEFT JOIN cards c'));
  const summary = queries.find((q) => q.sql.includes('AS bucket_action'));
  assert.match(list.sql, /o\.plan_type = \?/);
  assert.match(list.sql, /fr_kind\.executor_kind = \?/);
  assert.match(list.sql, /o\.status = 'RECHARGE_SUCCESS' AND NOT \(o\.status IN \('CARD_FAILED'/, '成功桶排除需要人的单');
  assert.match(summary.sql, /o\.plan_type = \?/);
  assert.match(summary.sql, /fr_kind\.executor_kind = \?/);
  assert.doesNotMatch(summary.sql, /WHERE \(o\.status = 'RECHARGE_SUCCESS' AND NOT/, 'summary 不带当前桶');
  assert.deepEqual(summary.values.slice(-2), ['pro_20x', 'BROWSER'], '前面是 PROCESSING/REVIEW 状态清单的占位值');
});

test('D-356: invalid product / route / reference are rejected before any query', async () => {
  for (const input of [{ planType: 'Plus!' }, { executorKind: 'ZZSHU' }, { siblingsOf: 'x'.repeat(65) }]) {
    await assert.rejects(capture(input), (error) => error.code === 'INVALID_ADMIN_QUERY', JSON.stringify(input));
  }
});

test('D-356: each row carries route kind, history count, bucket and one primary action; summary carries four buckets', async () => {
  const base = { public_no: 'PJV1-a', plan_type: 'plus', customer_email: 'a@b.c', created_at: new Date('2026-09-23T08:33:06Z'), route_executor_kind: 'BROWSER', history_count: 2, session_repair_expires_at: new Date('2026-09-26T08:33:06Z') };
  const rows = [
    { ...base, status: 'WAITING_FOR_SESSION', needs_person: 1, failed_after_payment: 0, cancellation_review_required: 0 },
    { ...base, public_no: 'PJV1-b', status: 'RECHARGE_SUCCESS', needs_person: 1, failed_after_payment: 0, cancellation_review_required: 1 },
    { ...base, public_no: 'PJV1-c', status: 'RECHARGE_FAILED', needs_person: 0, failed_after_payment: 0, cancellation_review_required: 0 },
    { ...base, public_no: 'PJV1-d', status: 'RECHARGE_FAILED', needs_person: 1, failed_after_payment: 1, cancellation_review_required: 0 },
    { ...base, public_no: 'PJV1-e', status: 'RECHARGE_SUCCESS', needs_person: 0, failed_after_payment: 0, cancellation_review_required: 0, history_count: 0 },
  ];
  const { result } = await capture({ groupByCdk: true, includeSummary: true }, rows);
  assert.deepEqual(result.orders.map((o) => [o.publicNo, o.bucket, o.primaryAction?.key ?? null, o.historyCount, o.routeExecutorKind]), [
    ['PJV1-a', 'action', 'cancel', 2, 'BROWSER'],
    ['PJV1-b', 'action', 'renewal', 2, 'BROWSER'],
    ['PJV1-c', 'failed', 'manual', 2, 'BROWSER'],
    ['PJV1-d', 'action', null, 2, 'BROWSER'],
    ['PJV1-e', 'success', null, 0, 'BROWSER'],
  ]);
  assert.deepEqual(result.summary.buckets, { all: 9, action: 3, success: 3, failed: 2, processing: 1 });
  // D-359 ④：等 Session 芯片要显示剩余时间，列表行必须带到期时间（SQL 与投影都要有）
  assert.equal(result.orders[0].sessionRepairExpiresAt, '2026-09-26T08:33:06.000Z');
});

test('D-356: listOrderAttempts scopes to the same CDK and excludes the order itself', async () => {
  const queries = [];
  const service = createAdminReadService({ pool: { async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.startsWith('SELECT COUNT')) return [[{ total: 0 }]];
    return [[]];
  } } });
  const result = await service.listOrderAttempts('PJV1-x');
  const list = queries.find((q) => q.sql.includes('FROM orders o LEFT JOIN cards c'));
  assert.match(list.sql, /o\.cdk_id = \(SELECT sib\.cdk_id FROM orders sib WHERE BINARY sib\.public_no = BINARY \? LIMIT 1\)/);
  assert.match(list.sql, /BINARY o\.public_no <> BINARY \?/);
  assert.match(list.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(list.values.slice(0, 2), ['PJV1-x', 'PJV1-x']);
  assert.deepEqual(result, { publicNo: 'PJV1-x', attempts: [] });
  await assert.rejects(service.listOrderAttempts(''), (error) => error.code === 'INVALID_ADMIN_QUERY');
});
