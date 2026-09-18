import { isEnvTrue, loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { chargeRowSql, settledStatusSql } from '../src/domain/card-transaction-audit.js';
import { pathToFileURL } from 'node:url';

/**
 * Read-only comparison of the local consumption ledger and Provider purchase
 * evidence. It produces a discrepancy report and never changes application
 * state. Historical rows are intentionally not auto-filled.
 *
 * 第⑤步（D-257）：判据从这里搬到 `domain/card-transaction-audit.js`，与日对账共用一份。
 * 原来写死的 `LOWER(status)='success'` 漏掉 hnskj 的 `SETTLED`（3 笔）与 highvcc 的
 * `COMPLETE`/`PENDING`（23 笔）——1652、5980 有真实扣款却被算成 0 笔（D-256 发现 1）。
 * 日常那份「两种对账」跑的是 `daily-reconciliation-runner.js`；这个脚本保留为单看次数的只读工具。
 */
export async function runCardConsumptionAudit({ pool, limit = 10000 } = {}) {
  const safeLimit = Math.min(100000, Math.max(1, Number(limit) || 10000));
  const [rows] = await pool.query(
    `SELECT c.id AS card_id, c.provider_card_id, c.last4,
            COALESCE(l.consumed_count, 0) AS ledger_consumed,
            COALESCE(l.reserved_count, 0) AS ledger_reserved,
            COALESCE(l.reconciliation_count, 0) AS ledger_reconciliation,
            COALESCE(p.provider_purchase_count, 0) AS provider_purchase_success,
            COALESCE(p.provider_settled_count, 0) AS provider_settled_count,
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
       SELECT t.card_id,
              COUNT(*) AS provider_purchase_count,
              SUM(${settledStatusSql('t')}) AS provider_settled_count,
              GROUP_CONCAT(t.provider_transaction_id ORDER BY t.trade_time_raw SEPARATOR ',') AS provider_transaction_ids
       FROM card_transactions t
       WHERE ${chargeRowSql('t')}
       GROUP BY t.card_id
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
        // 已清算 vs 还挂着的授权：两者都是真实扣款，但运营看板要能分开（D-257）。
        settled: Number(row.provider_settled_count || 0),
        pending: providerPurchases - Number(row.provider_settled_count || 0),
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
