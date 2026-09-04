import assert from 'node:assert/strict';
import test from 'node:test';
import { persistCardTransactions } from '../src/db/repositories/card-transaction-repository.js';

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
  assert.match(ledgerRelease.sql, /transaction_type = 'PURCHASE'/);
  assert.match(ledgerRelease.sql, /LOWER\(purchase\.status\) = 'success'/);

  const assignmentRelease = queries.find(({ sql }) => sql.includes('UPDATE card_assignment_history h'));
  assert.ok(assignmentRelease);
  assert.deepEqual(assignmentRelease.parameters, ['card-1']);
});
