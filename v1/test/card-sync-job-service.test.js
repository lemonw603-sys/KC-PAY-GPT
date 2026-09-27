import assert from 'node:assert/strict';
import test from 'node:test';
import { createCardSyncJobService, failCardSyncJob } from '../src/services/card-sync-job-service.js';

function recordingPool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return [{ affectedRows: 1 }, []];
    }
  };
}

test('deterministic read schema failures go directly to review instead of retrying five times', async () => {
  const pool = recordingPool();
  await failCardSyncJob(pool, {
    job: { id: 'job-1', card_id: 'card-1', attempts: 1, maxAttempts: 5, sync_tier: 'AVAILABLE' },
    workerId: 'worker-1',
    error: Object.assign(new Error('Invalid Hnskj card transactions data'), {
      kind: 'schema', retryable: false
    })
  });
  assert.equal(pool.calls[0].params[0], 'REVIEW_REQUIRED');
  assert.equal(pool.calls[0].params[4], 0);
});

test('transient read failures keep the existing bounded retry path', async () => {
  const pool = recordingPool();
  await failCardSyncJob(pool, {
    job: { id: 'job-2', card_id: 'card-2', attempts: 1, maxAttempts: 5, sync_tier: 'AVAILABLE' },
    workerId: 'worker-2',
    error: Object.assign(new Error('timeout'), { kind: 'timeout', retryable: true })
  });
  assert.equal(pool.calls[0].params[0], 'PENDING');
  assert.equal(pool.calls[0].params[4], 10);
});

test('provider maintenance honours Retry-After without exhausting the card retry budget', async () => {
  const pool = recordingPool();
  await failCardSyncJob(pool, {
    job: { id: 'job-3', card_id: 'card-3', attempts: 5, maxAttempts: 5, sync_tier: 'AVAILABLE' },
    workerId: 'worker-3',
    error: Object.assign(new Error('maintenance'), {
      kind: 'maintenance', retryable: true, retryAfterMs: 300_000
    })
  });
  assert.equal(pool.calls[0].params[0], 'PENDING');
  assert.equal(pool.calls[0].params[1], 1);
  assert.equal(pool.calls[0].params[4], 300);
  assert.match(pool.calls[0].sql, /attempts = GREATEST\(0, attempts - \?\)/);
});

// 第④步：定时同步只排有只读 API 的卡；MANUAL_IMPORT（备用卡台 A）和已销终态的卡不排。
test('scheduleDueCardSyncJobs excludes MANUAL_IMPORT and RETIRED cards and uses the 3h fallback for available inventory', async () => {
  const { scheduleDueCardSyncJobs } = await import('../src/services/card-sync-job-service.js');
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      if (flat.startsWith('SELECT setting_value')) return [[{ setting_value: 'true' }]];
      if (flat.startsWith('SELECT c.id FROM cards')) return [[]];
      return [{ affectedRows: 1 }];
    }
  };
  const now = new Date('2026-09-18T12:00:00Z');
  const result = await scheduleDueCardSyncJobs({ getConnection: async () => connection }, { now });
  assert.deepEqual(result, { enabled: true, queued: 0 });
  const select = queries.find((q) => q.sql.startsWith('SELECT c.id FROM cards'));
  assert.match(select.sql, /c\.sync_tier <> 'MANUAL_IMPORT'/);
  assert.match(select.sql, /c\.inventory_status <> 'RETIRED'/);
  assert.equal(select.params[1].toISOString(), '2026-09-18T09:00:00.000Z', 'AVAILABLE/INVENTORY fallback cutoff = now - 3h');
});

// D-401：后台手动同步与定时排队同一口径——MANUAL_IMPORT（highvcc 等）的卡没有只读 API，排了只会问 hnskj、必失败。
function adminJobPool(cards) {
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      if (text.startsWith('SELECT id, provider_card_id, sync_tier FROM cards')) return [cards, []];
      if (text.startsWith('SELECT id FROM card_sync_jobs')) return [[], []];
      if (text.startsWith('INSERT INTO card_sync_jobs')) return [{ affectedRows: 1 }, []];
      throw new Error(`unexpected: ${text.slice(0, 60)}`);
    }
  };
  return { calls, async getConnection() { return connection; } };
}

test('D-401: admin single-card sync refuses a manual-import card; bulk sync only selects cards with a read API', async () => {
  const single = adminJobPool([{ id: 'c-hv', provider_card_id: 'HG-1', sync_tier: 'MANUAL_IMPORT' }]);
  await assert.rejects(createCardSyncJobService({ pool: single }).createJobs({ providerCardId: 'HG-1' }),
    (error) => error.code === 'ADMIN_CARD_NO_READ_API' && error.status === 409);
  assert.equal(single.calls.some(({ sql }) => sql.startsWith('INSERT INTO card_sync_jobs')), false);

  const bulk = adminJobPool([{ id: 'c-hn', provider_card_id: 'HN-1', sync_tier: 'AVAILABLE' }]);
  const result = await createCardSyncJobService({ pool: bulk }).createJobs({});
  assert.deepEqual(result, { requested: 1, queued: 1, alreadyActive: 0 });
  assert.match(bulk.calls[0].sql, /WHERE sync_tier <> 'MANUAL_IMPORT'/);
});

