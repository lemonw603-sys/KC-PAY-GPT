import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCardTransaction } from '../src/domain/card-transaction-classification.js';

test('card recharge is never classified as a refund', () => {
  assert.equal(classifyCardTransaction({ type: 'card_recharge', amount: 16 }), 'NOT_REFUND');
  assert.equal(classifyCardTransaction({ transaction_type: 'CARD_RECHARGE', amount: -16 }), 'NOT_REFUND');
});

test('card balance return is not automatically a refund or a non-refund', () => {
  assert.equal(classifyCardTransaction({ type: 'card_balance_return', amount: 0.01 }), 'UNKNOWN');
});

test('only explicit refund transaction types become candidates', () => {
  assert.equal(classifyCardTransaction({ type: 'REFUND', amount: 15.97 }), 'REFUND_CANDIDATE');
  assert.equal(classifyCardTransaction({ type: 'purchase', amount: -15.97 }), 'UNKNOWN');
  assert.equal(classifyCardTransaction({ type: 'unknown', amount: 15.97 }), 'UNKNOWN');
});
