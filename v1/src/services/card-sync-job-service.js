import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { redactSensitiveText } from '../security/redaction.js';

function safeProviderCardId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 128) {
    throw new PublicApiError('Invalid provider card ID', {
      code: 'INVALID_CARD_SYNC_REQUEST', status: 400
    });
  }
  return id;
}

export function createCardSyncJobService({ pool }) {
  async function createJobs(input = {}) {
    const providerCardId = input.providerCardId == null
      ? null : safeProviderCardId(input.providerCardId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [cards] = providerCardId
        ? await connection.query(
          `SELECT id, provider_card_id FROM cards
           WHERE BINARY provider_card_id = BINARY ? LIMIT 1 FOR UPDATE`,
          [providerCardId]
        )
        : await connection.query(
          `SELECT id, provider_card_id FROM cards
           ORDER BY CASE inventory_status
             WHEN 'PROVISIONING' THEN 0 WHEN 'ASSIGNED' THEN 1
             WHEN 'AVAILABLE' THEN 2 ELSE 3 END, updated_at DESC
           LIMIT 500 FOR UPDATE`
        );
      if (providerCardId && cards.length !== 1) {
        throw new PublicApiError('Card not found', {
          code: 'ADMIN_CARD_NOT_FOUND', status: 404
        });
      }
      let queued = 0;
      let alreadyActive = 0;
      for (const card of cards) {
        const [active] = await connection.query(
          `SELECT id FROM card_sync_jobs
           WHERE card_id = ? AND status IN ('PENDING','RUNNING') LIMIT 1`,
          [card.id]
        );
        if (active.length) {
          alreadyActive += 1;
          continue;
        }
        await connection.query(
          `INSERT INTO card_sync_jobs
           (id, card_id, status, requested_by, dedupe_key)
           VALUES (?, ?, 'PENDING', 'admin', ?)`,
          [crypto.randomUUID(), card.id, `card-sync:${card.id}:${crypto.randomUUID()}`]
        );
        queued += 1;
      }
      await connection.commit();
      return { requested: cards.length, queued, alreadyActive };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  return { createJobs };
}

export async function claimCardSyncJob(pool, { workerId, leaseSeconds = 120 }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE card_sync_jobs
       SET status = IF(attempts < max_attempts, 'PENDING', 'REVIEW_REQUIRED'),
           leased_by = NULL, leased_until = NULL,
           error_code = 'SYNC_LEASE_EXPIRED',
           error_message = '只读同步执行器中断，系统已安全重试。',
           available_at = CURRENT_TIMESTAMP(3)
       WHERE status = 'RUNNING' AND leased_until < CURRENT_TIMESTAMP(3)`
    );
    const [rows] = await connection.query(
      `SELECT j.id, j.card_id, j.attempts, j.max_attempts,
              c.provider_card_id, c.card_type_id, c.funded_amount, c.order_id
       FROM card_sync_jobs j INNER JOIN cards c ON c.id = j.card_id
       WHERE j.status = 'PENDING' AND j.available_at <= CURRENT_TIMESTAMP(3)
       ORDER BY j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!rows.length) {
      await connection.commit();
      return null;
    }
    const job = rows[0];
    const [result] = await connection.query(
      `UPDATE card_sync_jobs SET status = 'RUNNING', attempts = attempts + 1,
         leased_by = ?, leased_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
         error_code = NULL, error_message = NULL
       WHERE id = ? AND status = 'PENDING'`,
      [workerId, leaseSeconds, job.id]
    );
    if (Number(result.affectedRows) !== 1) throw new Error('Card sync job claim lost');
    await connection.commit();
    return { ...job, attempts: Number(job.attempts) + 1, maxAttempts: Number(job.max_attempts) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function completeCardSyncJob(pool, { jobId, workerId }) {
  const [result] = await pool.query(
    `UPDATE card_sync_jobs SET status = 'COMPLETED', leased_by = NULL,
       leased_until = NULL, completed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
    [jobId, workerId]
  );
  if (Number(result.affectedRows) !== 1) throw new Error('Card sync job lease lost');
}

export async function failCardSyncJob(pool, { job, workerId, error }) {
  const retry = job.attempts < job.maxAttempts;
  const code = String(error?.code || error?.kind || 'CARD_SYNC_FAILED').toUpperCase().slice(0, 64);
  const message = redactSensitiveText(error?.message || 'Card sync failed').slice(0, 1000);
  await pool.query(
    `UPDATE card_sync_jobs SET status = ?, leased_by = NULL, leased_until = NULL,
       error_code = ?, error_message = ?,
       available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
       completed_at = IF(? = 'REVIEW_REQUIRED', CURRENT_TIMESTAMP(3), NULL)
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
    [retry ? 'PENDING' : 'REVIEW_REQUIRED', code, message,
      retry ? Math.min(300, 10 * (2 ** (job.attempts - 1))) : 0,
      retry ? 'PENDING' : 'REVIEW_REQUIRED', job.id, workerId]
  );
}
