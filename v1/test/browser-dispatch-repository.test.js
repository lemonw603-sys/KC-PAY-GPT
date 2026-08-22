import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const digest = (c) => c.repeat(64);

function poolFor(responder) {
  const calls = [];
  const transaction = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { transaction.began += 1; },
    async commit() { transaction.committed += 1; },
    async rollback() { transaction.rolledBack += 1; },
    release() { transaction.released += 1; },
    async query(sql, values = []) { calls.push({ sql, values }); return responder(sql, values); }
  };
  return { calls, transaction, async getConnection() { return connection; }, async query(sql, values = []) {
    calls.push({ sql, values }); return responder(sql, values);
  } };
}

test('enqueue is idempotent and stores only Browser references', async () => {
  let existing = false;
  const pool = poolFor((sql) => {
    if (/FROM browser_dispatch_jobs/.test(sql)) {
      return existing
        ? [[{ id: 4, job_key: 'browser-attempt:1', recharge_attempt_id: 'attempt-1', order_id: 'order-1', executor_profile_id: null, status: 'QUEUED', attempt_count: 0 }], []]
        : [[], []];
    }
    if (/FROM recharge_attempts/.test(sql)) return [[{
      recharge_attempt_id: 'attempt-1', order_id: 'order-1', executor_kind: 'BROWSER',
      executor_profile_id: null, attempt_status: 'PREPARED', funds_risk_state: 'ACTIVE', order_status: 'SUBMITTING'
    }], []];
    if (/INSERT INTO browser_dispatch_jobs/.test(sql)) { existing = true; return [{ insertId: 4 }, []]; }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const repository = createBrowserDispatchRepository(pool);
  const first = await repository.enqueue({ jobKey: 'browser-attempt:1', attemptId: 'attempt-1', orderId: 'order-1' });
  const second = await repository.enqueue({ jobKey: 'browser-attempt:1', attemptId: 'attempt-1', orderId: 'order-1' });
  assert.equal(first.idempotentReplay, false);
  assert.equal(second.idempotentReplay, true);
  assert.equal(pool.calls.filter(({ sql }) => /INSERT INTO browser_dispatch_jobs/.test(sql)).length, 1);
});

test('claim uses an expiring lease and never returns sensitive payload fields', async () => {
  const pool = poolFor((sql) => {
    if (/FROM browser_dispatch_jobs bdj/.test(sql)) return [[{
      id: 4, job_key: 'browser-attempt:1', recharge_attempt_id: 'attempt-1', order_id: 'order-1',
      executor_profile_id: 'profile-1', status: 'QUEUED', attempt_count: 0
    }], []];
    return [{ affectedRows: 1 }, []];
  });
  const result = await createBrowserDispatchRepository(pool).claim({ workerId: 'worker-1' });
  assert.equal(result.status, 'CLAIMED');
  assert.match(result.leaseToken, /^[a-f0-9]{64}$/);
  assert.equal('session' in result, false);
  assert.equal('cardNumber' in result, false);
  assert.equal('checkoutUrl' in result, false);
});

test('heartbeat rejects an invalid lease without changing state', async () => {
  const pool = poolFor(() => [{ affectedRows: 0 }, []]);
  await assert.rejects(
    createBrowserDispatchRepository(pool).heartbeat({
      jobId: 4, workerId: 'worker-1', leaseToken: 'bad'
    }),
    (error) => error.code === 'LEASE_NOT_OWNED'
  );
});

test('complete requires an owned lease and a terminal Browser run', async () => {
  const token = 'lease-token';
  const crypto = await import('node:crypto');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const pool = poolFor((sql) => {
    if (/FROM browser_dispatch_jobs bdj/.test(sql)) return [[{
      id: 4, status: 'CLAIMED', lease_owner: 'worker-1', lease_token_hash: tokenHash, run_status: 'COMPLETED'
    }], []];
    return [{ affectedRows: 1 }, []];
  });
  const result = await createBrowserDispatchRepository(pool).complete({
    jobId: 4, workerId: 'worker-1', leaseToken: token
  });
  assert.equal(result.status, 'COMPLETED');
  assert.match(pool.calls.at(-1).sql, /status = 'COMPLETED'/);
});
