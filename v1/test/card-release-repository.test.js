import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCardForFailedOrderInTransaction } from '../src/db/repositories/card-release-repository.js';

function fakeConnection(results) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (!results.length) throw new Error('Unexpected query');
      return [results.shift(), []];
    }
  };
}

test('releasing a failed order frees its ACTIVE assignment and resets only unheld cards', async () => {
  const now = new Date('2026-09-08T00:00:00.000Z');
  const connection = fakeConnection([
    [{ setting_value: '16.00' }], [{ minimum_required_card_balance: '8.000000' }],
    { affectedRows: 1 }, { affectedRows: 1 }
  ]);
  const result = await releaseCardForFailedOrderInTransaction(connection, {
    orderId: 'order-1', releasedBy: 'browser:pre-payment-abort', reason: 'pre-payment abort: BROWSER_RETRY_LIMIT', now
  });
  assert.deepEqual(result, { releasedAssignments: 1, resetCards: 1, minimumBalance: 16 });
  assert.match(connection.queries[2].sql, /UPDATE card_assignment_history\s+SET status = 'RELEASED'/);
  assert.deepEqual(connection.queries[2].values, ['browser:pre-payment-abort', 'pre-payment abort: BROWSER_RETRY_LIMIT', now, now, 'order-1']);
  const cards = connection.queries[3].sql;
  assert.match(cards, /c\.sync_tier = 'MANUAL_IMPORT' THEN c\.sync_tier/);
  assert.match(cards, /c\.inventory_status = CASE WHEN c\.current_balance >= \? THEN 'AVAILABLE' ELSE 'DEPLETED' END/);
  assert.match(cards, /c\.order_id = CASE WHEN c\.order_id = o\.id THEN NULL ELSE c\.order_id END/);
  assert.match(cards, /NOT EXISTS \(SELECT 1 FROM card_assignment_history other/);
  assert.deepEqual(connection.queries[3].values, [16, now, 16, 16, now, 'order-1']);
});

test('the global minimum balance wins over the order snapshot, falling back when unset', async () => {
  const connection = fakeConnection([[], [{ minimum_required_card_balance: '8.000000' }], { affectedRows: 0 }, { affectedRows: 0 }]);
  const result = await releaseCardForFailedOrderInTransaction(connection, { orderId: 'order-2', releasedBy: 'admin', reason: 'x' });
  assert.equal(result.minimumBalance, 8);
  assert.deepEqual([result.releasedAssignments, result.resetCards], [0, 0]);
  await assert.rejects(() => releaseCardForFailedOrderInTransaction(fakeConnection([]), { orderId: '', releasedBy: 'a', reason: 'b' }), /orderId is required/);
});
