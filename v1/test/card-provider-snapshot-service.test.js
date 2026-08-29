import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCardStockRequest,
  normalizeProviderSnapshot,
  providerSupportedCardTypeIds,
  refreshProviderSnapshot,
  snapshotIsFresh
} from '../src/services/card-provider-snapshot-service.js';

test('accepts every advertised card segment and uses the opening default only as fallback', () => {
  assert.deepEqual(providerSupportedCardTypeIds({
    cardTypes: [{ id: 16 }, { id: '17' }, { id: 17 }]
  }, 16), ['16', '17']);
  assert.deepEqual(providerSupportedCardTypeIds({ cardTypes: [] }, 16), ['16']);
});

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

test('appends immutable balance evidence before updating the current provider snapshot', async () => {
  const calls = [];
  const provider = {
    accountBalance: async () => ({ data: { balance: '100.25', currency: 'USD', exchangeRate: '1' } })
  };
  provider.cardTypes = async () => ({ data: {
    purchaseEnabled: true,
    exchangeRate: 1,
    cardLimit: { currentCount: 5, maxLimit: 300, remaining: 295 },
    cardTypes: [{
      id: 1, cardType: 'Z-43612081', cardCountry: 'US', binPrefix: '43612081',
      effectiveCardFeeUsdt: '0.50', effectiveFeeRate: '0.005', minAmount: '5',
      maxAmount: '200', minBalanceUsdt: '25', requireMinBalance: 1,
      consumeRate: '0', chargebackFee: '0.40'
    }]
  } });
  const checkedAt = new Date('2026-08-20T12:00:00.000Z');
  const pool = { async query(sql, values) { calls.push({ kind: 'current', sql, values }); return [{ affectedRows: 1 }, []]; } };
  const balanceSnapshotService = {
    async recordSnapshot(input) { calls.push({ kind: 'history', input }); }
  };

  await refreshProviderSnapshot(pool, provider, { checkedAt, balanceSnapshotService });

  assert.equal(calls[0].kind, 'history');
  assert.equal(calls[0].input.availableBalance, '100.25');
  assert.equal(calls[0].input.currency, 'USD');
  assert.equal(calls[0].input.observedAt, checkedAt);
  assert.equal(calls[1].kind, 'current');
});
