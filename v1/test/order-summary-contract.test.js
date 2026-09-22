import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminReadService } from '../src/services/admin-read-service.js';

async function capture(input) {
  const queries = [];
  const service = createAdminReadService({ pool: { async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('AS processing')) return [[{ total: 7, processing: 2, success: 3, action: 2, unknown: 1 }]];
    if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]];
    return [[]];
  } } });
  return { result: await service.listOrders(input), queries };
}

test('summary is opt-in: existing dashboard list consumers do not run another aggregate', async () => {
  const { result, queries } = await capture({});
  assert.equal(queries.length, 2);
  assert.equal(result.summary, undefined);
});

test('payment unknown list and count share the same predicate, not all reconciliation cases', async () => {
  const { result, queries } = await capture({ status: 'PAYMENT_UNKNOWN', includeSummary: true });
  const listSql = queries.find(q => q.sql.includes("o.status = 'SUBMIT_UNKNOWN'"));
  const summary = queries.find(q => q.sql.includes('AS processing'));
  assert.match(listSql.sql, /o\.status = 'SUBMIT_UNKNOWN'/);
  assert.doesNotMatch(listSql.sql, /reconciliation_cases|RECONCILIATION_REQUIRED/);
  assert.match(listSql.sql, /funds_risk_state = 'UNKNOWN'/);
  assert.match(summary.sql, /SUM\(\(o\.status = 'SUBMIT_UNKNOWN' OR EXISTS/);
  assert.equal(result.summary.unknown, 1);
});

test('summary keeps search and time filters, excluding only the selected status', async () => {
  const { queries } = await capture({ status: 'REVIEW_REQUIRED', q: 'example.test',
    from: '2026-09-01T00:00:00Z', to: '2026-09-23T00:00:00Z', includeSummary: true });
  const summary = queries.find(q => q.sql.includes('AS processing'));
  const base = queries[0];
  assert.match(summary.sql, /FROM orders o WHERE o.created_at >= \? AND o.created_at <= \?/);
  assert.match(summary.sql, /o.customer_email LIKE \?/);
  assert.deepEqual(summary.values.slice(-base.values.slice(5).length), base.values.slice(5));
  for (const q of queries) assert.equal((q.sql.match(/\?/g) || []).length, q.values.length);
});
