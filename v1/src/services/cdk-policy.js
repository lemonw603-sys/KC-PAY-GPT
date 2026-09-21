export class CdkBatchError extends Error {
  constructor(message, code) { super(message); this.name = 'CdkBatchError'; this.code = code; }
}

export function normalizeCdkOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CdkBatchError('invalid input', 'INVALID_INPUT');
  const issuanceKind = input.issuanceKind ?? 'NORMAL';
  if (!['NORMAL', 'RESERVE', 'MARKETPLACE'].includes(issuanceKind)) {
    throw new CdkBatchError('invalid issuance kind', 'INVALID_ISSUANCE_KIND');
  }
  const expiryMode = input.expiryMode ?? 'DEFAULT';
  if (!['DEFAULT', 'CUSTOM', 'NEVER'].includes(expiryMode)) {
    throw new CdkBatchError('invalid expiry mode', 'INVALID_EXPIRY');
  }
  let expiresAt = null;
  if (expiryMode === 'CUSTOM') {
    // Require an explicit offset; a browser datetime-local is converted by the UI.
    if (typeof input.expiresAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.expiresAt)
      || !Number.isFinite(Date.parse(input.expiresAt))) {
      throw new CdkBatchError('expiry requires a timestamp with timezone', 'INVALID_EXPIRY');
    }
    expiresAt = new Date(input.expiresAt).toISOString();
  }
  const note = String(input.note ?? '').trim();
  if (note.length > 200) throw new CdkBatchError('note too long', 'INVALID_NOTE');
  let amount = input.amount == null || input.amount === '' ? null : String(input.amount);
  if (amount !== null) {
    if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(amount)) {
      throw new CdkBatchError('amount must be a non-negative decimal', 'INVALID_AMOUNT');
    }
    const [whole, fraction = ''] = amount.split('.');
    amount = `${whole}.${fraction.padEnd(2, '0')}`;
  }
  const currency = input.currency ?? 'CNY';
  if (!['CNY', 'USD'].includes(currency)) throw new CdkBatchError('invalid currency', 'INVALID_CURRENCY');
  return { issuanceKind, expiryMode, expiresAt, note, amount, currency };
}

export function resolveCdkExpiry(options, now) {
  if (options.expiryMode === 'NEVER') return null;
  const expiry = options.expiryMode === 'DEFAULT'
    ? new Date(now.getTime() + 30 * 86400_000) : new Date(options.expiresAt);
  if (expiry <= now) throw new CdkBatchError('expiry must be in the future', 'INVALID_EXPIRY');
  return expiry;
}

// Aliases c (cdks), o (orders); reused by list filtering and summary.
export const CDK_STATE_SQL = Object.freeze({
  pending: "c.status = 'AVAILABLE' AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP(3)) AND (c.issuance_kind IN ('NORMAL','MARKETPLACE') OR c.issued_at IS NOT NULL)",
  reserve: "c.status = 'AVAILABLE' AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP(3)) AND c.issuance_kind = 'RESERVE' AND c.issued_at IS NULL",
  done: "c.status = 'REDEEMED' AND o.status = 'RECHARGE_SUCCESS'",
  stuck: "c.status = 'REDEEMED' AND o.status IN ('RECHARGE_FAILED','CLOSED')",
  attention: "c.status = 'REDEEMED' AND o.status IN ('RECHARGE_FAILED','CLOSED') AND COALESCE(o.finished_at,o.created_at) >= '2026-09-07 15:00:00'",
  historical: "c.status = 'REDEEMED' AND o.status IN ('RECHARGE_FAILED','CLOSED') AND COALESCE(o.finished_at,o.created_at) < '2026-09-07 15:00:00'",
  processing: "c.status = 'REDEEMED' AND (o.status IS NULL OR o.status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED'))",
  expired: "c.status = 'AVAILABLE' AND c.expires_at <= CURRENT_TIMESTAMP(3)",
  revoked: "c.status = 'REVOKED'",
  legacy: "c.status = 'AVAILABLE' AND c.issuance_kind = 'LEGACY' AND c.issued_at IS NULL"
});
