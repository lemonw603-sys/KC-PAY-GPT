import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { redactSensitiveText } from '../security/redaction.js';
import {
  CardSyncTier,
  initialSyncTier,
  nextCardSyncAt,
  normalizeCardSyncTier
} from '../domain/card-sync-policy.js';

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

export async function scheduleDueCardSyncJobs(pool, {
  staleMinutes = 60,
  limit = 100,
  now = new Date()
} = {}) {
  const interval = Number(staleMinutes);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  if (!Number.isInteger(interval) || interval < 15 || interval > 24 * 60) {
    throw new TypeError('staleMinutes must be an integer from 15 to 1440');
  }
  const cutoff = new Date(now.getTime() - interval * 60_000);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [settings] = await connection.query(
      `SELECT setting_value FROM app_settings
       WHERE setting_key = 'sync_card_transactions' LIMIT 1 FOR SHARE`
    );
    if (settings[0]?.setting_value !== 'true') {
      await connection.commit();
      return { enabled: false, queued: 0 };
    }
    const [cards] = await connection.query(
      `SELECT c.id FROM cards c
       LEFT JOIN orders o ON o.id = c.order_id
       WHERE c.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
         AND (
           c.next_sync_at <= ?
           OR (c.next_sync_at IS NULL AND (c.last_transaction_synced_at IS NULL OR c.last_transaction_synced_at < ?))
         )
         AND NOT EXISTS (
           SELECT 1 FROM card_sync_jobs j
           WHERE j.card_id = c.id AND j.status IN ('PENDING','RUNNING')
         )
       ORDER BY CASE c.sync_tier
         WHEN 'RECHARGE_PROCESSING' THEN 10 WHEN 'PROVISIONING' THEN 20
         WHEN 'ASSIGNED' THEN 30 WHEN 'RECENT_TERMINAL' THEN 40
         WHEN 'INVENTORY' THEN 50 WHEN 'AVAILABLE' THEN 50
         WHEN 'REFUND_WATCH' THEN 60 WHEN 'ARCHIVED' THEN 70 ELSE 55 END,
         COALESCE(c.next_sync_at, c.last_transaction_synced_at, c.created_at) ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [now, cutoff, safeLimit]
    );
    const bucket = Math.floor(now.getTime() / (interval * 60_000));
    let queued = 0;
    for (const card of cards) {
      const [result] = await connection.query(
        `INSERT INTO card_sync_jobs
         (id, card_id, status, requested_by, dedupe_key)
         VALUES (?, ?, 'PENDING', 'scheduler', ?)
         ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key)`,
        [crypto.randomUUID(), card.id, `scheduled-card-sync:${card.id}:${bucket}`]
      );
      if (Number(result.affectedRows) === 1) queued += 1;
    }
    await connection.commit();
    return { enabled: true, queued };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
              c.provider_card_id, c.provider_account_id, c.card_type_id,
              c.funded_amount, c.order_id, c.sync_tier,
              o.status AS order_status
       FROM card_sync_jobs j INNER JOIN cards c ON c.id = j.card_id
       LEFT JOIN orders o ON o.id = c.order_id
       WHERE j.status = 'PENDING' AND j.available_at <= CURRENT_TIMESTAMP(3)
       ORDER BY CASE c.sync_tier
         WHEN 'RECHARGE_PROCESSING' THEN 10 WHEN 'PROVISIONING' THEN 20
         WHEN 'ASSIGNED' THEN 30 WHEN 'RECENT_TERMINAL' THEN 40
         WHEN 'INVENTORY' THEN 50 WHEN 'AVAILABLE' THEN 50
         WHEN 'REFUND_WATCH' THEN 60 WHEN 'ARCHIVED' THEN 70 ELSE 55 END,
         j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
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

export async function completeCardSyncJob(pool, { jobId, workerId, now = new Date() }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT j.card_id, c.inventory_status, o.status AS order_status
       FROM card_sync_jobs j INNER JOIN cards c ON c.id = j.card_id
       LEFT JOIN orders o ON o.id = c.order_id
       WHERE j.id = ? AND j.status = 'RUNNING' AND j.leased_by = ? FOR UPDATE`,
      [jobId, workerId]
    );
    if (rows.length !== 1) throw new Error('Card sync job lease lost');
    const tier = initialSyncTier({
      inventoryStatus: rows[0].inventory_status,
      orderStatus: rows[0].order_status
    });
    const [result] = await connection.query(
      `UPDATE card_sync_jobs SET status = 'COMPLETED', leased_by = NULL,
         leased_until = NULL, completed_at = ?
       WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
      [now, jobId, workerId]
    );
    if (Number(result.affectedRows) !== 1) throw new Error('Card sync job lease lost');
    await connection.query(
      `UPDATE cards SET sync_tier = ?, next_sync_at = ?,
         sync_consecutive_failures = 0, last_successful_sync_at = ?,
         updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [tier, nextCardSyncAt({ tier, now }), now, rows[0].card_id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function failCardSyncJob(pool, { job, workerId, error }) {
  const retry = job.attempts < job.maxAttempts && error?.retryable !== false;
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
  // Keep the tier frozen at claim time. Re-deriving it from a tier string as if
  // it were an inventory status incorrectly demotes RECENT_TERMINAL and
  // REFUND_WATCH cards. INVENTORY is the one legacy migration alias.
  const tier = job.sync_tier === 'INVENTORY'
    ? CardSyncTier.AVAILABLE
    : (() => {
        try { return normalizeCardSyncTier(job.sync_tier); }
        catch { return CardSyncTier.ARCHIVED; }
      })();
  await pool.query(
    `UPDATE cards SET sync_consecutive_failures = sync_consecutive_failures + 1,
       next_sync_at = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [nextCardSyncAt({
      tier,
      consecutiveFailures: Number(job.attempts || 1),
      retryAfterMs: error?.retryAfterMs ?? null
    }), job.card_id]
  );
}
