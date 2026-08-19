import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { redactSensitiveText } from '../security/redaction.js';
import {
  CARD_STOCK_RISK_CONFIRM_THRESHOLD,
  evaluateCardStockRequest,
  readProviderSnapshot,
  snapshotIsFresh
} from './card-provider-snapshot-service.js';

function integer(value, { min, max, name }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new PublicApiError(`Invalid ${name}`, { code: 'INVALID_CARD_STOCK_JOB', status: 400 });
  }
  return number;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function mapJob(row) {
  const rules = typeof row.rules_snapshot_json === 'string'
    ? JSON.parse(row.rules_snapshot_json) : row.rules_snapshot_json;
  return {
    id: row.id,
    status: row.status,
    cardTypeId: String(row.card_type_id),
    amount: String(row.amount),
    estimatedTotal: row.estimated_total == null ? null : String(row.estimated_total),
    cardTypeName: rules?.cardType?.name || null,
    rulesSnapshot: rules || null,
    requestedCount: Number(row.requested_count),
    openedCount: Number(row.opened_count),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at)
  };
}

export function createCardStockJobService({ pool }) {
  async function createJob(input = {}) {
    const requestedCount = integer(input.count, { min: 1, max: Number.MAX_SAFE_INTEGER, name: 'count' });
    const amount = integer(input.amount, { min: 1, max: 100_000, name: 'amount' });
    if (input.confirmation !== `开${requestedCount}张`) {
      throw new PublicApiError('Confirmation mismatch', { code: 'CARD_STOCK_CONFIRMATION_REQUIRED', status: 400 });
    }
    if (requestedCount > CARD_STOCK_RISK_CONFIRM_THRESHOLD && input.largeBatchConfirmed !== true) {
      throw new PublicApiError('Large card stock job requires an additional confirmation', {
        code: 'CARD_STOCK_LARGE_BATCH_CONFIRMATION_REQUIRED', status: 400
      });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [settings] = await connection.query(
        `SELECT setting_value FROM app_settings
         WHERE setting_key = 'default_card_type_id' LIMIT 1 FOR SHARE`
      );
      const cardTypeId = String(settings[0]?.setting_value || '').trim();
      if (!cardTypeId) {
        throw new PublicApiError('Default card type is not configured', {
          code: 'CARD_STOCK_CARD_TYPE_UNAVAILABLE', status: 409
        });
      }
      const snapshot = await readProviderSnapshot(connection);
      if (!snapshotIsFresh(snapshot)) {
        throw new PublicApiError('Card provider rules are stale', {
          code: 'CARD_STOCK_RULES_STALE', status: 409
        });
      }
      const evaluation = evaluateCardStockRequest(snapshot, {
        cardTypeId, amount, count: requestedCount
      });
      const [active] = await connection.query(
        `SELECT id FROM card_stock_jobs WHERE status IN ('PENDING','RUNNING') LIMIT 1 FOR UPDATE`
      );
      if (active.length) {
        throw new PublicApiError('A card stock job is already active', {
          code: 'CARD_STOCK_JOB_ACTIVE', status: 409
        });
      }
      const id = crypto.randomUUID();
      const rulesSnapshot = {
        providerSyncedAt: snapshot.syncedAt,
        purchaseEnabled: snapshot.purchaseEnabled,
        accountBalance: snapshot.accountBalance,
        cardLimit: snapshot.cardLimit,
        cardType: evaluation.cardType,
        evaluation
      };
      await connection.query(
        `INSERT INTO card_stock_jobs
         (id, status, card_type_id, amount, estimated_total, rules_snapshot_json, requested_count)
         VALUES (?, 'PENDING', ?, ?, ?, ?, ?)`,
        [id, cardTypeId, String(amount), evaluation.estimatedTotal,
          JSON.stringify(rulesSnapshot), requestedCount]
      );
      await connection.commit();
      return {
        id, status: 'PENDING', cardTypeId, cardTypeName: evaluation.cardType.name,
        amount: String(amount), estimatedTotal: evaluation.estimatedTotal,
        requestedCount, openedCount: 0
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function listJobs({ limit = 20 } = {}) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const [rows] = await pool.query(
      `SELECT id, status, card_type_id, amount, requested_count, opened_count,
              estimated_total, rules_snapshot_json, error_code, error_message,
              created_at, started_at, finished_at
       FROM card_stock_jobs ORDER BY created_at DESC LIMIT ?`,
      [safeLimit]
    );
    return { jobs: rows.map(mapJob) };
  }

  return { createJob, listJobs };
}

export async function claimCardStockJob(pool, { workerId, leaseSeconds = 1800 }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE card_stock_jobs SET status = 'REVIEW_REQUIRED', error_code = 'RUNNER_INTERRUPTED',
         error_message = '执行器中断；为避免重复开卡，必须人工核对后再补剩余数量。',
         leased_by = NULL, leased_until = NULL, finished_at = CURRENT_TIMESTAMP(3)
       WHERE status = 'RUNNING' AND leased_until < CURRENT_TIMESTAMP(3)`
    );
    const [rows] = await connection.query(
      `SELECT id, card_type_id, amount, requested_count, opened_count
              ,estimated_total, rules_snapshot_json
       FROM card_stock_jobs WHERE status = 'PENDING'
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!rows.length) {
      await connection.commit();
      return null;
    }
    const job = rows[0];
    await connection.query(
      `UPDATE card_stock_jobs SET status = 'RUNNING', leased_by = ?,
         leased_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
         started_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'PENDING'`,
      [workerId, leaseSeconds, job.id]
    );
    await connection.commit();
    return mapJob({ ...job, status: 'RUNNING', created_at: null, started_at: new Date(), finished_at: null,
      error_code: null, error_message: null });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateCardStockJobProgress(pool, { jobId, workerId, openedCount }) {
  const [result] = await pool.query(
    `UPDATE card_stock_jobs SET opened_count = GREATEST(opened_count, ?),
       leased_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1800 SECOND)
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
    [openedCount, jobId, workerId]
  );
  if (result.affectedRows !== 1) throw new Error('Card stock job lease lost');
}

export async function completeCardStockJob(pool, { jobId, workerId, openedCount }) {
  const [result] = await pool.query(
    `UPDATE card_stock_jobs SET status = 'COMPLETED', opened_count = ?,
       leased_by = NULL, leased_until = NULL, finished_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
    [openedCount, jobId, workerId]
  );
  if (result.affectedRows !== 1) throw new Error('Card stock job lease lost before completion');
}

export async function failCardStockJob(pool, { jobId, workerId, error }) {
  const code = String(error?.code || error?.kind || 'CARD_STOCK_OPEN_FAILED').toUpperCase().slice(0, 64);
  const message = redactSensitiveText(error?.message || 'Card stock opening failed').slice(0, 1000);
  await pool.query(
    `UPDATE card_stock_jobs SET status = 'REVIEW_REQUIRED', error_code = ?, error_message = ?,
       leased_by = NULL, leased_until = NULL, finished_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
    [code, message, jobId, workerId]
  );
}
