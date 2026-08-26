import { randomUUID } from 'node:crypto';
import { redactSensitiveFields } from '../security/redaction.js';

const CASE_STATUSES = new Set(['OPEN', 'ASSIGNED', 'RESOLVED']);
const CASE_SEVERITIES = new Set(['info', 'warning', 'critical']);
const MAX_PAGE_SIZE = 100;

export class ReconciliationCaseError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'ReconciliationCaseError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requiredString(value, name, code = 'INVALID_ARGUMENT', maxLength = 191) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new ReconciliationCaseError(`${name} is required`, code);
  if (normalized.length > maxLength) {
    throw new ReconciliationCaseError(`${name} is too long`, code, { maxLength });
  }
  return normalized;
}

function optionalString(value, maxLength) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeSeverity(value = 'warning') {
  const severity = String(value || 'warning').trim();
  if (!CASE_SEVERITIES.has(severity)) {
    throw new ReconciliationCaseError('invalid reconciliation case severity', 'INVALID_SEVERITY');
  }
  return severity;
}

function normalizeStatus(value = 'OPEN') {
  const status = String(value || 'OPEN').trim().toUpperCase();
  if (!CASE_STATUSES.has(status)) {
    throw new ReconciliationCaseError('invalid reconciliation case status', 'INVALID_STATUS');
  }
  return status;
}

function jsonValue(value) {
  if (value == null) return null;
  return JSON.stringify(redactSensitiveFields(value));
}

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function mapCase(row, { includeEvidence = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    caseType: row.case_type,
    status: row.status,
    severity: row.severity,
    dedupeKey: row.dedupe_key,
    orderId: row.order_id,
    publicNo: row.public_no ?? null,
    cardId: row.card_id,
    rechargeAttemptId: row.recharge_attempt_id,
    providerAccountId: row.provider_account_id,
    ...(includeEvidence ? { evidence: parseJson(row.evidence_json) } : {}),
    assignedTo: row.assigned_to,
    resolutionNote: row.resolution_note,
    detectedAt: iso(row.detected_at),
    resolvedAt: iso(row.resolved_at),
    lastSeenAt: iso(row.last_seen_at)
  };
}

function normalizeListInput(input = {}) {
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    throw new ReconciliationCaseError('invalid page', 'INVALID_PAGE');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ReconciliationCaseError('invalid page size', 'INVALID_PAGE_SIZE');
  }
  const status = input.status == null || input.status === '' ? null : normalizeStatus(input.status);
  const severity = input.severity == null || input.severity === '' ? null : normalizeSeverity(input.severity);
  const caseType = input.caseType == null || input.caseType === '' ? null
    : requiredString(input.caseType, 'caseType', 'INVALID_CASE_TYPE', 64);
  const assignedTo = input.assignedTo == null || input.assignedTo === '' ? null
    : requiredString(input.assignedTo, 'assignedTo', 'INVALID_ASSIGNEE', 128);
  return { page, pageSize, status, severity, caseType, assignedTo };
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

async function getCaseById(connection, id, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT rc.*, o.public_no
     FROM reconciliation_cases rc
     LEFT JOIN orders o ON o.id = rc.order_id
     WHERE rc.id = ?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return mapCase(rows[0]);
}

export function createReconciliationCaseService({
  pool,
  idFactory = randomUUID,
  now = () => new Date()
} = {}) {
  if (!pool?.query || !pool?.getConnection) {
    throw new Error('Reconciliation case service requires a MySQL pool');
  }

  async function upsertCase(input = {}) {
    const id = input.id || idFactory();
    const caseType = requiredString(input.caseType, 'caseType', 'INVALID_CASE_TYPE', 64);
    const dedupeKey = requiredString(input.dedupeKey, 'dedupeKey', 'INVALID_DEDUPE_KEY', 191);
    const severity = normalizeSeverity(input.severity || 'warning');
    const detectedAt = input.detectedAt || now();
    const status = normalizeStatus(input.status || 'OPEN');
    if (status === 'RESOLVED') {
      throw new ReconciliationCaseError('new detections cannot be inserted as RESOLVED', 'INVALID_STATUS');
    }

    return inTransaction(pool, async (connection) => {
      await connection.query(
        `INSERT INTO reconciliation_cases
         (id, case_type, status, severity, dedupe_key, order_id, card_id,
          recharge_attempt_id, provider_account_id, evidence_json,
          detected_at, last_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           last_seen_at = VALUES(last_seen_at),
           updated_at = IF(status = 'RESOLVED', updated_at, VALUES(updated_at)),
           case_type = IF(status = 'RESOLVED', case_type, VALUES(case_type)),
           severity = IF(status = 'RESOLVED', severity, VALUES(severity)),
           order_id = IF(status = 'RESOLVED', order_id, VALUES(order_id)),
           card_id = IF(status = 'RESOLVED', card_id, VALUES(card_id)),
           recharge_attempt_id = IF(status = 'RESOLVED', recharge_attempt_id, VALUES(recharge_attempt_id)),
           provider_account_id = IF(status = 'RESOLVED', provider_account_id, VALUES(provider_account_id)),
           evidence_json = IF(status = 'RESOLVED', evidence_json, VALUES(evidence_json))`,
        [id, caseType, status, severity, dedupeKey,
          input.orderId || null, input.cardId || null, input.rechargeAttemptId || null,
          input.providerAccountId || null, jsonValue(input.evidence), detectedAt, detectedAt, detectedAt]
      );
      const [rows] = await connection.query(
        `SELECT rc.*, o.public_no
         FROM reconciliation_cases rc
         LEFT JOIN orders o ON o.id = rc.order_id
         WHERE rc.dedupe_key = ?
         LIMIT 1`,
        [dedupeKey]
      );
      return mapCase(rows[0], { includeEvidence: true });
    });
  }

  async function listCases(input = {}) {
    const { page, pageSize, status, severity, caseType, assignedTo } = normalizeListInput(input);
    const conditions = [];
    const values = [];
    if (status) { conditions.push('rc.status = ?'); values.push(status); }
    if (severity) { conditions.push('rc.severity = ?'); values.push(severity); }
    if (caseType) { conditions.push('rc.case_type = ?'); values.push(caseType); }
    if (assignedTo) { conditions.push('rc.assigned_to = ?'); values.push(assignedTo); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;
    const [rows] = await pool.query(
      `SELECT rc.*, o.public_no
       FROM reconciliation_cases rc
       LEFT JOIN orders o ON o.id = rc.order_id
       ${where}
       ORDER BY FIELD(rc.status, 'OPEN', 'ASSIGNED', 'RESOLVED'),
                FIELD(rc.severity, 'critical', 'warning', 'info'),
                COALESCE(rc.last_seen_at, rc.detected_at) DESC, rc.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM reconciliation_cases rc
       ${where}`,
      values
    );
    const total = Number(countRows[0]?.total || 0);
    return {
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
      cases: rows.map(mapCase)
    };
  }

  async function assign({ id, assignedTo, now: assignedAt = now() } = {}) {
    const caseId = requiredString(id, 'id', 'INVALID_CASE_ID', 36);
    const assignee = requiredString(assignedTo, 'assignedTo', 'INVALID_ASSIGNEE', 128);
    return inTransaction(pool, async (connection) => {
      const existing = await getCaseById(connection, caseId, { forUpdate: true });
      if (!existing) throw new ReconciliationCaseError('reconciliation case not found', 'CASE_NOT_FOUND');
      if (existing.status === 'RESOLVED') {
        throw new ReconciliationCaseError('resolved reconciliation case cannot be assigned', 'CASE_ALREADY_RESOLVED');
      }
      await connection.query(
        `UPDATE reconciliation_cases
         SET status = 'ASSIGNED', assigned_to = ?, updated_at = ?
         WHERE id = ? AND status <> 'RESOLVED'`,
        [assignee, assignedAt, caseId]
      );
      return getCaseById(connection, caseId);
    });
  }

  async function resolve({ id, resolutionNote, now: resolvedAt = now() } = {}) {
    const caseId = requiredString(id, 'id', 'INVALID_CASE_ID', 36);
    const note = requiredString(resolutionNote, 'resolutionNote', 'INVALID_RESOLUTION_NOTE', 1000);
    return inTransaction(pool, async (connection) => {
      const existing = await getCaseById(connection, caseId, { forUpdate: true });
      if (!existing) throw new ReconciliationCaseError('reconciliation case not found', 'CASE_NOT_FOUND');
      if (existing.status !== 'RESOLVED') {
        await connection.query(
          `UPDATE reconciliation_cases
           SET status = 'RESOLVED', resolution_note = ?, resolved_at = ?, updated_at = ?
           WHERE id = ? AND status <> 'RESOLVED'`,
          [note, resolvedAt, resolvedAt, caseId]
        );
      } else if (!existing.resolutionNote) {
        await connection.query(
          `UPDATE reconciliation_cases
           SET resolution_note = ?, updated_at = ?
           WHERE id = ? AND status = 'RESOLVED' AND resolution_note IS NULL`,
          [note, resolvedAt, caseId]
        );
      }
      return getCaseById(connection, caseId);
    });
  }

  return { upsertCase, listCases, assign, resolve };
}
