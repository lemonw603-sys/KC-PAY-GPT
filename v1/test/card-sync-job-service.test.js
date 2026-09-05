import assert from 'node:assert/strict';
import test from 'node:test';
import { failCardSyncJob } from '../src/services/card-sync-job-service.js';

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
