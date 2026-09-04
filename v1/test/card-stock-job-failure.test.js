import assert from 'node:assert/strict';
import test from 'node:test';
import { failCardStockJob } from '../src/services/card-stock-job-service.js';

function poolFor(job) {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes('SELECT job_source')) return [[job]];
      return [{ affectedRows: 1 }];
    }
  };
  return { pool: { getConnection: async () => connection }, queries };
}

test('automatic preflight failures are retryable without consuming paid-review quota and alert once', async () => {
  const state = poolFor({
    job_source: 'AUTOMATIC',
    rules_snapshot_json: { demandOrderId: 'order-1' }
  });
  const result = await failCardStockJob(state.pool, {
    jobId: 'job-1', workerId: 'worker-1',
    error: { code: 'CARD_STOCK_BALANCE_INSUFFICIENT', message: 'insufficient' }
  });
  assert.deepEqual(result, { status: 'FAILED', code: 'CARD_STOCK_BALANCE_INSUFFICIENT' });
  const update = state.queries.find(({ sql }) => sql.includes('UPDATE card_stock_jobs SET status'));
  assert.equal(update.parameters[0], 'FAILED');
  const alert = state.queries.find(({ sql }) => sql.includes('INSERT INTO operator_alerts'));
  assert.ok(alert);
  assert.equal(alert.parameters[0], 'order-waiting-card:order-1');
});

test('ambiguous stock execution failures remain review-required', async () => {
  const state = poolFor({ job_source: 'MANUAL', rules_snapshot_json: {} });
  const result = await failCardStockJob(state.pool, {
    jobId: 'job-2', workerId: 'worker-2',
    error: { code: 'CARD_STOCK_OPEN_FAILED', message: 'unknown result' }
  });
  assert.deepEqual(result, { status: 'REVIEW_REQUIRED', code: 'CARD_STOCK_OPEN_FAILED' });
  const update = state.queries.find(({ sql }) => sql.includes('UPDATE card_stock_jobs SET status'));
  assert.equal(update.parameters[0], 'REVIEW_REQUIRED');
  assert.equal(state.queries.some(({ sql }) => sql.includes('INSERT INTO operator_alerts')), false);
});

test('a nominal preflight code still requires review after any card was opened', async () => {
  const state = poolFor({ job_source: 'MANUAL', rules_snapshot_json: {}, opened_count: 1 });
  const result = await failCardStockJob(state.pool, {
    jobId: 'job-3', workerId: 'worker-3',
    error: { code: 'CARD_STOCK_BALANCE_INSUFFICIENT', message: 'after partial batch' }
  });
  assert.equal(result.status, 'REVIEW_REQUIRED');
});
