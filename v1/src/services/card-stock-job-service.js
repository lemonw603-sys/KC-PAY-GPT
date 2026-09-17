import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { redactSensitiveText } from '../security/redaction.js';
import {
  CARD_STOCK_RISK_CONFIRM_THRESHOLD,
  evaluateCardStockRequest,
  readProviderSnapshot,
  snapshotIsFresh
} from './card-provider-snapshot-service.js';
import { cardCatalogIsFresh, readCardCatalogSnapshot } from './card-catalog-snapshot-service.js';
import { CARD_ADAPTER_HNSKJ, resolveCardProviderAccountForAdapter } from './provider-route-service.js';

/**
 * 开卡 job：人工 job（后台按钮）与自动 job（水位调度器）同一张表、同一个执行者
 * （D-247 面二③「三条开卡线合一」）。job 记下「哪台、哪产品」，runner 按台选适配器执行。
 * 自动 job 的建法在 card-supply-scheduler-service.js；这里只剩人工建 job、查 job 与 runner 的租约/状态迁移。
 */

/** 归档后的旧架构残留（965 条 REVIEW_REQUIRED，2026-09-05 前）；不再命中「未解决付费任务」检查。 */
export const ARCHIVED_LEGACY_STATUS = 'ARCHIVED_LEGACY';

/** 预检类失败：没花钱、可安全重试。别的失败（PROVIDER/TIMEOUT/SCHEMA…）可能已经扣了钱，要人看。 */
export const SAFE_PREFLIGHT_CODES = Object.freeze([
  'CARD_STOCK_CARD_TYPE_UNAVAILABLE', 'CARD_STOCK_BALANCE_INSUFFICIENT',
  'CARD_STOCK_LIMIT_INSUFFICIENT', 'CARD_STOCK_AMOUNT_OUT_OF_RANGE',
  'CARD_STOCK_RULES_STALE', 'CARD_CATALOG_STALE', 'CARD_CATALOG_UNRESOLVED',
  'CARD_STOCK_PURCHASE_DISABLED', 'CARD_SUPPLY_WALLET_BELOW_FLOOR',
  'HIGHVCC_TOKEN_MISSING', 'HIGHVCC_TOKEN_EXPIRED'
]);

export function shanghaiDayBounds(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid replenishment clock');
  const shifted = new Date(instant.getTime() + 8 * 60 * 60_000);
  const startShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return [new Date(startShifted - 8 * 60 * 60_000), new Date(startShifted + 24 * 60 * 60_000 - 8 * 60 * 60_000)];
}

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

export function mapJob(row) {
  const rules = typeof row.rules_snapshot_json === 'string'
    ? JSON.parse(row.rules_snapshot_json) : row.rules_snapshot_json;
  return {
    id: row.id,
    status: row.status,
    source: row.job_source || 'MANUAL',
    providerAccountId: row.provider_account_id || null,
    productCode: row.product_code || null,
    fallbackForProviderAccountId: row.fallback_for_provider_account_id || null,
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
    finishedAt: iso(row.finished_at),
    archivedAt: iso(row.archived_at)
  };
}

const JOB_COLUMNS = `id, status, job_source, provider_account_id, product_code, fallback_for_provider_account_id,
  card_type_id, amount, requested_count, opened_count, estimated_total, rules_snapshot_json,
  error_code, error_message, created_at, started_at, finished_at, archived_at`;

/** 「有没有一个已经花过钱、还没人核对过的 job」——有就不许再自动开。 */
export function unresolvedPaidJobsSql() {
  return `SELECT id FROM card_stock_jobs
     WHERE status = 'REVIEW_REQUIRED'
       AND (opened_count > 0 OR error_code IS NULL OR error_code NOT IN (${SAFE_PREFLIGHT_CODES.map((code) => `'${code}'`).join(',')}))
     ORDER BY created_at ASC LIMIT 1`;
}

/** 某台今天（上海日）已开/在开的张数：所有来源都算，这是资金保险丝（D-247 面二⑥）。 */
export async function countTodayOpenings(queryable, { providerAccountId, now = new Date() }) {
  const [[usage]] = await queryable.query(
    `SELECT COALESCE(SUM(CASE
       WHEN status IN ('PENDING','RUNNING') THEN requested_count
       ELSE opened_count END), 0) AS count FROM card_stock_jobs
     WHERE provider_account_id = ? AND created_at >= ? AND created_at < ?`,
    [String(providerAccountId), ...shanghaiDayBounds(now)]
  );
  return Number(usage?.count || 0);
}

export function createCardStockJobService({ pool }) {
  /**
   * 人工开卡（后台按钮）。仍只服务 hnskj 适配器的账户：表单里的卡段、规则快照、目录对账
   * 都是 hnskj Open API 的东西；备用卡台 A 的人工开卡走它自己的同步端点。
   */
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
    const productCode = String(input.productCode || 'plus').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(productCode)) {
      throw new PublicApiError('Invalid product code', { code: 'INVALID_CARD_STOCK_JOB', status: 400 });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const account = await resolveCardProviderAccountForAdapter(connection, CARD_ADAPTER_HNSKJ);
      if (!account) {
        throw new PublicApiError('No healthy card provider account is served by the hnskj adapter', {
          code: 'CARD_PROVIDER_ROUTE_UNAVAILABLE', status: 409
        });
      }
      const cardTypeId = input.cardTypeId == null
        ? String(account.defaultCardSegment || '').trim() : String(input.cardTypeId).trim();
      if (!cardTypeId) {
        throw new PublicApiError('Card type is not configured', {
          code: 'CARD_STOCK_CARD_TYPE_UNAVAILABLE', status: 409
        });
      }
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(cardTypeId)) {
        throw new PublicApiError('Invalid card type', {
          code: 'CARD_STOCK_CARD_TYPE_UNAVAILABLE', status: 400
        });
      }
      const snapshot = await readProviderSnapshot(connection);
      if (!snapshotIsFresh(snapshot)) {
        throw new PublicApiError('Card provider rules are stale', {
          code: 'CARD_STOCK_RULES_STALE', status: 409
        });
      }
      const catalog = await readCardCatalogSnapshot(connection);
      if (!cardCatalogIsFresh(catalog)) {
        throw new PublicApiError('Card catalog reconciliation is stale', {
          code: 'CARD_CATALOG_STALE', status: 409
        });
      }
      if (Number(catalog.unresolvedActive || 0) > 0) {
        throw new PublicApiError('Card catalog has unresolved active cards', {
          code: 'CARD_CATALOG_UNRESOLVED', status: 409
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
         (id, status, job_source, provider_account_id, product_code, card_type_id, amount, estimated_total,
          rules_snapshot_json, requested_count)
         VALUES (?, 'PENDING', 'MANUAL', ?, ?, ?, ?, ?, ?, ?)`,
        [id, account.id, productCode, cardTypeId, String(amount), evaluation.estimatedTotal,
          JSON.stringify(rulesSnapshot), requestedCount]
      );
      await connection.commit();
      return {
        id, status: 'PENDING', source: 'MANUAL', providerAccountId: account.id, productCode,
        cardTypeId, cardTypeName: evaluation.cardType.name,
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
      `SELECT ${JOB_COLUMNS}
       FROM card_stock_jobs WHERE status <> '${ARCHIVED_LEGACY_STATUS}'
       ORDER BY created_at DESC LIMIT ?`,
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
      `SELECT ${JOB_COLUMNS}
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
    return mapJob({ ...job, status: 'RUNNING', started_at: new Date(), finished_at: null,
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
  const safePreflightCodes = new Set(SAFE_PREFLIGHT_CODES);
  let status = 'REVIEW_REQUIRED';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[job]] = await connection.query(
      `SELECT job_source, rules_snapshot_json, opened_count FROM card_stock_jobs
       WHERE id=? AND status='RUNNING' AND leased_by=? FOR UPDATE`,
      [jobId, workerId]
    );
    status = safePreflightCodes.has(code) && Number(job?.opened_count || 0) === 0
      ? 'FAILED' : 'REVIEW_REQUIRED';
    const [result] = await connection.query(
      `UPDATE card_stock_jobs SET status = ?, error_code = ?, error_message = ?,
         leased_by = NULL, leased_until = NULL, finished_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'RUNNING' AND leased_by = ?`,
      [status, code, message, jobId, workerId]
    );
    if (Number(result.affectedRows) !== 1) throw new Error('Card stock job lease lost before failure');
    const rules = typeof job?.rules_snapshot_json === 'string'
      ? JSON.parse(job.rules_snapshot_json) : job?.rules_snapshot_json;
    const demandOrderId = rules?.demandOrderId || null;
    if (job?.job_source === 'AUTOMATIC' && demandOrderId) {
      await connection.query(
        `INSERT INTO operator_alerts
         (id, alert_type, dedupe_key, order_id, severity, title, message, status)
         VALUES (UUID(), 'ORDER_WAITING_FOR_CARD', ?, ?, 'warning', '自动补卡未完成', ?, 'OPEN')
         ON DUPLICATE KEY UPDATE severity=VALUES(severity), title=VALUES(title),
           message=VALUES(message), status=IF(status='RESOLVED','OPEN',status),
           acknowledged_at=IF(status='RESOLVED',NULL,acknowledged_at)`,
        [`order-waiting-card:${demandOrderId}`, demandOrderId,
          `自动补卡暂未完成（${code}）；系统会在条件恢复后继续尝试。`]
      );
    }
    await connection.commit();
  } catch (failure) {
    await connection.rollback();
    throw failure;
  } finally {
    connection.release();
  }
  return { status, code };
}
