import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../security/secret-box.js';
import {
  CURRENT_CDK_HASH_VERSION,
  GENERATED_CDK_PATTERN,
  hashCurrentCdk
} from '../security/cdk-code.js';

const CDK_PREFIX = 'PJ-';
const CDK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CDK_RANDOM_LENGTH = 20;
const MAX_BATCH_SIZE = 1_000;
const PLAN_TYPES = new Set(['plus']);

export class CdkBatchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CdkBatchError';
    this.code = code;
  }
}

export function normalizePlanType(value = 'plus') {
  const planType = String(value || '').trim().toLowerCase();
  if (!PLAN_TYPES.has(planType)) {
    throw new CdkBatchError('unsupported plan type', 'INVALID_PLAN_TYPE');
  }
  return planType;
}

export function validateBatchCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BATCH_SIZE) {
    throw new CdkBatchError(`count must be an integer between 1 and ${MAX_BATCH_SIZE}`, 'INVALID_COUNT');
  }
  return count;
}

export function normalizeBatchNo(value, {
  now = () => new Date(),
  randomSuffix = () => crypto.randomBytes(3).toString('hex').toUpperCase()
} = {}) {
  const supplied = value == null ? '' : String(value).trim();
  const timestamp = now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const batchNo = supplied || `B-${timestamp}-${randomSuffix()}`;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(batchNo)) {
    throw new CdkBatchError('batch must contain 1-64 letters, digits, underscores or hyphens', 'INVALID_BATCH');
  }
  return batchNo;
}

export function normalizeImportedCdks(text) {
  if (typeof text !== 'string') {
    throw new CdkBatchError('CDK input must be UTF-8 text', 'INVALID_INPUT');
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const unique = [];
  const seen = new Set();
  let nonEmptyCount = 0;
  for (const line of lines) {
    const code = line.trim();
    if (!code) continue;
    nonEmptyCount += 1;
    if (!GENERATED_CDK_PATTERN.test(code)) {
      throw new CdkBatchError(
        `invalid CDK format on non-empty line ${nonEmptyCount}`,
        'INVALID_CDK'
      );
    }
    if (!seen.has(code)) {
      seen.add(code);
      unique.push(code);
    }
  }
  if (nonEmptyCount === 0) {
    throw new CdkBatchError('CDK input contains no codes', 'EMPTY_INPUT');
  }
  if (nonEmptyCount > MAX_BATCH_SIZE) {
    throw new CdkBatchError(`CDK input exceeds ${MAX_BATCH_SIZE} non-empty lines`, 'BATCH_TOO_LARGE');
  }
  return {
    codes: unique,
    inputCount: nonEmptyCount,
    duplicateInputCount: nonEmptyCount - unique.length
  };
}

export function generateCdks(value, { randomInt = crypto.randomInt } = {}) {
  const count = validateBatchCount(value);
  const codes = new Set();
  while (codes.size < count) {
    let suffix = '';
    for (let index = 0; index < CDK_RANDOM_LENGTH; index += 1) {
      suffix += CDK_ALPHABET[randomInt(CDK_ALPHABET.length)];
    }
    const groupedSuffix = suffix.match(/.{1,5}/g).join('-');
    codes.add(`${CDK_PREFIX}${groupedSuffix}`);
  }
  return [...codes];
}

function normalizeRequestKey(value) {
  const requestKey = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new CdkBatchError('a 16-128 character idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return requestKey;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function decodeStoredBatch(row, key, expected = null) {
  if (!row) return null;
  if (expected && (
    Number(row.requested_count) !== expected.count
    || String(row.plan_type) !== expected.planType
  )) {
    throw new CdkBatchError('idempotency key was already used for a different request', 'IDEMPOTENCY_MISMATCH');
  }
  const codes = JSON.parse(decryptSecret(row.codes_ciphertext, key));
  if (!Array.isArray(codes) || codes.length !== Number(row.requested_count)) {
    throw new CdkBatchError('stored CDK batch cannot be recovered', 'BATCH_RECOVERY_FAILED');
  }
  return {
    batchNo: row.batch_no,
    planType: row.plan_type,
    count: Number(row.requested_count),
    codes,
    replayed: true
  };
}

export async function storeCdkBatch(pool, codes, {
  batchNo,
  planType = 'plus',
  requireAllInserted = false,
  cdkHashKey
}) {
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  const normalizedPlanType = normalizePlanType(planType);
  const normalized = normalizeImportedCdks(codes.join('\n'));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const values = normalized.codes.map((code) => [
      crypto.randomUUID(),
      hashCurrentCdk(code, cdkHashKey),
      normalizedBatchNo
    ]);
    const [result] = await connection.query(
      `INSERT IGNORE INTO cdks (id, code_hash, hash_version, status, batch_no, plan_type)
       VALUES ?`,
      [values.map(([id, codeHash, batch]) => [
        id, codeHash, CURRENT_CDK_HASH_VERSION, 'AVAILABLE', batch, normalizedPlanType
      ])]
    );
    const insertedCount = Number(result.affectedRows);
    if (requireAllInserted && insertedCount !== normalized.codes.length) {
      throw new CdkBatchError(
        'generated CDK collision detected; the entire batch was rolled back',
        'GENERATED_COLLISION'
      );
    }
    await connection.commit();
    return {
      batchNo: normalizedBatchNo,
      planType: normalizedPlanType,
      inputCount: normalized.inputCount,
      duplicateInputCount: normalized.duplicateInputCount,
      insertedCount,
      duplicateExistingCount: normalized.codes.length - insertedCount
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createAdminCdkService({ pool, cdkHashKey, cdkRecoveryKey }) {
  if (!pool) throw new TypeError('pool is required');
  if (!Buffer.isBuffer(cdkHashKey)) throw new TypeError('cdkHashKey is required');
  if (!Buffer.isBuffer(cdkRecoveryKey)) throw new TypeError('cdkRecoveryKey is required');

  return async function createBatch(input = {}) {
    const count = validateBatchCount(input.count);
    const planType = normalizePlanType(input.planType);
    const requestKey = normalizeRequestKey(input.requestKey);
    const [existing] = await pool.query(
      `SELECT batch_no, plan_type, requested_count, codes_ciphertext
       FROM cdk_batches WHERE BINARY request_key = BINARY ? LIMIT 1`,
      [requestKey]
    );
    const recovered = decodeStoredBatch(existing[0], cdkRecoveryKey, { count, planType });
    if (recovered) return recovered;

    const codes = generateCdks(count);
    const batchNo = normalizeBatchNo(input.batchNo);
    const ciphertext = encryptSecret(JSON.stringify(codes), cdkRecoveryKey);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO cdk_batches
         (batch_no, request_key, plan_type, requested_count, codes_ciphertext, created_by)
         VALUES (?, ?, ?, ?, ?, 'admin')`,
        [batchNo, requestKey, planType, count, ciphertext]
      );
      const values = codes.map((code) => [
        crypto.randomUUID(), hashCurrentCdk(code, cdkHashKey), CURRENT_CDK_HASH_VERSION,
        'AVAILABLE', batchNo, planType
      ]);
      const [result] = await connection.query(
        `INSERT INTO cdks (id, code_hash, hash_version, status, batch_no, plan_type) VALUES ?`,
        [values]
      );
      if (Number(result.affectedRows) !== count) {
        throw new CdkBatchError('generated CDK collision detected', 'GENERATED_COLLISION');
      }
      const paymentRows = values.map(([cdkId]) => [
        crypto.randomUUID(), cdkId, 'EXTERNAL_UNSPECIFIED', 'PAID', 'admin'
      ]);
      const [paymentResult] = await connection.query(
        `INSERT INTO customer_payments
         (id, cdk_id, payment_channel, payment_status, paid_at, recorded_by)
         VALUES ${paymentRows.map(() => '(?, ?, ?, ?, NULL, ?)').join(', ')}`,
        paymentRows.flat()
      );
      if (Number(paymentResult.affectedRows) !== count) {
        throw new CdkBatchError('customer payment trace creation was incomplete', 'PAYMENT_TRACE_INCOMPLETE');
      }
      await connection.query(
        `INSERT INTO cdk_admin_events (event_type, batch_no, metadata_json)
         VALUES ('BATCH_CREATED', ?, ?)`,
        [batchNo, JSON.stringify({ count, planType })]
      );
      await connection.commit();
      return { batchNo, planType, count, codes, replayed: false };
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        const [duplicate] = await connection.query(
          `SELECT batch_no, plan_type, requested_count, codes_ciphertext
           FROM cdk_batches WHERE BINARY request_key = BINARY ? LIMIT 1`,
          [requestKey]
        );
        const duplicateBatch = decodeStoredBatch(duplicate[0], cdkRecoveryKey, { count, planType });
        if (duplicateBatch) return duplicateBatch;
        throw new CdkBatchError('batch number already exists', 'BATCH_EXISTS');
      }
      throw error;
    } finally {
      connection.release();
    }
  };
}

function decodeBatchCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed?.createdAt || !parsed?.batchNo) throw new Error('invalid cursor');
    return parsed;
  } catch { throw new CdkBatchError('invalid batch cursor', 'INVALID_CURSOR'); }
}

function encodeBatchCursor(value) {
  return value ? Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') : null;
}

export async function listCdkBatches(pool, { limit = 50, cursor = null, fromDate = null, toDate = null, planType = null, status = null } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const clauses = ['c.batch_no IS NOT NULL'];
  const values = [];
  if (fromDate) { clauses.push('c.created_at >= ?'); values.push(`${String(fromDate).slice(0, 10)} 00:00:00`); }
  if (toDate) { clauses.push('c.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(`${String(toDate).slice(0, 10)} 00:00:00`); }
  if (planType) { clauses.push('c.plan_type = ?'); values.push(String(planType)); }
  if (status && ['AVAILABLE', 'REDEEMED', 'REVOKED'].includes(String(status))) { clauses.push('EXISTS (SELECT 1 FROM cdks cf WHERE cf.batch_no = c.batch_no AND cf.status = ?)'); values.push(String(status)); }
  const decoded = decodeBatchCursor(cursor);
  if (decoded) { clauses.push('(c.created_at < ? OR (c.created_at = ? AND c.batch_no < ?))'); values.push(decoded.createdAt, decoded.createdAt, decoded.batchNo); }
  const [rows] = await pool.query(
    `SELECT c.batch_no, MIN(c.plan_type) AS plan_type, COUNT(*) AS total_count,
            SUM(c.status = 'AVAILABLE') AS available_count,
            SUM(c.status = 'REDEEMED') AS redeemed_count,
            SUM(c.status = 'REVOKED') AS revoked_count,
            MIN(c.created_at) AS created_at,
            MAX(b.codes_ciphertext IS NOT NULL) AS downloadable,
            MAX(b.revoked_at) AS revoked_at,
            MAX(b.revoke_reason) AS revoke_reason
     FROM cdks c LEFT JOIN cdk_batches b ON BINARY b.batch_no = BINARY c.batch_no
     WHERE ${clauses.join(' AND ')}
     GROUP BY c.batch_no
     ORDER BY MIN(c.created_at) DESC, c.batch_no DESC LIMIT ?`,
    [...values, safeLimit + 1]
  );
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const tail = pageRows[pageRows.length - 1];
  return { batches: pageRows.map((row) => ({
    batchNo: row.batch_no,
    planType: row.plan_type,
    totalCount: Number(row.total_count),
    availableCount: Number(row.available_count || 0),
    redeemedCount: Number(row.redeemed_count || 0),
    revokedCount: Number(row.revoked_count || 0),
    downloadable: Boolean(row.downloadable),
    createdAt: iso(row.created_at),
    revokedAt: iso(row.revoked_at),
    revokeReason: row.revoke_reason || null
  })), nextCursor: hasMore && tail ? encodeBatchCursor({ createdAt: new Date(tail.created_at).toISOString(), batchNo: tail.batch_no }) : null };
}

export async function inspectCdkBatch(pool, batchNo, cdkHashKey, cdkRecoveryKey) {
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  const [batchRows] = await pool.query(
    `SELECT batch_no, plan_type, requested_count, codes_ciphertext, created_at,
            revoked_at, revoke_reason
     FROM cdk_batches WHERE BINARY batch_no = BINARY ? LIMIT 1`,
    [normalizedBatchNo]
  );
  if (!batchRows.length || !batchRows[0].codes_ciphertext) {
    throw new CdkBatchError('batch plaintext is not available', 'BATCH_DOWNLOAD_UNAVAILABLE');
  }
  const decoded = decodeStoredBatch(batchRows[0], cdkRecoveryKey);
  const [statusRows] = await pool.query(
    `SELECT c.code_hash, c.status, c.redeemed_at, c.revoked_at, c.revoke_reason,
            o.public_no
     FROM cdks c LEFT JOIN orders o ON o.id = c.order_id
     WHERE BINARY c.batch_no = BINARY ?`,
    [normalizedBatchNo]
  );
  const statusByHash = new Map(statusRows.map((row) => [String(row.code_hash), row]));
  const codes = decoded.codes.map((code) => {
    const row = statusByHash.get(hashCurrentCdk(code, cdkHashKey));
    if (!row) throw new CdkBatchError('stored CDK batch cannot be mapped', 'BATCH_RECOVERY_FAILED');
    return {
      code,
      status: row.status,
      orderPublicNo: row.public_no || null,
      redeemedAt: iso(row.redeemed_at),
      revokedAt: iso(row.revoked_at),
      revokeReason: row.revoke_reason || null
    };
  });
  await pool.query(
    `INSERT INTO cdk_admin_events (event_type, batch_no, metadata_json)
     VALUES ('BATCH_STATUS_EXPORTED', ?, ?)`,
    [normalizedBatchNo, JSON.stringify({ count: codes.length })]
  );
  return {
    batchNo: normalizedBatchNo,
    planType: batchRows[0].plan_type,
    createdAt: iso(batchRows[0].created_at),
    revokedAt: iso(batchRows[0].revoked_at),
    revokeReason: batchRows[0].revoke_reason || null,
    codes
  };
}

export async function downloadCdkBatch(pool, batchNo, cdkRecoveryKey) {
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  const [rows] = await pool.query(
    `SELECT batch_no, plan_type, requested_count, codes_ciphertext
     FROM cdk_batches WHERE BINARY batch_no = BINARY ? LIMIT 1`,
    [normalizedBatchNo]
  );
  if (!rows.length) throw new CdkBatchError('batch plaintext is not available', 'BATCH_DOWNLOAD_UNAVAILABLE');
  const decoded = decodeStoredBatch(rows[0], cdkRecoveryKey);
  await pool.query(
    `INSERT INTO cdk_admin_events (event_type, batch_no, metadata_json)
     VALUES ('BATCH_DOWNLOADED', ?, ?)`,
    [normalizedBatchNo, JSON.stringify({ count: decoded.count })]
  );
  return decoded;
}

export async function revokeCdkBatch(pool, batchNo, reason = 'operator revoked') {
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [batchRows] = await connection.query(
      `SELECT id FROM cdks
       WHERE BINARY batch_no = BINARY ? LIMIT 1 FOR UPDATE`,
      [normalizedBatchNo]
    );
    if (!batchRows.length) {
      throw new CdkBatchError('batch was not found', 'BATCH_NOT_FOUND');
    }
    const [result] = await connection.query(
      `UPDATE cdks
       SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = ?
       WHERE BINARY batch_no = BINARY ? AND status = 'AVAILABLE'`,
      [String(reason).slice(0, 500), normalizedBatchNo]
    );
    await connection.query(
      `UPDATE cdk_batches SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = ?
       WHERE BINARY batch_no = BINARY ?`,
      [String(reason).slice(0, 500), normalizedBatchNo]
    );
    await connection.query(
      `INSERT INTO cdk_admin_events (event_type, batch_no, metadata_json)
       VALUES ('BATCH_REVOKED', ?, ?)`,
      [normalizedBatchNo, JSON.stringify({ revokedCount: Number(result.affectedRows) })]
    );
    await connection.commit();
    return { batchNo: normalizedBatchNo, revokedCount: Number(result.affectedRows) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
