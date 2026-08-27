import crypto from 'node:crypto';

export class CardConsumptionLedgerError extends Error {
  constructor(message, code) { super(message); this.name = 'CardConsumptionLedgerError'; this.code = code; }
}

async function tx(pool, fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const out = await fn(c); await c.commit(); return out; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export async function reserveCardConsumptionInTransaction(connection, {
  cardId, orderId, rechargeAttemptId = null, productId = null,
  amount = null, currency = null, maxPayments = 3, evidence = null,
  now = new Date()
} = {}) {
  if (!cardId || !orderId) throw new CardConsumptionLedgerError('cardId and orderId are required', 'INVALID_ARGUMENT');
  const limit = Number(maxPayments);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new CardConsumptionLedgerError('maxPayments must be positive', 'INVALID_ARGUMENT');

  const [cards] = await connection.query('SELECT id FROM cards WHERE id = ? FOR UPDATE', [cardId]);
  if (cards.length !== 1) throw new CardConsumptionLedgerError('card not found', 'CARD_NOT_FOUND');
  const [existingRows] = await connection.query(
    `SELECT id, status, recharge_attempt_id FROM card_consumption_ledger
     WHERE card_id = ? AND order_id = ? FOR UPDATE`,
    [cardId, orderId]
  );
  const existing = existingRows[0] || null;
  if (existing && ['RESERVED', 'CONSUMED'].includes(existing.status)) {
    if (rechargeAttemptId && existing.recharge_attempt_id
      && existing.recharge_attempt_id !== rechargeAttemptId) {
      throw new CardConsumptionLedgerError('order already owns a different active reservation', 'ORDER_RESERVATION_EXISTS');
    }
    return { id: existing.id, cardId, orderId, status: existing.status, idempotent: true };
  }
  if (existing?.status === 'RECONCILIATION') {
    throw new CardConsumptionLedgerError('card consumption requires reconciliation', 'CARD_CONSUMPTION_RECONCILIATION');
  }
  const [[counts]] = await connection.query(
    `SELECT COUNT(*) AS used FROM card_consumption_ledger
     WHERE card_id = ? AND status IN ('RESERVED','CONSUMED','RECONCILIATION')`,
    [cardId]
  );
  const used = Number(counts.used);
  if (used >= limit) throw new CardConsumptionLedgerError('card consumption capacity exhausted', 'CARD_CONSUMPTION_LIMIT');

  if (existing?.status === 'RELEASED') {
    await connection.query(
      `UPDATE card_consumption_ledger
       SET recharge_attempt_id = ?, status = 'RESERVED', amount = ?, currency = ?,
           reserved_at = ?, consumed_at = NULL, released_at = NULL, release_reason = NULL,
           evidence_json = ?
       WHERE id = ? AND status = 'RELEASED'`,
      [rechargeAttemptId, amount, currency, now, json(evidence), existing.id]
    );
    return { id: existing.id, cardId, orderId, status: 'RESERVED', used: used + 1,
      remaining: limit - used - 1, reactivated: true };
  }

  const id = crypto.randomUUID();
  await connection.query(
    `INSERT INTO card_consumption_ledger
     (id, card_id, order_id, recharge_attempt_id, product_id, status, amount, currency,
      reserved_at, evidence_json)
     VALUES (?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?)`,
    [id, cardId, orderId, rechargeAttemptId, productId, amount, currency, now, json(evidence)]
  );
  return { id, cardId, orderId, status: 'RESERVED', used: used + 1, remaining: limit - used - 1 };
}

/** Reserve one future card consumption atomically under the card row lock. */
export async function reserveCardConsumption(pool, { cardId, orderId, productId = null,
  rechargeAttemptId = null, amount = null, currency = null, maxPayments = 3,
  evidence = null, now = new Date() } = {}) {
  return tx(pool, (connection) => reserveCardConsumptionInTransaction(connection, {
    cardId, orderId, rechargeAttemptId, productId, amount, currency, maxPayments, evidence, now
  }));
}

export async function transitionCardConsumptionInTransaction(connection, {
  id = null, orderId = null, rechargeAttemptId = null, targetStatus,
  providerTransactionId = null, reason = null, evidence = null, now = new Date(),
  allowedCurrentStatuses = ['RESERVED'], requireActive = true
} = {}) {
  if (!id && !orderId && !rechargeAttemptId) {
    throw new CardConsumptionLedgerError('a ledger identifier is required', 'INVALID_ARGUMENT');
  }
  if (!['CONSUMED', 'RELEASED', 'RECONCILIATION'].includes(targetStatus)) {
    throw new CardConsumptionLedgerError('invalid target status', 'INVALID_ARGUMENT');
  }
  if (targetStatus === 'RELEASED' && !reason) {
    throw new CardConsumptionLedgerError('release reason is required', 'INVALID_ARGUMENT');
  }
  const clauses = [];
  const identifiers = [];
  if (id) { clauses.push('id = ?'); identifiers.push(id); }
  if (orderId) { clauses.push('order_id = ?'); identifiers.push(orderId); }
  if (rechargeAttemptId) { clauses.push('recharge_attempt_id = ?'); identifiers.push(rechargeAttemptId); }
  const timestampSql = targetStatus === 'CONSUMED'
    ? 'consumed_at = COALESCE(consumed_at, ?),'
    : targetStatus === 'RELEASED'
      ? 'released_at = COALESCE(released_at, ?),'
      : '';
  const [result] = await connection.query(
    `UPDATE card_consumption_ledger SET status = ?,
       ${timestampSql}
       provider_transaction_id = COALESCE(?, provider_transaction_id),
       release_reason = COALESCE(?, release_reason), evidence_json = COALESCE(?, evidence_json)
     WHERE ${clauses.join(' AND ')} AND status IN (${allowedCurrentStatuses.map(() => '?').join(',')})`,
    [targetStatus, ...(timestampSql ? [now] : []), providerTransactionId,
      reason == null ? null : String(reason).slice(0, 500), json(evidence), ...identifiers,
      ...allowedCurrentStatuses]
  );
  if (result.affectedRows !== 1) {
    if (!requireActive) return { id, orderId, rechargeAttemptId, status: null, missing: true };
    throw new CardConsumptionLedgerError('reservation is not active', 'RESERVATION_NOT_ACTIVE');
  }
  return { id, orderId, rechargeAttemptId, status: targetStatus };
}

export async function consumeCardConsumption(pool, { id, providerTransactionId = null, evidence = null } = {}) {
  return transitionCardConsumptionInTransaction(pool, {
    id, targetStatus: 'CONSUMED', providerTransactionId, evidence
  });
}

export async function releaseCardConsumption(pool, { id, reason } = {}) {
  return transitionCardConsumptionInTransaction(pool, { id, targetStatus: 'RELEASED', reason });
}
