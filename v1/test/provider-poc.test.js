import assert from 'node:assert/strict';
import test from 'node:test';
import { mapCardCredentials, mapPurchasedCard, runProviderPoc } from '../scripts/provider-poc.js';
import { sessionFixture } from '../test-support/session-fixture.js';

test('provider PoC maps known card response shapes', () => {
  assert.equal(mapPurchasedCard({ data: { card: { id: 'card-1' } } }), 'card-1');
  assert.deepEqual(mapCardCredentials({
    data: { number: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123' }
  }), {
    cardNumber: '4242424242424242',
    expMonth: 12,
    expYear: 2032,
    cvv: '123'
  });
});

test('provider PoC performs exactly one purchase and one recharge submission', async () => {
  const calls = [];
  const checkpoints = [];
  let statusQueries = 0;
  const hnskj = {
    cardTypes: async () => ({
      data: {
        purchaseEnabled: true,
        cardTypes: [{ id: 7, minAmount: '20', maxAmount: '100' }]
      }
    }),
    accountBalance: async () => ({ data: { balance: calls.length ? '72.00' : '100.00' } }),
    purchaseCard: async (input) => {
      calls.push(['purchase', input]);
      return { data: { card: { id: 'card-1' } } };
    },
    card: async (cardId) => {
      calls.push(['card', cardId]);
      return { data: { number: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123' } };
    }
  };
  const zzshu = {
    createDirectOrder: async (input) => {
      calls.push(['recharge', input]);
      return { orderNo: 'order-1', cardKey: 'DIRECT-1', status: 'processing' };
    },
    queryStatus: async (cardKey) => {
      calls.push(['status', cardKey]);
      statusQueries += 1;
      return statusQueries === 1
        ? { status: 'processing', isSubscriptionCancelled: 0 }
        : { status: 'success', isSubscriptionCancelled: 1 };
    }
  };

  const result = await runProviderPoc({
    hnskj,
    zzshu,
    session: sessionFixture(),
    cardTypeId: 7,
    amount: 25,
    idempotencyKey: 'pojia-poc-fixed-key',
    checkpoint: async (state) => checkpoints.push(state),
    wait: async () => {},
    pollDelayMs: 0,
    cancellationDelayMs: 0,
    maxPolls: 2
  });

  assert.equal(calls.filter(([name]) => name === 'purchase').length, 1);
  assert.equal(calls.filter(([name]) => name === 'recharge').length, 1);
  assert.equal(result.cardLast4, '4242');
  assert.equal(result.rechargeOrderNo, 'order-1');
  assert.equal(result.rechargeStatus, 'success');
  assert.equal(JSON.stringify(result).includes('4242424242424242'), false);
  assert.equal(JSON.stringify(result).includes('123'), false);
  assert.equal(checkpoints.some((state) => state.phase === 'CARD_PURCHASED'), true);
  const created = checkpoints.find((state) => state.phase === 'RECHARGE_CREATED');
  assert.equal(created.rechargeOrderNo, 'order-1');
  assert.equal(created.rechargeCardKey, 'DIRECT-1');
  assert.equal(JSON.stringify(checkpoints).includes('4242424242424242'), false);
});

test('provider PoC stops before purchase when amount is outside the live card range', async () => {
  let purchased = false;
  await assert.rejects(
    runProviderPoc({
      hnskj: {
        cardTypes: async () => ({
          data: {
            purchaseEnabled: true,
            cardTypes: [{ id: 7, minAmount: '20', maxAmount: '100' }]
          }
        }),
        purchaseCard: async () => { purchased = true; }
      },
      zzshu: {},
      session: sessionFixture(),
      cardTypeId: 7,
      amount: 10
    }),
    /20-100/
  );
  assert.equal(purchased, false);
});
