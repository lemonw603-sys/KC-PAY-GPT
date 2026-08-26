import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CardTransactionReadError,
  readAllCardTransactions
} from '../src/services/card-transaction-reader.js';

test('reads every transaction page and keeps classification evidence', async () => {
  const pages = [];
  const transactions = await readAllCardTransactions({
    pageSize: 2,
    fetchPage: async (page, pageSize) => {
      pages.push([page, pageSize]);
      const all = [
        { id: 't-1', type: 'consume', status: 'success', amount: '-20', currency: 'USD' },
        { id: 't-2', type: 'card_recharge', status: 'success', amount: '20', currency: 'USD' },
        { id: 't-3', type: 'refund', status: 'success', amount: '20', currency: 'USD', relatedTxnId: 't-1' }
      ];
      return { data: { page, pageSize, total: all.length,
        transactions: all.slice((page - 1) * pageSize, page * pageSize) } };
    }
  });
  assert.deepEqual(pages, [[1, 2], [2, 2]]);
  assert.equal(transactions.length, 3);
  assert.equal(transactions[1].classification, 'NOT_REFUND');
  assert.equal(transactions[2].classification, 'REFUND_CANDIDATE');
  assert.match(transactions[0].rawHash, /^[a-f0-9]{64}$/);
});

test('fails closed on drifting pagination metadata', async () => {
  await assert.rejects(
    readAllCardTransactions({ fetchPage: async () => ({
      data: { page: 2, pageSize: 50, total: 1, transactions: [] }
    }) }),
    (error) => error instanceof CardTransactionReadError
      && error.code === 'TRANSACTION_PAGINATION_INVALID'
  );
});
