import assert from 'node:assert/strict';
import test from 'node:test';


// 第④步收尾（2026-09-18）：人工核对完 REVIEW_REQUIRED 的开卡 job 后结清它。
// 补记脚本只补卡，不认识 job/故障态/告警，补完卡调度器仍每轮 FUNDS_REVIEW_REQUIRED。
test('resolveReviewedCardStockJob closes a reviewed job, writes back the real opened count and keeps the original observation', async () => {
  const { resolveReviewedCardStockJob } = await import('../src/services/card-stock-job-service.js');
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => { queries.push({ sql: 'COMMIT' }); },
    rollback: async () => { queries.push({ sql: 'ROLLBACK' }); }, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      if (flat.startsWith('SELECT id, status, provider_account_id')) {
        return [[{ id: 'job-1', status: 'REVIEW_REQUIRED', provider_account_id: 'acct-103', opened_count: 0,
          error_code: 'HIGHVCC_RECONCILE_NOT_READY', rules_snapshot_json: JSON.stringify({ target: 2 }) }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const result = await resolveReviewedCardStockJob({ getConnection: async () => connection },
    { jobId: 'job-1', openedCount: 1, note: 'card recorded manually', actorId: 'lemon' });
  assert.equal(result.openedCount, 1);
  assert.equal(result.previousOpenedCount, 0);
  assert.equal(result.errorCode, 'HIGHVCC_RECONCILE_NOT_READY', 'the original observation is returned, not overwritten');
  const update = queries.find((q) => q.sql.startsWith('UPDATE card_stock_jobs'));
  assert.equal(update.params[0], 1, 'opened_count carries the real count so the daily limit still counts it');
  const snapshot = JSON.parse(update.params[1]);
  assert.equal(snapshot.target, 2, 'existing rules snapshot is preserved');
  assert.equal(snapshot.manualResolution.resolvedBy, 'lemon');
  assert.equal(snapshot.manualResolution.openedCount, 1);
  assert.match(update.sql, /WHERE id = \? AND status = 'REVIEW_REQUIRED'/);
  assert.equal(queries.some((q) => /error_code = |error_message = /.test(q.sql)), false, 'the observation columns are never rewritten');
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('resolveReviewedCardStockJob refuses a job that is not under review and validates its inputs', async () => {
  const { resolveReviewedCardStockJob } = await import('../src/services/card-stock-job-service.js');
  const pool = (status) => ({ getConnection: async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => (String(sql).includes('SELECT id, status, provider_account_id')
      ? [[{ id: 'job-1', status, provider_account_id: 'a', opened_count: 0, error_code: null, rules_snapshot_json: null }]]
      : [{ affectedRows: 1 }]),
  }) });
  await assert.rejects(() => resolveReviewedCardStockJob(pool('COMPLETED'), { jobId: 'job-1', openedCount: 1, note: 'x' }), /only REVIEW_REQUIRED/);
  await assert.rejects(() => resolveReviewedCardStockJob(pool('REVIEW_REQUIRED'), { jobId: 'job-1', openedCount: 1 }), /note is required/);
  await assert.rejects(() => resolveReviewedCardStockJob(pool('REVIEW_REQUIRED'), { jobId: 'job-1', openedCount: -1, note: 'x' }), /openedCount/);
});
