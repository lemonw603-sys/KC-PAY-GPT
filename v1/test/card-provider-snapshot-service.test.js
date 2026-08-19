import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCardStockRequest,
  normalizeProviderSnapshot,
  snapshotIsFresh
} from '../src/services/card-provider-snapshot-service.js';

function snapshot({ balance = '35.71', remaining = 295, checkedAt = new Date() } = {}) {
  return normalizeProviderSnapshot({
    checkedAt,
    accountBalance: { data: { balance, currency: 'USD', exchangeRate: '1' } },
    cardTypes: { data: {
      purchaseEnabled: true,
      exchangeRate: 1,
      cardLimit: { currentCount: 5, maxLimit: 300, remaining },
      cardTypes: [{
        id: 1, cardType: 'Z-43612081', cardCountry: 'US', binPrefix: '43612081',
        effectiveCardFeeUsdt: '0.50', effectiveFeeRate: '0.005',
        minAmount: '5', maxAmount: '200', minBalanceUsdt: '25',
        requireMinBalance: 1, consumeRate: '0', chargebackFee: '0.40'
      }]
    } }
  });
}

test('uses live card rules and includes all provider fees', () => {
  const result = evaluateCardStockRequest(snapshot({ balance: '100' }), {
    cardTypeId: '1', amount: 16, count: 2
  });
  assert.equal(result.totalPerCard, '16.58');
  assert.equal(result.estimatedTotal, '33.16');
  assert.equal(result.cardType.name, 'Z-43612081');
});

test('allows more than ten cards when live quota and balance permit it', () => {
  const result = evaluateCardStockRequest(snapshot({ balance: '1000', remaining: 30 }), {
    cardTypeId: '1', amount: 5, count: 12
  });
  assert.equal(result.count, 12);
  assert.equal(result.estimatedTotal, '66.3');
});

test('rejects amount, card type, quota and balance before a paid call', () => {
  assert.throws(() => evaluateCardStockRequest(snapshot(), {
    cardTypeId: '1', amount: 4, count: 1
  }), (error) => error.code === 'CARD_STOCK_AMOUNT_OUT_OF_RANGE');
  assert.throws(() => evaluateCardStockRequest(snapshot(), {
    cardTypeId: '2', amount: 16, count: 1
  }), (error) => error.code === 'CARD_STOCK_CARD_TYPE_UNAVAILABLE');
  assert.throws(() => evaluateCardStockRequest(snapshot({ remaining: 1, balance: '100' }), {
    cardTypeId: '1', amount: 16, count: 2
  }), (error) => error.code === 'CARD_STOCK_LIMIT_INSUFFICIENT');
  assert.throws(() => evaluateCardStockRequest(snapshot(), {
    cardTypeId: '1', amount: 16, count: 2
  }), (error) => error.code === 'CARD_STOCK_BALANCE_INSUFFICIENT');
});

test('detects stale provider snapshots', () => {
  assert.equal(snapshotIsFresh(snapshot({ checkedAt: new Date(Date.now() - 121_000) })), false);
  assert.equal(snapshotIsFresh(snapshot()), true);
});
