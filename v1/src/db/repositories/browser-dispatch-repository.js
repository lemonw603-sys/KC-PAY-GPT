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

async function inTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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

export function createBrowserDispatchRepository(pool) {
  return {
    async enqueue({ jobKey, attemptId, orderId, executorProfileId = null, now = new Date() }) {
      const key = required(jobKey, 'jobKey');
      const attempt = required(attemptId, 'attemptId');
      const order = required(orderId, 'orderId');
      return inTransaction(pool, async (connection) => {
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
          || context.order_status !== 'SUBMITTING') {
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
      });
    },

    async claim({ workerId, leaseSeconds = 60, now = new Date() }) {
      const worker = required(workerId, 'workerId');
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
        throw new BrowserDispatchError('leaseSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
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
             AND o.status = 'SUBMITTING'
           ORDER BY bdj.queued_at, bdj.id
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [now]
        );
        if (!rows.length) return null;
        const row = rows[0];
        const leaseToken = randomBytes(32).toString('hex');
        const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
        await connection.query(
          `UPDATE browser_dispatch_jobs
           SET status = 'CLAIMED', lease_owner = ?, lease_token_hash = ?, lease_until = ?,
               attempt_count = attempt_count + 1, claimed_at = COALESCE(claimed_at, ?), updated_at = ?
           WHERE id = ? AND (status = 'QUEUED' OR (status = 'CLAIMED' AND lease_until <= ?))`,
          [worker, hash(leaseToken), leaseUntil, now, now, row.id, now]
        );
        return publicJob({ ...row, status: 'CLAIMED', attempt_count: Number(row.attempt_count || 0) + 1 }, {
          leaseToken, leaseUntil, leaseOwner: worker
        });
      });
    },

    async heartbeat({ jobId, workerId, leaseToken, leaseSeconds = 60, now = new Date() }) {
      const id = required(jobId, 'jobId');
      const worker = required(workerId, 'workerId');
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
        throw new BrowserDispatchError('leaseSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      const until = new Date(now.getTime() + leaseSeconds * 1000);
      const [result] = await pool.query(
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
      return inTransaction(pool, async (connection) => {
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
      });
    }
  };
}
