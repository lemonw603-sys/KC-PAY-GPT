import crypto from 'node:crypto';
import { CdkBatchError, normalizeCdkOptions, resolveCdkExpiry, CDK_STATE_SQL } from './cdk-policy.js';
export { CdkBatchError } from './cdk-policy.js';
import { decryptSecret, encryptSecret } from '../security/secret-box.js';
import {
  CURRENT_CDK_HASH_VERSION,
  GENERATED_CDK_PATTERN,
  hashCurrentCdk,
  hashLegacyCdk
} from '../security/cdk-code.js';

// D-279 ②：码前缀按产品分，运营一眼能认出是哪档；旧的统一前缀 PJ- 只保留在
// GENERATED_CDK_PATTERN 的可接受列表里（旧码继续有效、继续可导入），不再用于新生成。
const CDK_PREFIX_BY_PLAN = Object.freeze({ plus: 'PLUS-', pro_5x: '5X-', pro_20x: '20X-' });
const LEGACY_CDK_PREFIX = 'PJ-';
const CDK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CDK_RANDOM_LENGTH = 20;
const MAX_BATCH_SIZE = 1_000;
export const PLAN_TYPES = new Set(['plus', 'pro_5x', 'pro_20x']);

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

// planType 决定前缀（D-279 ②）。未知/缺省一律回退到旧前缀 PJ-，不猜：
// 宁可发出一个前缀"旧"但合法可用的码，也不要拼出一个正则不收、导入即非法的码。
export function generateCdks(value, { randomInt = crypto.randomInt, planType = null } = {}) {
  const count = validateBatchCount(value);
  const prefix = CDK_PREFIX_BY_PLAN[String(planType || '').trim().toLowerCase()] || LEGACY_CDK_PREFIX;
  const codes = new Set();
  while (codes.size < count) {
    let suffix = '';
    for (let index = 0; index < CDK_RANDOM_LENGTH; index += 1) {
      suffix += CDK_ALPHABET[randomInt(CDK_ALPHABET.length)];
    }
    const groupedSuffix = suffix.match(/.{1,5}/g).join('-');
    codes.add(`${prefix}${groupedSuffix}`);
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
    || (expected.fingerprint && row.generation_fingerprint !== expected.fingerprint)
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

export function createAdminCdkService({ pool, cdkHashKey, cdkRecoveryKey, now = () => new Date() }) {
  if (!pool) throw new TypeError('pool is required');
  if (!Buffer.isBuffer(cdkHashKey)) throw new TypeError('cdkHashKey is required');
  if (!Buffer.isBuffer(cdkRecoveryKey)) throw new TypeError('cdkRecoveryKey is required');

  return async function createBatch(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CdkBatchError('invalid input', 'INVALID_INPUT');
    const count = validateBatchCount(input.count);
    const planType = normalizePlanType(input.planType);
    const requestKey = normalizeRequestKey(input.requestKey);
    const options = normalizeCdkOptions(input);
    if (count === 1 && options.amount !== null) {
      throw new CdkBatchError('single-code payments are recorded on the order', 'SINGLE_AMOUNT_ON_ORDER');
    }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ count, planType, ...options })).digest('hex');
    const [existing] = await pool.query(
      `SELECT batch_no, plan_type, requested_count, codes_ciphertext, generation_fingerprint
       FROM cdk_batches WHERE BINARY request_key = BINARY ? LIMIT 1`,
      [requestKey]
    );
    const recovered = decodeStoredBatch(existing[0], cdkRecoveryKey, { count, planType, fingerprint });
    if (recovered) return recovered;

    const createdAt = now();
    const expiresAt = resolveCdkExpiry(options, createdAt);
    // Normal/marketplace means allocated for distribution, not proof of actual sale.
    const issuedAt = options.issuanceKind === 'RESERVE' ? null : createdAt;
    const codes = generateCdks(count, { planType });
    const batchNo = normalizeBatchNo(input.batchNo);
    const ciphertext = encryptSecret(JSON.stringify(codes), cdkRecoveryKey);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO cdk_batches
         (batch_no, request_key, plan_type, requested_count, codes_ciphertext, created_by,
          channel_note, sale_amount, sale_currency, issued_at, generation_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?)`,
        [batchNo, requestKey, planType, count, ciphertext, options.note || null,
          options.amount, options.amount === null ? null : options.currency, issuedAt, fingerprint, createdAt]
      );
      const values = codes.map((code) => [
        crypto.randomUUID(), hashCurrentCdk(code, cdkHashKey), CURRENT_CDK_HASH_VERSION,
        'AVAILABLE', batchNo, planType, options.issuanceKind, issuedAt, null, expiresAt, createdAt
      ]);
      const [result] = await connection.query(
        `INSERT INTO cdks (id, code_hash, hash_version, status, batch_no, plan_type,
          issuance_kind, issued_at, issued_note, expires_at, created_at) VALUES ?`,
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
        [batchNo, JSON.stringify({ count, planType, ...options, expiresAt: iso(expiresAt) })]
      );
      await connection.commit();
      return { batchNo, planType, count, codes, replayed: false };
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        const [duplicate] = await connection.query(
          `SELECT batch_no, plan_type, requested_count, codes_ciphertext, generation_fingerprint
           FROM cdk_batches WHERE BINARY request_key = BINARY ? LIMIT 1`,
          [requestKey]
        );
        const duplicateBatch = decodeStoredBatch(duplicate[0], cdkRecoveryKey, { count, planType, fingerprint });
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

// ——— D-279 ④⑤ / D-286：以单码为主的列表、单码作废、标记已发出 ———

// 明文码只加密存在 cdk_batches.codes_ciphertext，cdks 表只有 code_hash。要在列表里显示码，
// 必须解密所属批次、再把每个明文 hash 回去匹配。**新旧码的 hash 算法不同**
// （旧 sha256-v1 / 新 hmac-sha256-v1，cdks.hash_version 有记），两种都要算，
// 否则旧码永远匹配不上、明文显示不出来（inspectCdkBatch 只算 current，遇旧码会直接抛错）。
async function buildPlaintextIndex(pool, batchNos, cdkHashKey, cdkRecoveryKey) {
  const index = new Map();
  if (!batchNos.length) return index;
  const [rows] = await pool.query(
    `SELECT batch_no, codes_ciphertext FROM cdk_batches
      WHERE batch_no IN (${batchNos.map(() => '?').join(',')})`,
    batchNos
  );
  for (const row of rows) {
    if (!row.codes_ciphertext) continue;           // 老批次可能没留明文：降级为不显示，不报错
    let codes;
    try {
      codes = JSON.parse(decryptSecret(row.codes_ciphertext, cdkRecoveryKey));
    } catch {
      continue;                                     // 解不开就跳过这批，其余行照常返回
    }
    for (const code of codes) {
      index.set(hashCurrentCdk(code, cdkHashKey), code);
      index.set(hashLegacyCdk(code), code);
    }
  }
  return index;
}

// 「当前还能不能兑」不落静态字段——路线随时会切（D-245 关 305/306 就是先例），
// 静态字段必然过期。这里按产品路线的 accepts_new_orders 现算。
async function loadRedeemablePlanTypes(pool) {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.product_code
       FROM fulfillment_routes fr INNER JOIN products p ON p.id = fr.product_id
      WHERE fr.accepts_new_orders = 1 AND fr.retired_at IS NULL AND p.status = 'ACTIVE'`
  );
  const codes = new Set(rows.map((row) => String(row.product_code)));
  // products.product_code 是 chatgpt_plus / chatgpt_pro_5x / chatgpt_pro_20x，
  // cdks.plan_type 是 plus / pro_5x / pro_20x，这里对齐两套写法。
  const map = { chatgpt_plus: 'plus', chatgpt_pro_5x: 'pro_5x', chatgpt_pro_20x: 'pro_20x' };
  return new Set([...codes].map((code) => map[code]).filter(Boolean));
}

export async function listCdkCodes(pool, {
  limit = 50, offset = 0, batchNo = null, planType = null, status = null, issued = null,
  state = null, issuanceKind = null, q = null
} = {}, { cdkHashKey, cdkRecoveryKey } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 50));
  const safeOffset = Math.max(0, Math.trunc(Number(offset)) || 0);
  const clauses = [];
  const values = [];
  if (batchNo) { clauses.push('BINARY c.batch_no = BINARY ?'); values.push(normalizeBatchNo(batchNo)); }
  if (planType) { clauses.push('c.plan_type = ?'); values.push(normalizePlanType(planType)); }
  if (status && ['AVAILABLE', 'REDEEMED', 'REVOKED'].includes(status)) {
    clauses.push('c.status = ?'); values.push(status);
  }
  if (state) {
    if (!CDK_STATE_SQL[state]) throw new CdkBatchError('invalid state', 'INVALID_STATE');
    clauses.push(`(${CDK_STATE_SQL[state]})`);
  }
  if (issuanceKind) {
    if (!['NORMAL', 'RESERVE', 'MARKETPLACE', 'LEGACY'].includes(issuanceKind)) {
      throw new CdkBatchError('invalid issuance kind', 'INVALID_ISSUANCE_KIND');
    }
    clauses.push('c.issuance_kind = ?'); values.push(issuanceKind);
  }
  if (issued === 'yes') clauses.push('c.issued_at IS NOT NULL');
  if (issued === 'no') clauses.push('c.issued_at IS NULL');
  if (q && String(q).trim()) {
    const term = String(q).trim();
    if (term.length > 256) throw new CdkBatchError('search too long', 'INVALID_SEARCH');
    // Exact full-code lookup works even when a legacy batch has no plaintext.
    // Other text fields support substring search, all BEFORE COUNT/LIMIT.
    const like = '%' + term.replace(/[!%_]/g, '!$&') + '%';
    clauses.push("(c.code_hash IN (?, ?) OR o.public_no LIKE ? ESCAPE '!' OR o.customer_email LIKE ? ESCAPE '!' OR c.issued_note LIKE ? ESCAPE '!' OR b.channel_note LIKE ? ESCAPE '!')");
    values.push(hashCurrentCdk(term, cdkHashKey), hashLegacyCdk(term), like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const joins = 'FROM cdks c LEFT JOIN orders o ON o.id = c.order_id LEFT JOIN cdk_batches b ON BINARY b.batch_no = BINARY c.batch_no';
  const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total ${joins} ${where}`, values);
  const [rows] = await pool.query(
    `SELECT c.*, o.public_no, o.customer_email, o.status AS order_status,
            b.channel_note, b.requested_count, b.sale_amount, b.sale_currency,
            (${CDK_STATE_SQL.historical}) AS historical,
            GREATEST(c.created_at, COALESCE(c.redeemed_at,c.created_at),
              COALESCE(c.issued_at,c.created_at), COALESCE(c.revoked_at,c.created_at),
              COALESCE(c.admin_updated_at,c.created_at)) AS latest_at
       ${joins} ${where}
       ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...values, safeLimit, safeOffset]
  );
  const plaintext = await buildPlaintextIndex(pool,
    [...new Set(rows.map((row) => row.batch_no).filter(Boolean))], cdkHashKey, cdkRecoveryKey);
  const redeemable = await loadRedeemablePlanTypes(pool);
  const now = Date.now();
  const codes = rows.map((row) => {
    const expired = row.expires_at ? new Date(row.expires_at).getTime() <= now : false;
    return {
      id: row.id, code: plaintext.get(String(row.code_hash)) || null,
      batchNo: row.batch_no, batchCount: Number(row.requested_count || 1),
      batchNote: row.channel_note || null, batchAmount: row.sale_amount, batchCurrency: row.sale_currency,
      planType: row.plan_type, status: row.status, issuanceKind: row.issuance_kind,
      orderPublicNo: row.public_no || null, customerEmail: row.customer_email || null,
      orderStatus: row.order_status || null, historical: Boolean(row.historical),
      createdAt: iso(row.created_at), redeemedAt: iso(row.redeemed_at), revokedAt: iso(row.revoked_at),
      revokeReason: row.revoke_reason || null, issuedAt: iso(row.issued_at),
      issuedNote: row.issued_note || null, expiresAt: iso(row.expires_at), latestAt: iso(row.latest_at),
      expired, redeemableNow: row.status === 'AVAILABLE' && !expired && redeemable.has(String(row.plan_type))
    };
  });
  return { total: Number(countRow.total || 0), codes, limit: safeLimit, offset: safeOffset };
}

// All selected rows succeed or nothing changes. Same transaction for state + audit.
// Sorted locking makes simultaneous bulk operations deterministic; intake locks the same CDK rows.
export async function updateCdkCodes(pool, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CdkBatchError('invalid input', 'INVALID_INPUT');
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 1000
    || input.ids.some((id) => typeof id !== 'string' || !id || id.length > 64)) {
    throw new CdkBatchError('select 1-1000 codes', 'INVALID_CDK_IDS');
  }
  const ids = [...new Set(input.ids)].sort();
  const action = input.action;
  if (!['revoke', 'issue', 'expiry'].includes(action)) throw new CdkBatchError('invalid action', 'INVALID_ACTION');
  const note = input.note == null ? null : String(input.note).trim();
  if (note && note.length > 200) throw new CdkBatchError('note too long', 'INVALID_NOTE');
  let expiry = null;
  if (action === 'expiry') {
    const options = normalizeCdkOptions(input);
    if (options.expiryMode === 'DEFAULT') throw new CdkBatchError('choose explicit expiry', 'INVALID_EXPIRY');
    expiry = resolveCdkExpiry(options, new Date());
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id, status, order_id, batch_no, issued_at, issuance_kind, expires_at FROM cdks WHERE id IN (?) ORDER BY id FOR UPDATE',
      [ids]
    );
    if (rows.length !== ids.length) throw new CdkBatchError('code not found', 'CDK_NOT_FOUND');
    for (const row of rows) {
      if (row.order_id || (row.status !== 'AVAILABLE' && !(action === 'revoke' && row.status === 'REVOKED'))) {
        throw new CdkBatchError('selection contains a used code; nothing changed', 'CDK_SELECTION_CONFLICT');
      }
      // A sold or distributed code cannot have its deadline shortened.
      if (action === 'expiry' && row.issued_at && expiry
        && (!row.expires_at || expiry < new Date(row.expires_at))) {
        throw new CdkBatchError('issued expiry can only be extended', 'EXPIRY_CANNOT_SHORTEN');
      }
    }
    let changed = 0;
    for (const row of rows) {
      if (action === 'revoke' && row.status === 'REVOKED') continue;
      if (action === 'issue' && row.issued_at && note === null) continue;
      if (action === 'expiry' && iso(row.expires_at) === iso(expiry)) continue;
      if (action === 'revoke') {
        await connection.query("UPDATE cdks SET status='REVOKED', revoked_at=CURRENT_TIMESTAMP(3), revoke_reason=? WHERE id=?",
          [note || '后台作废', row.id]);
      } else if (action === 'issue') {
        await connection.query("UPDATE cdks SET issued_at=COALESCE(issued_at,CURRENT_TIMESTAMP(3)), issued_note=COALESCE(?,issued_note), admin_updated_at=CURRENT_TIMESTAMP(3) WHERE id=?",
          [note, row.id]);
      } else {
        await connection.query('UPDATE cdks SET expires_at=?, admin_updated_at=CURRENT_TIMESTAMP(3) WHERE id=?', [expiry, row.id]);
      }
      await connection.query(
        'INSERT INTO cdk_admin_events (event_type,batch_no,metadata_json) VALUES (?,?,?)',
        [{ revoke: 'CDK_REVOKED', issue: 'CDK_ISSUED', expiry: 'CDK_EXPIRY_SET' }[action], row.batch_no,
          JSON.stringify({ cdkId: row.id, note, previousExpiresAt: iso(row.expires_at),
            ...(action === 'expiry' ? { expiresAt: iso(expiry) } : {}) })]
      );
      changed++;
    }
    await connection.commit();
    return { action, selected: ids.length, changed, unchanged: ids.length - changed };
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}

export async function revokeCdkCode(pool, cdkId, { reason = null } = {}) {
  await updateCdkCodes(pool, { ids: [cdkId], action: 'revoke', note: reason });
  return { cdkId, status: 'REVOKED', reason };
}

export async function markCdkIssued(pool, cdkId, { note = null, issued = true } = {}) {
  if (issued !== true) throw new CdkBatchError('undo issuance is disabled', 'CDK_UNISSUE_DISABLED');
  await updateCdkCodes(pool, { ids: [cdkId], action: 'issue', note });
  return { cdkId, issued: true, note };
}

export async function summarizeCdkLiability(pool) {
  const fields = ['pending', 'reserve', 'done', 'attention', 'historical', 'expired', 'processing', 'legacy'];
  const [[row]] = await pool.query(
    `SELECT ${fields.map((field) => `COALESCE(SUM(${CDK_STATE_SQL[field]}),0) AS ${field}`).join(', ')}
       FROM cdks c LEFT JOIN orders o ON o.id = c.order_id`
  );
  return Object.fromEntries(fields.map((field) => [field, Number(row[field] || 0)]));
}

export async function listCdkBatchOptions(pool, { cursor = null } = {}) {
  if (cursor !== null) normalizeBatchNo(cursor);
  const [rows] = await pool.query(
    `SELECT batch_no, channel_note, requested_count, plan_type, created_at, sale_amount, sale_currency
     FROM cdk_batches WHERE requested_count > 1 ${cursor ? 'AND batch_no < ?' : ''}
     ORDER BY batch_no DESC LIMIT 101`, cursor ? [cursor] : []
  );
  return { batches: rows.slice(0,100).map((r) => ({
    batchNo: r.batch_no, note: r.channel_note, count: Number(r.requested_count),
    planType: r.plan_type, createdAt: iso(r.created_at), amount: r.sale_amount, currency: r.sale_currency
  })), nextCursor: rows.length > 100 ? rows[99].batch_no : null };
}

// Batch metadata is intentionally a batch-level edit, never inferred from a partial selection.
export async function updateCdkBatchMetadata(pool, batchNo, input) {
  const batch = normalizeBatchNo(batchNo);
  const options = normalizeCdkOptions(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.query('SELECT batch_no, requested_count FROM cdk_batches WHERE BINARY batch_no=BINARY ? FOR UPDATE', [batch]);
    if (!row) throw new CdkBatchError('batch not found', 'BATCH_NOT_FOUND');
    if (Number(row.requested_count) <= 1 && options.amount !== null) {
      throw new CdkBatchError('single payment belongs to order', 'SINGLE_AMOUNT_ON_ORDER');
    }
    await connection.query('UPDATE cdk_batches SET channel_note=?, sale_amount=?, sale_currency=? WHERE BINARY batch_no=BINARY ?',
      [options.note || null, options.amount, options.amount === null ? null : options.currency, batch]);
    await connection.query('INSERT INTO cdk_admin_events (event_type,batch_no,metadata_json) VALUES (?,?,?)',
      ['BATCH_METADATA_SET', batch, JSON.stringify({ note: options.note, amount: options.amount, currency: options.currency })]);
    await connection.commit();
    return { batchNo: batch };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
