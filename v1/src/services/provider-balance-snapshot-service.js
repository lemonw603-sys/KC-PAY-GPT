import crypto from 'node:crypto';

const DECIMAL_RE = /^-?\d+(?:\.\d{1,6})?$/;
const CURRENCY_RE = /^[A-Z0-9]{3,8}$/;

export class ProviderBalanceSnapshotError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'ProviderBalanceSnapshotError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requireProviderAccountId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 36) {
    throw new ProviderBalanceSnapshotError('providerAccountId is required', 'INVALID_PROVIDER_ACCOUNT');
  }
  return id;
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    throw new ProviderBalanceSnapshotError('currency must be 3-8 uppercase letters or digits', 'INVALID_CURRENCY');
  }
  return currency;
}

function normalizeObservedAt(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ProviderBalanceSnapshotError('observedAt must be a valid Date', 'INVALID_OBSERVED_AT');
  }
  return value;
}

function normalizeSourceCallId(value) {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ProviderBalanceSnapshotError('sourceCallId must be a positive integer', 'INVALID_SOURCE_CALL');
  }
  return id;
}

export function normalizeDecimalString(value, { nullable = false, field = 'amount' } = {}) {
  if (value == null || value === '') {
    if (nullable) return null;
    throw new ProviderBalanceSnapshotError(`${field} is required`, 'INVALID_DECIMAL');
  }
  if (typeof value !== 'string') {
    throw new ProviderBalanceSnapshotError(`${field} must be a decimal fixed-point string`, 'INVALID_DECIMAL');
  }
  const raw = value.trim();
  if (!DECIMAL_RE.test(raw)) {
    throw new ProviderBalanceSnapshotError(`${field} must be a decimal fixed-point string with up to 6 fractional digits`, 'INVALID_DECIMAL');
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  let [integer, fraction = ''] = unsigned.split('.');
  integer = integer.replace(/^0+(?=\d)/, '') || '0';
  if (integer.length > 12) {
    throw new ProviderBalanceSnapshotError(`${field} exceeds DECIMAL(18,6)`, 'DECIMAL_OUT_OF_RANGE');
  }
  const paddedFraction = fraction.padEnd(6, '0');
  const isZero = integer === '0' && /^0*$/.test(paddedFraction);
  const normalized = `${negative && !isZero ? '-' : ''}${integer}.${paddedFraction}`;
  return normalized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function sha256Payload(value) {
  if (value == null) return null;
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) hash.update(value);
  else if (typeof value === 'string') hash.update(value, 'utf8');
  else hash.update(JSON.stringify(canonicalize(value)), 'utf8');
  return hash.digest('hex');
}

function sameNullable(a, b) {
  if (a == null && b == null) return true;
  return String(a) === String(b);
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

function rowToSnapshot(row, inserted = false) {
  return {
    id: row.id == null ? null : Number(row.id),
    providerAccountId: row.provider_account_id,
    currency: row.currency,
    availableBalance: normalizeDecimalString(String(row.available_balance), { field: 'availableBalance' }),
    pendingBalance: row.pending_balance == null
      ? null : normalizeDecimalString(String(row.pending_balance), { field: 'pendingBalance' }),
    sourceCallId: row.source_call_id == null ? null : Number(row.source_call_id),
    payloadHash: row.payload_hash ?? null,
    observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : new Date(row.observed_at).toISOString(),
    inserted
  };
}

/**
 * Appends a provider balance observation. Duplicate
 * provider_account_id/currency/observed_at rows are treated as idempotent only
 * when the stored evidence matches the normalized request. Raw provider payloads
 * are never persisted; only their SHA256 hash is written.
 */
export async function recordProviderBalanceSnapshot(pool, input = {}) {
  const providerAccountId = requireProviderAccountId(input.providerAccountId);
  const currency = normalizeCurrency(input.currency);
  const availableBalance = normalizeDecimalString(input.availableBalance, { field: 'availableBalance' });
  const pendingBalance = normalizeDecimalString(input.pendingBalance, { nullable: true, field: 'pendingBalance' });
  const sourceCallId = normalizeSourceCallId(input.sourceCallId);
  const observedAt = normalizeObservedAt(input.observedAt ?? new Date());
  const payloadHash = input.payloadHash == null ? sha256Payload(input.rawPayload ?? input.payload) : String(input.payloadHash).trim().toLowerCase();
  if (payloadHash != null && !/^[a-f0-9]{64}$/.test(payloadHash)) {
    throw new ProviderBalanceSnapshotError('payloadHash must be a SHA256 hex digest', 'INVALID_PAYLOAD_HASH');
  }

  return inTransaction(pool, async (connection) => {
    const [accounts] = await connection.query(
      `SELECT id
       FROM provider_accounts
       WHERE BINARY id = BINARY ?
       FOR UPDATE`,
      [providerAccountId]
    );
    if (accounts.length !== 1) {
      throw new ProviderBalanceSnapshotError('provider account not found', 'PROVIDER_ACCOUNT_NOT_FOUND');
    }

    if (sourceCallId != null) {
      const [calls] = await connection.query(
        `SELECT id, provider_account_id
         FROM provider_calls
         WHERE id = ?
         FOR UPDATE`,
        [sourceCallId]
      );
      if (calls.length !== 1) {
        throw new ProviderBalanceSnapshotError('source provider call not found', 'SOURCE_CALL_NOT_FOUND');
      }
      if (calls[0].provider_account_id != null && String(calls[0].provider_account_id) !== providerAccountId) {
        throw new ProviderBalanceSnapshotError('source provider call belongs to a different account', 'SOURCE_CALL_ACCOUNT_MISMATCH');
      }
    }

    const [insert] = await connection.query(
      `INSERT IGNORE INTO provider_balance_snapshots
       (provider_account_id, currency, available_balance, pending_balance, source_call_id, payload_hash, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [providerAccountId, currency, availableBalance, pendingBalance, sourceCallId, payloadHash, observedAt]
    );

    const [rows] = await connection.query(
      `SELECT id, provider_account_id, currency, available_balance, pending_balance,
              source_call_id, payload_hash, observed_at
       FROM provider_balance_snapshots
       WHERE BINARY provider_account_id = BINARY ?
         AND currency = ?
         AND observed_at = ?
       LIMIT 1`,
      [providerAccountId, currency, observedAt]
    );
    if (rows.length !== 1) {
      throw new ProviderBalanceSnapshotError('balance snapshot could not be read back', 'SNAPSHOT_READBACK_FAILED');
    }

    const row = rows[0];
    const conflict = normalizeDecimalString(String(row.available_balance), { field: 'availableBalance' }) !== availableBalance
      || !sameNullable(row.pending_balance == null ? null : normalizeDecimalString(String(row.pending_balance), { field: 'pendingBalance' }), pendingBalance)
      || !sameNullable(row.source_call_id, sourceCallId)
      || !sameNullable(row.payload_hash, payloadHash);
    if (Number(insert.affectedRows) === 0 && conflict) {
      throw new ProviderBalanceSnapshotError('duplicate balance observation has different evidence', 'SNAPSHOT_CONFLICT');
    }

    return rowToSnapshot(row, Number(insert.affectedRows) === 1);
  });
}

export function createProviderBalanceSnapshotService({ pool } = {}) {
  if (!pool) throw new TypeError('pool is required');
  return {
    recordSnapshot(input) {
      return recordProviderBalanceSnapshot(pool, input);
    }
  };
}
