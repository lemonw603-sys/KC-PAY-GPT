import crypto from 'node:crypto';

export class CardConsumptionLedgerError extends Error {
  constructor(message, code) { super(message); this.name = 'CardConsumptionLedgerError'; this.code = code; }
}

async function tx(pool, fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const out = await fn(c); await c.commit(); return out; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

/** Reserve one future card consumption atomically under the card row lock. */
export async function reserveCardConsumption(pool, { cardId, orderId, productId = null,
  amount = null, currency = null, maxPayments = 3, evidence = null } = {}) {
  if (!cardId || !orderId) throw new CardConsumptionLedgerError('cardId and orderId are required', 'INVALID_ARGUMENT');
  const limit = Number(maxPayments);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new CardConsumptionLedgerError('maxPayments must be positive', 'INVALID_ARGUMENT');
  return tx(pool, async (c) => {
    await c.query('SELECT id FROM cards WHERE id = ? FOR UPDATE', [cardId]);
    const [[counts]] = await c.query(
      `SELECT COUNT(*) AS used FROM card_consumption_ledger
       WHERE card_id = ? AND status IN ('RESERVED','CONSUMED')`, [cardId]);
    if (Number(counts.used) >= limit) throw new CardConsumptionLedgerError('card consumption capacity exhausted', 'CARD_CONSUMPTION_LIMIT');
    const id = crypto.randomUUID();
    await c.query(
      `INSERT INTO card_consumption_ledger
       (id, card_id, order_id, product_id, status, amount, currency, evidence_json)
       VALUES (?, ?, ?, ?, 'RESERVED', ?, ?, ?)`,
      [id, cardId, orderId, productId, amount, currency, evidence == null ? null : JSON.stringify(evidence)]
    );
    return { id, cardId, orderId, status: 'RESERVED', used: Number(counts.used) + 1, remaining: limit - Number(counts.used) - 1 };
  });
}

export async function consumeCardConsumption(pool, { id, providerTransactionId = null, evidence = null } = {}) {
  if (!id) throw new CardConsumptionLedgerError('id is required', 'INVALID_ARGUMENT');
  const [result] = await pool.query(
    `UPDATE card_consumption_ledger SET status='CONSUMED', provider_transaction_id=COALESCE(?, provider_transaction_id),
       consumed_at=COALESCE(consumed_at,CURRENT_TIMESTAMP(3)), evidence_json=COALESCE(?,evidence_json)
     WHERE id=? AND status='RESERVED'`,
    [providerTransactionId, evidence == null ? null : JSON.stringify(evidence), id]
  );
  if (result.affectedRows !== 1) throw new CardConsumptionLedgerError('reservation is not active', 'RESERVATION_NOT_ACTIVE');
  return { id, status: 'CONSUMED' };
}

export async function releaseCardConsumption(pool, { id, reason } = {}) {
  if (!id || !reason) throw new CardConsumptionLedgerError('id and reason are required', 'INVALID_ARGUMENT');
  const [result] = await pool.query(
    `UPDATE card_consumption_ledger SET status='RELEASED', released_at=COALESCE(released_at,CURRENT_TIMESTAMP(3)), release_reason=?
     WHERE id=? AND status='RESERVED'`, [String(reason).slice(0, 500), id]
  );
  if (result.affectedRows !== 1) throw new CardConsumptionLedgerError('reservation is not active', 'RESERVATION_NOT_ACTIVE');
  return { id, status: 'RELEASED' };
}
