import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapCardCredentials,
  mapPurchasedCard,
  runExistingCardPoc,
  runProviderPoc
} from '../scripts/provider-poc.js';
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
    cards: async () => ({ data: { cards: [], total: 0 } }),
    purchaseCard: async (input) => {
      calls.push(['purchase', input]);
      return { data: { card: { id: 'card-1' } } };
    },
    card: async (cardId) => {
      calls.push(['card', cardId]);
      return {
        data: {
          id: 'card-1', status: 'active', cardBalance: '25.00', currency: 'USD',
          number: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
        }
      };
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
    minimumCardBalance: 20,
    idempotencyKey: 'pojia-poc-fixed-key',
    checkpoint: async (state) => checkpoints.push(state),
    wait: async () => {},
    pollDelayMs: 0,
    cancellationDelayMs: 0,
    maxPolls: 2,
    allowRechargeSubmission: true
  });

  assert.equal(calls.filter(([name]) => name === 'purchase').length, 1);
  assert.equal(calls.filter(([name]) => name === 'recharge').length, 1);
  assert.equal(result.cardLast4, '4242');
  assert.equal(result.rechargeOrderNo, 'order-1');
  assert.equal(result.rechargeStatus, 'success');
  assert.equal(JSON.stringify(result).includes('4242424242424242'), false);
  assert.equal(JSON.stringify(result).includes('123'), false);
  assert.equal(checkpoints.some((state) => state.phase === 'CARD_IDENTIFIED'), true);
  const created = checkpoints.find((state) => state.phase === 'RECHARGE_CREATED');
  assert.equal(created.rechargeOrderNo, 'order-1');
  assert.equal(created.rechargeCardKey, 'DIRECT-1');
  assert.equal(JSON.stringify(checkpoints).includes('4242424242424242'), false);
});

test('provider PoC defaults to a hard stop before direct recharge submission', async () => {
  let submitted = false;
  const checkpoints = [];
  const hnskj = {
    cardTypes: async () => ({ data: { purchaseEnabled: true, cardTypes: [{ id: 7, minAmount: '20', maxAmount: '100' }] } }),
    accountBalance: async () => ({ data: { balance: '100.00' } }),
    cards: async () => ({ data: { cards: [], total: 0 } }),
    purchaseCard: async () => ({ data: { card: { id: 'card-stop' } } }),
    card: async () => ({ data: {
      id: 'card-stop', status: 'active', cardBalance: '25.00', currency: 'USD',
      number: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
    } })
  };
  const result = await runProviderPoc({
    hnskj,
    zzshu: { createDirectOrder: async () => { submitted = true; } },
    session: sessionFixture(),
    cardTypeId: 7,
    amount: 25,
    minimumCardBalance: 20,
    checkpoint: async (state) => checkpoints.push(state),
    wait: async () => {},
    pollDelayMs: 0,
    recoveryPolls: 1
  });
  assert.equal(submitted, false);
  assert.equal(result.rechargeStatus, 'PREPAYMENT_STOPPED');
  assert.equal(result.submitted, false);
  assert.equal(checkpoints.at(-1).phase, 'PREPAYMENT_READY');
  assert.equal(checkpoints.at(-1).requestPath, '/third-party/orders/direct');
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
      amount: 10,
      minimumCardBalance: 10
    }),
    /20-100/
  );
  assert.equal(purchased, false);
});

test('provider PoC recovers a missing purchase response ID and waits for a ready card', async () => {
  const calls = [];
  let listCalls = 0;
  const hnskj = {
    cardTypes: async () => ({
      data: {
        purchaseEnabled: true,
        cardTypes: [{ id: 1, cardType: 'Z-43612081', minAmount: '5', maxAmount: '200' }]
      }
    }),
    accountBalance: async () => ({ data: { balance: '100.00' } }),
    cards: async () => {
      listCalls += 1;
      return {
        data: {
          total: listCalls === 1 ? 1 : 2,
          cards: listCalls === 1
            ? [{ id: 444, cardType: 'Z-43612081', status: 'active' }]
            : [
                { id: 451, cardType: 'Z-43612081', status: 'processing' },
                { id: 444, cardType: 'Z-43612081', status: 'active' }
              ]
        }
      };
    },
    purchaseCard: async () => ({ data: { accepted: true } }),
    card: async (cardId) => {
      calls.push(['card', cardId]);
      return {
        data: {
          id: 451, status: 'active', cardBalance: '16.00', currency: 'USD',
          cardNumber: '4242424242429767', expMonth: 12, expYear: 2032, cvv: '123'
        }
      };
    }
  };
  const zzshu = {
    createDirectOrder: async () => ({ orderNo: 'order-recovered', cardKey: 'DIRECT-recovered' }),
    queryStatus: async () => ({ status: 'success', isSubscriptionCancelled: 1 })
  };

  const result = await runProviderPoc({
    hnskj,
    zzshu,
    session: sessionFixture(),
    cardTypeId: 1,
    amount: 16,
    minimumCardBalance: 15.5,
    checkpoint: async () => {},
    wait: async () => {},
    pollDelayMs: 0,
    cancellationDelayMs: 0,
    maxPolls: 1,
    recoveryPolls: 1,
    allowRechargeSubmission: true
  });

  assert.equal(result.providerCardId, '451');
  assert.equal(result.rechargeStatus, 'success');
  assert.deepEqual(calls, [['card', '451']]);
});

test('provider PoC never submits recharge when an asynchronously recovered card fails', async () => {
  let listCalls = 0;
  let submitted = false;
  await assert.rejects(
    runProviderPoc({
      hnskj: {
        cardTypes: async () => ({
          data: {
            purchaseEnabled: true,
            cardTypes: [{ id: 1, cardType: 'Z-43612081', minAmount: '5', maxAmount: '200' }]
          }
        }),
        accountBalance: async () => ({ data: { balance: '100.00' } }),
        cards: async () => {
          listCalls += 1;
          return {
            data: {
              total: listCalls === 1 ? 0 : 1,
              cards: listCalls === 1 ? [] : [{ id: 451, cardType: 'Z-43612081', status: 'failed' }]
            }
          };
        },
        purchaseCard: async () => ({ data: { accepted: true } }),
        card: async () => ({ data: { id: 451, status: 'failed', cardBalance: '0.00', currency: 'USD' } })
      },
      zzshu: { createDirectOrder: async () => { submitted = true; } },
      session: sessionFixture(),
      cardTypeId: 1,
      amount: 16,
      minimumCardBalance: 15.5,
      checkpoint: async () => {},
      wait: async () => {},
      pollDelayMs: 0,
      recoveryPolls: 1
    }),
    /明确开卡失败/
  );
  assert.equal(submitted, false);
});

test('existing-card PoC verifies one card and submits exactly one recharge without purchasing', async () => {
  const calls = [];
  const checkpoints = [];
  const hnskj = {
    accountBalance: async () => ({ data: { balance: '102.42' } }),
    card: async (cardId) => {
      calls.push(['card', cardId]);
      return {
        data: {
          id: 444,
          status: 'active',
          cardBalance: '17.00',
          cardNumber: '4242424242429767',
          expMonth: 12,
          expYear: 2032,
          cvv: '123',
          currency: 'USD'
        }
      };
    },
    purchaseCard: async () => { throw new Error('must not purchase'); }
  };
  const zzshu = {
    createDirectOrder: async (input) => {
      calls.push(['recharge', input]);
      return { orderNo: 'order-existing-1', cardKey: 'DIRECT-existing-1' };
    },
    queryStatus: async (cardKey) => {
      calls.push(['status', cardKey]);
      return { status: 'success', isSubscriptionCancelled: 1 };
    }
  };

  const result = await runExistingCardPoc({
    hnskj,
    zzshu,
    session: sessionFixture(),
    providerCardId: 444,
    minimumCardBalance: 16,
    checkpoint: async (state) => checkpoints.push(state),
    wait: async () => {},
    pollDelayMs: 0,
    cancellationDelayMs: 0,
    maxPolls: 1,
    allowRechargeSubmission: true
  });

  assert.equal(calls.filter(([name]) => name === 'card').length, 1);
  assert.equal(calls.filter(([name]) => name === 'recharge').length, 1);
  assert.equal(result.mode, 'existing-card');
  assert.equal(result.rechargeStatus, 'success');
  assert.equal(result.cardLast4, '9767');
  assert.equal(checkpoints.some((state) => state.phase === 'EXISTING_CARD_VERIFIED'), true);
  assert.equal(JSON.stringify({ result, checkpoints }).includes('4242424242429767'), false);
  assert.equal(JSON.stringify({ result, checkpoints }).includes('123'), false);
});

test('existing-card PoC stops before recharge when the card is not ready or underfunded', async () => {
  let submitted = false;
  await assert.rejects(
    runExistingCardPoc({
      hnskj: {
        accountBalance: async () => ({ data: { balance: '102.42' } }),
        card: async () => ({
          data: {
            id: 444,
            status: 'active',
            cardBalance: '15.00',
            cardNumber: '4242424242429767',
            expMonth: 12,
            expYear: 2032,
            cvv: '123',
            currency: 'USD'
          }
        })
      },
      zzshu: { createDirectOrder: async () => { submitted = true; } },
      session: sessionFixture(),
      providerCardId: 444,
      minimumCardBalance: 16
    }),
    /尚不可用于直充/
  );
  assert.equal(submitted, false);
});
