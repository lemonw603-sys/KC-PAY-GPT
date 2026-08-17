import crypto from 'node:crypto';

const CDK_PREFIX = 'PJ-';
const CDK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CDK_RANDOM_LENGTH = 20;
const MAX_BATCH_SIZE = 10_000;
const CDK_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export class CdkBatchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CdkBatchError';
    this.code = code;
  }
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
    if (!CDK_PATTERN.test(code)) {
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
    codes.add(`${CDK_PREFIX}${suffix}`);
  }
  return [...codes];
}

function hashCdk(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

export async function storeCdkBatch(pool, codes, {
  batchNo,
  requireAllInserted = false
}) {
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  const normalized = normalizeImportedCdks(codes.join('\n'));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const values = normalized.codes.map((code) => [
      crypto.randomUUID(),
      hashCdk(code),
      normalizedBatchNo
    ]);
    const [result] = await connection.query(
      `INSERT IGNORE INTO cdks (id, code_hash, status, batch_no)
       VALUES ?`,
      [values.map(([id, codeHash, batch]) => [id, codeHash, 'AVAILABLE', batch])]
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
