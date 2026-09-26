import test from 'node:test';
import assert from 'node:assert/strict';
import { createFailureStatsService, FAILURE_STATS_TOTALS_SQL, FAILURE_STATS_DETAILS_SQL } from '../src/services/failure-stats-service.js';

// 判断逻辑在真实 MySQL 上验（failure-stats-mysql-integration.test.js）；这里只锁参数与空结果的形状。
const emptyPool = () => {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); return [[]]; } };
};

test('bad or reversed dates are refused as a 400, not silently widened', async () => {
  const stats = createFailureStatsService({ pool: emptyPool() });
  await assert.rejects(stats({ from: 'yesterday' }), (e) => e.status === 400 && e.code === 'INVALID_ADMIN_QUERY');
  await assert.rejects(stats({ from: '2026-09-26T00:00:00+08:00', to: '2026-09-20T00:00:00+08:00' }), (e) => e.status === 400);
});

test('no dates means all time; an empty range answers zeros without asking for details', async () => {
  const pool = emptyPool();
  const result = await createFailureStatsService({ pool })({});
  assert.deepEqual(result.totals, { orders: 0, succeeded: 0, failed: 0, other: 0, rehearsalExcluded: 0 });
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(pool.calls[0].params, [null, null, null, null]);
  assert.equal(pool.calls.some((c) => c.sql === FAILURE_STATS_DETAILS_SQL), false, 'no failed orders, no detail lookup');
});

test('the range is on submission time and every query is read-only', () => {
  assert.match(FAILURE_STATS_TOTALS_SQL, /o\.created_at >= \?/);
  for (const sql of [FAILURE_STATS_TOTALS_SQL, FAILURE_STATS_DETAILS_SQL]) assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/);
});
