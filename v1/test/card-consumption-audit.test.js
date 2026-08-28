import assert from 'node:assert/strict';
import test from 'node:test';
import { runCardConsumptionAudit } from '../scripts/card-consumption-audit.js';

test('card consumption audit is read-only and reports count mismatches', async () => {
  const queries = [];
  const pool = { async query(sql) {
    queries.push(sql);
    return [[{
      provider_card_id: 'card-1', last4: '6807', ledger_consumed: 1,
      ledger_reserved: 1, ledger_reconciliation: 0,
      provider_purchase_success: 2, provider_transaction_ids: 'tx-1,tx-2'
    }], []];
  }};
  const report = await runCardConsumptionAudit({ pool });
  assert.equal(report.readOnly, true);
  assert.equal(report.discrepancyCount, 1);
  assert.equal(report.backfillReviewCount, 1);
  assert.equal(report.cards[0].recommendedAction, 'BACKFILL_REVIEW_REQUIRED');
  assert.deepEqual(report.cards[0].provider.transactionIds, ['tx-1', 'tx-2']);
  assert.equal(queries.every((sql) => !/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), true);
});
