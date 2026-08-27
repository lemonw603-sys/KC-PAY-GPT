import { createHash, randomBytes } from 'node:crypto';

export class BrowserDispatchError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'BrowserDispatchError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BrowserDispatchError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

function hash(value) {
  return createHash('sha256').update(required(value, 'leaseToken')).digest('hex');
}

async function inTransaction(pool, action, { timeoutMs = 5000 } = {}) {
  let acquireTimer;
  const acquire = pool.getConnection();
  const connection = await Promise.race([
    acquire,
    new Promise((_, reject) => {
      acquireTimer = setTimeout(() => reject(Object.assign(new Error('database connection deadline exceeded'), { code: 'DB_QUERY_TIMEOUT' })), timeoutMs);
    })
  ]).catch((error) => {
    if (error?.code === undefined && /No connections available/i.test(error?.message || '')) error.code = 'DB_POOL_EXHAUSTED';
    // mysql2 keeps a timed-out acquire in its internal wait queue. If it is
    // eventually fulfilled, destroy that late connection instead of leaking
    // it back into the pool after the caller has already retried.
    if (error?.code === 'DB_QUERY_TIMEOUT') acquire.then((lateConnection) => lateConnection.destroy()).catch(() => {});
    throw error;
  });
  clearTimeout(acquireTimer);
  let timedOut = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      connection.destroy();
      reject(Object.assign(new Error('database transaction deadline exceeded'), { code: 'DB_QUERY_TIMEOUT' }));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([(async () => {
      await connection.beginTransaction();
      const value = await action(connection);
      await connection.commit();
      return value;
    })(), timeout]);
    return result;
  } catch (error) {
    if (!timedOut) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    if (!timedOut) connection.release();
  }
}

function isRetryableLockError(error) {
  return error?.code === 'DB_QUERY_TIMEOUT'
    || error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213
    || error?.code === 'ER_LOCK_WAIT_TIMEOUT' || error?.errno === 1205
    || ['PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
      'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ER_SERVER_GONE_ERROR'].includes(error?.code);
}

function isAmbiguousTransactionError(error) {
  return error?.code === 'DB_QUERY_TIMEOUT'
    || ['PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
      'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ER_SERVER_GONE_ERROR'].includes(error?.code);
}

async function inTransactionWithLockRetry(pool, action, {
  maxAttempts = 3,
  baseDelayMs = 5,
  timeoutMs = 5000,
  retryAmbiguous = true
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await inTransaction(pool, action, { timeoutMs });
    } catch (error) {
      if (!isRetryableLockError(error) || (!retryAmbiguous && isAmbiguousTransactionError(error))
        || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw new Error('unreachable');
}

async function queryWithTransientRetry(pool, sql, values, { maxAttempts = 3, baseDelayMs = 5 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let acquireTimer;
      const acquire = pool.getConnection();
      const connection = await Promise.race([
        acquire,
        new Promise((_, reject) => {
          acquireTimer = setTimeout(() => reject(Object.assign(new Error('database connection deadline exceeded'), { code: 'DB_QUERY_TIMEOUT' })), 5000);
        })
      ]).catch((error) => {
        if (error?.code === undefined && /No connections available/i.test(error?.message || '')) error.code = 'DB_POOL_EXHAUSTED';
        if (error?.code === 'DB_QUERY_TIMEOUT') acquire.then((lateConnection) => lateConnection.destroy()).catch(() => {});
        throw error;
      });
      clearTimeout(acquireTimer);
      let timedOut = false;
      let timer;
      const query = connection.query(sql, values);
      try {
        return await Promise.race([
          query,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              connection.destroy();
              reject(Object.assign(new Error('database query deadline exceeded'), { code: 'DB_QUERY_TIMEOUT' }));
            }, 5000);
          })
        ]);
      } finally {
        clearTimeout(timer);
        query.catch(() => {});
        if (!timedOut) connection.release();
      }
    } catch (error) {
      if (!isRetryableLockError(error) || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw new Error('unreachable');
}

function publicJob(row, extra = {}) {
  return {
    jobId: row.id,
    jobKey: row.job_key,
    attemptId: row.recharge_attempt_id,
    orderId: row.order_id,
    executorProfileId: row.executor_profile_id,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    ...extra
  };
}

export function createBrowserDispatchRepository(pool, { transactionTimeoutMs = 5000 } = {}) {
  return {
    async enqueue({ jobKey, attemptId, orderId, executorProfileId = null, now = new Date() }) {
      const key = required(jobKey, 'jobKey');
      const attempt = required(attemptId, 'attemptId');
      const order = required(orderId, 'orderId');
      // Enqueue is a database-only, idempotent operation. A bounded retry is
      // safe after a deadlock/lock-wait rollback; browser/payment actions are
      // never executed from this transaction.
      return inTransactionWithLockRetry(pool, async (connection) => {
        const [existing] = await connection.query(
          `SELECT id, job_key, recharge_attempt_id, order_id, executor_profile_id,
                  status, attempt_count
           FROM browser_dispatch_jobs
           WHERE job_key = ? OR recharge_attempt_id = ?
           FOR UPDATE`,
          [key, attempt]
        );
        if (existing.length) {
          const row = existing[0];
          if (row.job_key !== key || row.recharge_attempt_id !== attempt || row.order_id !== order) {
            throw new BrowserDispatchError('dispatch key belongs to another attempt', 'DISPATCH_KEY_CONFLICT');
          }
          return publicJob(row, { idempotentReplay: true });
        }
        const [contexts] = await connection.query(
          `SELECT rat.id AS recharge_attempt_id, rat.order_id,
                  rat.executor_kind, rat.executor_profile_id, rat.status AS attempt_status,
                  rat.funds_risk_state, o.status AS order_status
           FROM recharge_attempts rat
           INNER JOIN orders o ON o.id = rat.order_id
           WHERE rat.id = ? AND rat.order_id = ?
           FOR UPDATE`,
          [attempt, order]
        );
        if (contexts.length !== 1) throw new BrowserDispatchError('Browser attempt not found', 'ATTEMPT_NOT_FOUND');
        const context = contexts[0];
        if (context.executor_kind !== 'BROWSER') {
          throw new BrowserDispatchError('attempt is not routed to Browser', 'EXECUTOR_KIND_MISMATCH');
        }
        if (context.attempt_status !== 'PREPARED' || context.funds_risk_state !== 'ACTIVE'
          || context.order_status !== 'RECHARGE_PROCESSING') {
          throw new BrowserDispatchError('Browser attempt is not dispatchable', 'ATTEMPT_NOT_READY');
        }
        const profile = executorProfileId || context.executor_profile_id || null;
        const [inserted] = await connection.query(
          `INSERT INTO browser_dispatch_jobs
           (job_key, recharge_attempt_id, order_id, executor_profile_id, status, queued_at)
           VALUES (?, ?, ?, ?, 'QUEUED', ?)`,
          [key, attempt, order, profile, now]
        );
        return {
          jobId: inserted.insertId,
          jobKey: key,
          attemptId: attempt,
          orderId: order,
          executorProfileId: profile,
          status: 'QUEUED',
          attemptCount: 0,
          idempotentReplay: false
        };
      }, { timeoutMs: transactionTimeoutMs });
    },

    async claim({ workerId, executorProfileId = null, leaseSeconds = 60, now = new Date() }) {
      const worker = required(workerId, 'workerId');
      const profile = executorProfileId == null
        ? null : required(executorProfileId, 'executorProfileId');
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
        throw new BrowserDispatchError('leaseSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      // A claim has no caller-supplied idempotency key. If the transaction
      // outcome is ambiguous, retrying could claim a second job while the
      // first lease is already committed but its response was lost. Only
      // errors that MySQL explicitly rolls back may be retried here.
      return inTransactionWithLockRetry(pool, async (connection) => {
        const profilePredicate = profile
          ? 'AND (bdj.executor_profile_id IS NULL OR bdj.executor_profile_id = ?)'
          : '';
        const [rows] = await connection.query(
          `SELECT bdj.id, bdj.job_key, bdj.recharge_attempt_id, bdj.order_id,
                  bdj.executor_profile_id, bdj.status, bdj.attempt_count
           FROM browser_dispatch_jobs bdj
           INNER JOIN recharge_attempts rat ON rat.id = bdj.recharge_attempt_id
           INNER JOIN orders o ON o.id = bdj.order_id
           WHERE (bdj.status = 'QUEUED'
                  OR (bdj.status = 'CLAIMED' AND bdj.lease_until <= ?))
             AND rat.executor_kind = 'BROWSER'
             AND rat.status = 'PREPARED' AND rat.funds_risk_state = 'ACTIVE'
             AND o.status = 'RECHARGE_PROCESSING'
             ${profilePredicate}
           ORDER BY bdj.queued_at, bdj.id
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
          profile ? [now, profile] : [now]
        );
        if (!rows.length) return null;
        const row = rows[0];
        const leaseToken = randomBytes(32).toString('hex');
        const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
        await connection.query(
          `UPDATE browser_dispatch_jobs
           SET status = 'CLAIMED', executor_profile_id = COALESCE(executor_profile_id, ?),
               lease_owner = ?, lease_token_hash = ?, lease_until = ?,
               attempt_count = attempt_count + 1, claimed_at = COALESCE(claimed_at, ?), updated_at = ?
           WHERE id = ? AND (status = 'QUEUED' OR (status = 'CLAIMED' AND lease_until <= ?))`,
          [profile, worker, hash(leaseToken), leaseUntil, now, now, row.id, now]
        );
        return publicJob({
          ...row,
          executor_profile_id: row.executor_profile_id || profile,
          status: 'CLAIMED',
          attempt_count: Number(row.attempt_count || 0) + 1,
        }, {
          leaseToken, leaseUntil, leaseOwner: worker
        });
      }, { timeoutMs: transactionTimeoutMs, retryAmbiguous: false });
    },

    async heartbeat({ jobId, workerId, leaseToken, leaseSeconds = 60, now = new Date() }) {
      const id = required(jobId, 'jobId');
      const worker = required(workerId, 'workerId');
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
        throw new BrowserDispatchError('leaseSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      const until = new Date(now.getTime() + leaseSeconds * 1000);
      const [result] = await queryWithTransientRetry(pool,
        `UPDATE browser_dispatch_jobs
         SET lease_until = ?, updated_at = ?
         WHERE id = ? AND status = 'CLAIMED' AND lease_owner = ?
           AND lease_token_hash = ? AND lease_until > ?`,
        [until, now, id, worker, hash(leaseToken), now]
      );
      if (result.affectedRows !== 1) throw new BrowserDispatchError('dispatch lease is not owned', 'LEASE_NOT_OWNED');
      return { jobId: id, leaseUntil: until };
    },

    async complete({ jobId, workerId, leaseToken, now = new Date() }) {
      const id = required(jobId, 'jobId');
      const worker = required(workerId, 'workerId');
      return inTransactionWithLockRetry(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT bdj.id, bdj.status, bdj.lease_owner, bdj.lease_token_hash,
                  br.status AS run_status
           FROM browser_dispatch_jobs bdj
           INNER JOIN browser_runs br ON br.recharge_attempt_id = bdj.recharge_attempt_id
           WHERE bdj.id = ?
           ORDER BY br.run_no DESC
           LIMIT 1 FOR UPDATE`,
          [id]
        );
        if (rows.length !== 1) throw new BrowserDispatchError('dispatch job not found', 'JOB_NOT_FOUND');
        const row = rows[0];
        if (row.status === 'COMPLETED') return { jobId: id, status: 'COMPLETED', idempotentReplay: true };
        if (row.status !== 'CLAIMED' || row.lease_owner !== worker
          || row.lease_token_hash !== hash(leaseToken)) {
          throw new BrowserDispatchError('dispatch lease is not owned', 'LEASE_NOT_OWNED');
        }
        if (row.run_status !== 'COMPLETED') {
          throw new BrowserDispatchError('Browser run is not terminally completed', 'RUN_NOT_COMPLETED');
        }
        const [updated] = await connection.query(
          `UPDATE browser_dispatch_jobs
           SET status = 'COMPLETED', completed_at = ?, lease_owner = NULL,
               lease_token_hash = NULL, lease_until = NULL, updated_at = ?
           WHERE id = ? AND status = 'CLAIMED' AND lease_owner = ? AND lease_token_hash = ?`,
          [now, now, id, worker, hash(leaseToken)]
        );
        if (updated.affectedRows !== 1) throw new BrowserDispatchError('dispatch job changed concurrently', 'JOB_CONFLICT');
        return { jobId: id, status: 'COMPLETED', idempotentReplay: false };
      }, { timeoutMs: transactionTimeoutMs });
    }
  };
}
