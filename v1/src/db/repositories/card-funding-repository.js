import crypto from 'node:crypto';
import { PublicApiError } from '../../domain/public-api-error.js';
import { finishProviderCall } from './provider-call-repository.js';
import { eligibleInventoryCardSql } from '../../services/card-inventory-eligibility.js';

function decimalAmount(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text) || Number(text) <= 0) {
    throw new PublicApiError('Card funding amount must be positive', {
      code: 'CARD_FUNDING_AMOUNT_INVALID', status: 400
    });
  }
  return text;
}

async function withTransaction(pool, action) {
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

export function createCardFundingRepository(pool) {
  async function prepare({ cardId, amount, currency = 'USD', providerAccountId, orderId = null,
    idempotencyKey = crypto.randomUUID() }) {
    const card = String(cardId || '').trim();
    const provider = String(providerAccountId || '').trim();
    const key = String(idempotencyKey || '').trim();
    if (!card || !provider || key.length < 16 || key.length > 191) {
      throw new PublicApiError('Card funding identity is invalid', {
        code: 'CARD_FUNDING_IDENTITY_INVALID', status: 400
      });
    }
    const value = decimalAmount(amount);
    return withTransaction(pool, async (connection) => {
      const [existing] = await connection.query(
        `SELECT id, status, funds_risk_state, card_id, amount, currency
         FROM card_funding_attempts WHERE provider_account_id = ? AND idempotency_key = ?
         LIMIT 1 FOR UPDATE`, [provider, key]
      );
      if (existing.length) return { created: false, attempt: existing[0] };
      const [cards] = await connection.query(
        `SELECT id, order_id, inventory_status, status, card_credentials_ciphertext
         FROM cards
         WHERE id = ? AND ${eligibleInventoryCardSql('cards', '0')}
         LIMIT 1 FOR UPDATE`, [card]
      );
      const row = cards[0];
      if (!row || row.order_id !== null || row.inventory_status !== 'AVAILABLE'
        || !['active', 'available', 'usable', 'ready'].includes(String(row.status).toLowerCase())
        || !row.card_credentials_ciphertext) {
        throw new PublicApiError('Card is not eligible for balance funding', {
          code: 'CARD_FUNDING_CARD_NOT_ELIGIBLE', status: 409
        });
      }
      const id = crypto.randomUUID();
      await connection.query(
        `INSERT INTO card_funding_attempts
         (id, card_id, order_id, provider_account_id, amount, currency, status,
          funds_risk_state, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, 'PREPARED', 'NONE', ?)`,
        [id, card, orderId, provider, value, String(currency).toUpperCase(), key]
      );
      return { created: true, attempt: { id, card_id: card, order_id: orderId,
        provider_account_id: provider, amount: value, currency: String(currency).toUpperCase(),
        status: 'PREPARED', funds_risk_state: 'NONE', idempotency_key: key } };
    });
  }

  async function begin({ attemptId, provider, providerAccountId, requestKey, startedAt = new Date() }) {
    const result = await withTransaction(pool, async (connection) => {
      const [rows] = await connection.query(
        `SELECT * FROM card_funding_attempts WHERE id = ? LIMIT 1 FOR UPDATE`, [attemptId]
      );
      if (rows.length !== 1) throw new PublicApiError('Card funding attempt not found', {
        code: 'CARD_FUNDING_NOT_FOUND', status: 404
      });
      const attempt = rows[0];
      if (providerAccountId && String(providerAccountId) !== String(attempt.provider_account_id)) {
        throw new PublicApiError('Card funding provider account mismatch', {
          code: 'CARD_FUNDING_PROVIDER_MISMATCH', status: 409
        });
      }
      if (attempt.status !== 'PREPARED' || attempt.funds_risk_state !== 'NONE') {
        throw new PublicApiError('Card funding attempt is not submit-ready', {
          code: 'CARD_FUNDING_NOT_SUBMIT_READY', status: 409
        });
      }
      await connection.query(
        `UPDATE card_funding_attempts
         SET status='SUBMITTING', funds_risk_state='ACTIVE', submit_intent_at=?
         WHERE id=? AND status='PREPARED' AND funds_risk_state='NONE'`, [startedAt, attemptId]
      );
      const [call] = await connection.query(
        `INSERT INTO provider_calls
         (order_id, card_funding_attempt_id, provider, provider_account_id,
          operation, request_key, attempt_no, outcome, started_at)
         VALUES (?, ?, ?, ?, 'card_recharge', ?, 1, 'STARTED', ?)`,
        [attempt.order_id, attemptId, provider, providerAccountId || attempt.provider_account_id,
          requestKey, startedAt]
      );
      return { attemptId, providerCallId: call.insertId, cardId: attempt.card_id,
        amount: String(attempt.amount), currency: attempt.currency, requestKey };
    });
    return result;
  }

  async function finish({ attemptId, providerCallId, outcome, httpStatus = null,
    businessCode = null, responseSummary = null, fundsRiskState, status,
    externalReference = null, finishedAt = new Date() }) {
    await finishProviderCall(pool, { callId: providerCallId, outcome, httpStatus,
      businessCode, responseSummary, finishedAt,
      durationMs: null });
    const [result] = await pool.query(
      `UPDATE card_funding_attempts
       SET status=?, funds_risk_state=?, external_reference=COALESCE(?, external_reference),
           submitted_at=IF(? IN ('PENDING','SETTLED'), COALESCE(submitted_at, ?), submitted_at),
           finished_at=IF(? IN ('SETTLED','FAILED','MANUAL_REVIEW'), ?, finished_at),
           last_reconciled_at=IF(? IN ('SETTLED','FAILED'), ?, last_reconciled_at),
           result_summary_json=?
       WHERE id=? AND status='SUBMITTING'`,
      [status, fundsRiskState, externalReference, status, finishedAt, status, finishedAt,
        status, finishedAt, responseSummary ? JSON.stringify(responseSummary) : null, attemptId]
    );
    if (result.affectedRows !== 1) throw new Error('Card funding attempt state transition lost');
  }

  return { prepare, begin, finish };
}
