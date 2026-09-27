import assert from 'node:assert/strict';
import test from 'node:test';
import { persistCardTransactions } from '../src/db/repositories/card-transaction-repository.js';
import { successfulPurchaseSql } from '../src/domain/card-purchase-evidence.js';

test('a completed card sync runs the narrow post-failure reconciliation release', async () => {
  const queries = [];
  const connection = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      return [{ affectedRows: 1 }];
    }
  };

  await persistCardTransactions(connection, {
    cardId: 'card-1',
    orderId: 'order-1',
    transactions: [{
      id: 'funding-1', type: 'CARD_RECHARGE', status: 'SUCCESS', amount: '16',
      currency: 'USD', rawHash: 'hash-1', classification: 'NOT_REFUND'
    }],
    cardSnapshot: { currentBalance: '16', currency: 'USD' }
  });

  const ledgerRelease = queries.find(({ sql }) => sql.includes('UPDATE card_consumption_ledger l'));
  assert.ok(ledgerRelease);
  assert.deepEqual(ledgerRelease.parameters, ['card-1']);
  assert.match(ledgerRelease.sql, /o\.status = 'RECHARGE_FAILED'/);
  assert.match(ledgerRelease.sql, /o\.failure_code = 'PROVIDER_CONFIRMED_FAILURE'/);
  assert.match(ledgerRelease.sql, /ra\.status = 'FAILED'.*ra\.funds_risk_state = 'CLEARED'/s);
  assert.match(ledgerRelease.sql, /c\.last_transaction_synced_at >= ra\.finished_at/);
  assert.match(ledgerRelease.sql, /c\.current_balance >= l\.amount/);
  // 「成功扣款」与放卡退卡密 / 每周自检同一份口径；highvcc 的 COMPLETE 也算扣款（2026-09-27 前只认 success）。
  assert.ok(ledgerRelease.sql.includes(successfulPurchaseSql('purchase')));
  assert.match(successfulPurchaseSql('purchase'), /'complete', 'success', 'settled'/);

  const assignmentRelease = queries.find(({ sql }) => sql.includes('UPDATE card_assignment_history h'));
  assert.ok(assignmentRelease);
  assert.deepEqual(assignmentRelease.parameters, ['card-1']);

  // 卡自动放回后，那条「充值失败，要你处理」一起关掉（只关本次放回的订单）。
  const alertResolve = queries.find(({ sql }) => sql.includes('UPDATE operator_alerts oa'));
  assert.ok(alertResolve);
  assert.deepEqual(alertResolve.parameters, ['card-1']);
  assert.match(alertResolve.sql, /CONCAT\('api-order-failed:', l\.order_id\)/);
  assert.match(alertResolve.sql, /l\.release_reason = 'provider failure confirmed; card sync found no successful purchase'/);
});
