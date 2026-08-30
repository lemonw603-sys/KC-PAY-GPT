import crypto from 'node:crypto';
import { fundableInventoryCardSql } from './card-inventory-eligibility.js';
import { resolveCurrentCardProviderAccount } from './provider-route-service.js';

function topUpAmount(minimum, current) {
  // Keep the provider write to the smallest DECIMAL(18,6) amount that reaches
  // the configured floor; rounding whole dollars silently overfunds every
  // fractional-balance card and multiplies API cost over time.
  const delta = Number(minimum) - Number(current || 0);
  return Math.max(0.000001, Number(delta.toFixed(6))).toFixed(6);
}

export function createCardFundingScheduler({ pool, fundingRepository }) {
  async function scheduleLowBalance({ limit = 10, now = new Date() } = {}) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[setting]] = await connection.query(
        `SELECT setting_value FROM app_settings
         WHERE setting_key = 'card_balance_recharge_enabled' LIMIT 1 FOR UPDATE`
      );
      if (setting?.setting_value !== 'true') {
        await connection.commit();
        return { enabled: false, scheduled: 0 };
      }
      const [[minimumRow]] = await connection.query(
        `SELECT setting_value FROM app_settings
         WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1`
      );
      const minimum = Number(minimumRow?.setting_value);
      if (!Number.isFinite(minimum) || minimum <= 0) {
        await connection.commit();
        return { enabled: true, scheduled: 0, reason: 'MINIMUM_BALANCE_UNCONFIGURED' };
      }
      const providerAccountId = await resolveCurrentCardProviderAccount(connection);
      if (!providerAccountId) {
        await connection.commit();
        return { enabled: true, scheduled: 0, reason: 'CARD_PROVIDER_ROUTE_UNAVAILABLE' };
      }
      const [cards] = await connection.query(
        `SELECT c.id, c.current_balance
         FROM cards c
         WHERE ${fundableInventoryCardSql('c')}
           AND c.provider_account_id = ?
           AND c.current_balance < ?
           AND NOT EXISTS (
             SELECT 1 FROM card_funding_attempts fa
             WHERE fa.card_id = c.id
               -- A settled top-up is historical evidence, not a live fence.
               -- The card may legitimately need another top-up after it is
               -- spent down; only an unsubmitted or unresolved attempt must
               -- suppress a new one.
               AND (fa.status = 'PREPARED' OR fa.funds_risk_state IN ('ACTIVE','UNKNOWN'))
           )
         ORDER BY c.current_balance ASC, c.updated_at ASC
         LIMIT ? FOR UPDATE SKIP LOCKED`,
        [providerAccountId, String(minimum), safeLimit]
      );
      const created = [];
      for (const card of cards) {
        const amount = topUpAmount(minimum, card.current_balance);
        const attemptId = crypto.randomUUID();
        const [inserted] = await connection.query(
          `INSERT INTO card_funding_attempts
           (id, card_id, order_id, provider_account_id, amount, currency, status,
            funds_risk_state, idempotency_key)
           VALUES (?, ?, NULL, ?, ?, 'USD', 'PREPARED', 'NONE', ?)
           ON DUPLICATE KEY UPDATE id = id`,
          [attemptId, card.id, providerAccountId, amount,
            `card-funding:${attemptId}`]
        );
        if (Number(inserted.affectedRows) === 1) {
          created.push({ id: attemptId, cardId: card.id, amount: String(amount) });
        }
      }
      await connection.commit();
      return { enabled: true, scheduled: created.length, attempts: created };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { scheduleLowBalance };
}
