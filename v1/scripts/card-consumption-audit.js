import { isEnvTrue, loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { pathToFileURL } from 'node:url';

/**
 * Read-only comparison of the local consumption ledger and Provider purchase
 * evidence. It produces a discrepancy report and never changes application
 * state. Historical rows are intentionally not auto-filled.
 */
export async function runCardConsumptionAudit({ pool, limit = 10000 } = {}) {
  const safeLimit = Math.min(100000, Math.max(1, Number(limit) || 10000));
  const [rows] = await pool.query(
    `SELECT c.id AS card_id, c.provider_card_id, c.last4,
            COALESCE(l.consumed_count, 0) AS ledger_consumed,
            COALESCE(l.reserved_count, 0) AS ledger_reserved,
            COALESCE(l.reconciliation_count, 0) AS ledger_reconciliation,
            COALESCE(p.provider_purchase_count, 0) AS provider_purchase_success,
            p.provider_transaction_ids
     FROM cards c
     LEFT JOIN (
       SELECT card_id,
              SUM(status = 'CONSUMED') AS consumed_count,
              SUM(status = 'RESERVED') AS reserved_count,
              SUM(status = 'RECONCILIATION') AS reconciliation_count
       FROM card_consumption_ledger
       GROUP BY card_id
     ) l ON l.card_id = c.id
     LEFT JOIN (
       SELECT card_id,
              COUNT(*) AS provider_purchase_count,
              GROUP_CONCAT(provider_transaction_id ORDER BY trade_time_raw SEPARATOR ',') AS provider_transaction_ids
       FROM card_transactions
       WHERE LOWER(transaction_type) = 'purchase' AND LOWER(status) = 'success'
       GROUP BY card_id
     ) p ON p.card_id = c.id
     ORDER BY c.provider_card_id
     LIMIT ${safeLimit}`
  );
  const cards = rows.map((row) => {
    const ledgerConsumed = Number(row.ledger_consumed || 0);
    const providerPurchases = Number(row.provider_purchase_success || 0);
    const discrepancy = ledgerConsumed !== providerPurchases;
    const recommendedAction = !discrepancy
      ? 'NONE'
      : providerPurchases > ledgerConsumed
        ? 'BACKFILL_REVIEW_REQUIRED'
        : 'LEDGER_REVIEW_REQUIRED';
    return {
      providerCardId: row.provider_card_id,
      last4: row.last4,
      ledger: {
        consumed: ledgerConsumed,
        reserved: Number(row.ledger_reserved || 0),
        reconciliation: Number(row.ledger_reconciliation || 0)
      },
      provider: {
        purchaseSuccess: providerPurchases,
        transactionIds: row.provider_transaction_ids
          ? String(row.provider_transaction_ids).split(',').filter(Boolean) : []
      },
      discrepancy,
      recommendedAction,
      reason: discrepancy
        ? '本地消费账本与 Provider 成功 PURCHASE 数量不一致，需人工核对'
        : null
    };
  });
  return {
    readOnly: true,
    generatedAt: new Date().toISOString(),
    cardCount: cards.length,
    discrepancyCount: cards.filter((card) => card.discrepancy).length,
    backfillReviewCount: cards.filter((card) => card.recommendedAction === 'BACKFILL_REVIEW_REQUIRED').length,
    ledgerReviewCount: cards.filter((card) => card.recommendedAction === 'LEDGER_REVIEW_REQUIRED').length,
    cards
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED)
    || isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)
    || isEnvTrue(process.env.PROVIDER_RECHARGE_WRITES_ENABLED)) {
    throw new Error('Card consumption audit refuses to run while provider writes are enabled');
  }
  const pool = createDatabasePool(loadRuntimeDatabaseConfig());
  try {
    console.log(JSON.stringify(await runCardConsumptionAudit({ pool })));
  } catch (error) {
    console.error(JSON.stringify({ readOnly: true, auditFailed: true, code: error?.code || 'CARD_CONSUMPTION_AUDIT_FAILED' }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
