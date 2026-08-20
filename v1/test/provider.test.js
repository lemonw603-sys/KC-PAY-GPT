import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HnskjCardProvider,
  mapCardCredentials,
  mapCardProvisioning,
  mapPurchasedCard
} from '../src/providers/hnskj-card.js';
import { assertProviderWritesDisabled, runReadOnlyChecks } from '../scripts/provider-read-check.js';
import { ProviderError, ProviderSchemaError } from '../src/providers/http-client.js';
import { ZzshuRechargeProvider } from '../src/providers/zzshu-recharge.js';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'hnskj-read-responses.json'
);
const hnskjReadFixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function response(body, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(body)
  };
}

function fetchQueue(responses, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}

test('Hnskj purchase sends server-side auth and the stable idempotency key', async () => {
  const calls = [];
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1/',
    apiKey: 'nhs_test_key',
    fetchImpl: fetchQueue([
      response({ success: true, message: '成功', data: { card: { id: 'card-1' } } })
    ], calls)
  });

  const result = await provider.purchaseCard({
    cardTypeId: 7,
    openCardAmount: 25,
    idempotencyKey: 'order-123456789012345',
    remark: 'ORD-100'
  });

  assert.deepEqual(result.data, { card: { id: 'card-1' } });
  assert.equal(calls[0].url, 'https://card.example/api/open/v1/cards/purchase');
  assert.equal(calls[0].init.headers['X-API-Key'], 'nhs_test_key');
  assert.equal(calls[0].init.headers['X-Idempotency-Key'], 'order-123456789012345');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    cardTypeId: 7,
    quantity: 1,
    openCardAmount: 25,
    remark: 'ORD-100'
  });
});

test('Hnskj marks 503 as same-key retryable but never invents a new key', async () => {
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1',
    apiKey: 'nhs_test_key',
    fetchImpl: async () => response({ success: false, message: '通道异常' }, 503)
  });

  await assert.rejects(
    provider.purchaseCard({
      cardTypeId: 7,
      openCardAmount: 25,
      idempotencyKey: 'order-123456789012345'
    }),
    (error) => error instanceof ProviderError
      && error.retryable === true
      && error.uncertain === true
  );
});

test('Hnskj rejects an invalid idempotency key before network access', async () => {
  let called = false;
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1',
    apiKey: 'nhs_test_key',
    fetchImpl: async () => { called = true; return response({ success: true, data: {} }); }
  });

  await assert.rejects(
    provider.purchaseCard({ cardTypeId: 7, openCardAmount: 25, idempotencyKey: 'short' }),
    /16-128/
  );
  assert.equal(called, false);
});

test('Hnskj purchase mapper accepts known card ID variants and marks a missing ID uncertain', () => {
  assert.equal(mapPurchasedCard({ data: { card: { id: 451 } } }), '451');
  assert.equal(mapPurchasedCard({ data: { card_id: 'card-1' } }), 'card-1');
  assert.throws(
    () => mapPurchasedCard({ data: { accepted: true } }),
    (error) => error instanceof ProviderSchemaError
      && error.provider === 'hnskj'
      && error.uncertain === true
      && error.retryable === false
  );
});

test('Hnskj read schemas match the one-time live response shapes', async () => {
  const calls = [];
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1',
    apiKey: 'nhs_test_key',
    fetchImpl: fetchQueue([
      response(hnskjReadFixtures.profile),
      response(hnskjReadFixtures.balance),
      response(hnskjReadFixtures.cardTypes),
      response(hnskjReadFixtures.cards),
      response(hnskjReadFixtures.transactions)
    ], calls)
  });

  const profile = await provider.accountProfile();
  const balance = await provider.accountBalance();
  const cardTypes = await provider.cardTypes();
  const cards = await provider.cards({ page: 1, pageSize: 20 });
  const transactions = await provider.transactions('fixture-card-id');

  assert.equal(profile.data.balance, '0.000000');
  assert.equal(balance.data.exchangeRate, '1.000000');
  assert.equal(cardTypes.data.cardTypes.length, 1);
  assert.equal(cards.data.cards.length, 0);
  assert.equal(transactions.data.transactions[0].type, 'card_balance_return');
  assert.equal(transactions.data.transactions[1].originalCurrency, 'PHP');
  assert.equal(calls.length, 5);
});

test('Hnskj transaction schema rejects missing stable transaction identity', async () => {
  const invalid = structuredClone(hnskjReadFixtures.transactions);
  delete invalid.data.transactions[0].id;
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1',
    apiKey: 'nhs_test_key',
    fetchImpl: async () => response(invalid)
  });

  await assert.rejects(
    provider.transactions('fixture-card-id'),
    (error) => error instanceof ProviderSchemaError && error.uncertain === false
  );
});

test('Hnskj accepts the observed complete transaction response without page metadata', async () => {
  const observed = structuredClone(hnskjReadFixtures.transactions);
  delete observed.data.page;
  delete observed.data.pageSize;
  delete observed.data.cardNo;
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1',
    apiKey: 'nhs_test_key',
    fetchImpl: async () => response(observed)
  });
  const result = await provider.transactions('fixture-card-id');
  assert.equal(result.data.total, result.data.transactions.length);
  assert.equal(result.data.page, undefined);
});

test('Hnskj rejects amount type drift instead of accepting JavaScript numbers', async () => {
  const invalidBalance = structuredClone(hnskjReadFixtures.balance);
  invalidBalance.data.balance = 0;
  const provider = new HnskjCardProvider({
    baseUrl: 'https://card.example/api/open/v1',
    apiKey: 'nhs_test_key',
    fetchImpl: async () => response(invalidBalance)
  });

  await assert.rejects(
    provider.accountBalance(),
    (error) => error instanceof ProviderSchemaError && error.uncertain === false
  );
});

test('Hnskj card readiness requires terminal status, funded balance and credentials', () => {
  const ready = mapCardProvisioning({ data: {
    status: 'active', cardBalance: '25.000000', cardNumber: '4242424242424242',
    cvv: '123', expiryMonth: 12, expiryYear: 2032
  } }, 25);
  assert.deepEqual(ready, {
    state: 'ready', status: 'active', currentBalance: 25, currency: 'USD', last4: '4242'
  });

  const pending = mapCardProvisioning({ data: {
    status: 'active', cardBalance: '0.000000', cardNumber: '', cvv: ''
  } }, 25);
  assert.equal(pending.state, 'pending');

  const failed = mapCardProvisioning({ data: { status: 'failed', cardBalance: '0.000000' } }, 25);
  assert.equal(failed.state, 'failed');
});

test('Hnskj card readiness uses the independent minimum balance instead of funded amount', () => {
  const envelope = {
    data: {
      status: 'active',
      cardBalance: '15.75',
      cardNumber: '4242424242424242',
      cvv: '123',
      expiryMonth: 12,
      expiryYear: 2032
    }
  };
  assert.equal(mapCardProvisioning(envelope, 15.5).state, 'ready');
  assert.equal(mapCardProvisioning(envelope, 16).state, 'pending');
});

test('Hnskj card credentials mapper accepts known read response fields and rejects drift', () => {
  assert.deepEqual(mapCardCredentials({
    data: { number: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123' }
  }), {
    cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
  });
  assert.throws(
    () => mapCardCredentials({ data: { number: 'not-a-card' } }),
    /Invalid Hnskj card credentials data/
  );
});

test('read-only deployment check calls only provider read operations', async () => {
  const calls = [];
  const result = await runReadOnlyChecks({
    hnskj: {
      accountProfile: async () => { calls.push('profile'); return { data: { id: 7 } }; },
      accountBalance: async () => { calls.push('balance'); return { data: { currency: 'USD' } }; },
      cardTypes: async () => { calls.push('card-types'); return { data: { cardTypes: [] } }; },
      cards: async () => { calls.push('cards'); return { data: { total: 0 } }; }
    },
    zzshu: { checkConnection: async () => { calls.push('zzshu-connection'); } }
  });
  assert.deepEqual(calls, ['profile', 'balance', 'card-types', 'cards', 'zzshu-connection']);
  assert.equal(result.hnskj.accountId, 7);
});

test('read-only deployment check refuses every split write switch', () => {
  assert.doesNotThrow(() => assertProviderWritesDisabled({
    PROVIDER_WRITES_ENABLED: 'false',
    PROVIDER_CARD_WRITES_ENABLED: 'false',
    PROVIDER_RECHARGE_WRITES_ENABLED: 'false'
  }));
  for (const key of [
    'PROVIDER_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED',
    'PROVIDER_RECHARGE_WRITES_ENABLED'
  ]) {
    assert.throws(() => assertProviderWritesDisabled({ [key]: 'true' }), new RegExp(key));
  }
});

test('Zzshu direct creation uses X-API-Key and strips secrets from the result', async () => {
  const calls = [];
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1/',
    apiKey: 'stable-recharge-key',
    fetchImpl: fetchQueue([
      response({
        code: 0,
        message: 'success',
        data: {
          order_no: '12',
          card_key: 'DIRECT-abc',
          status: 'processing',
          plan_type: 'plus',
          token: { accessToken: 'should-not-escape' },
          bank_card_no: '4242424242424242'
        }
      })
    ], calls)
  });

  const result = await provider.createDirectOrder({
    cardNumber: '4242424242424242',
    expMonth: 12,
    expYear: 2032,
    cvv: '123',
    token: { user: { id: 'u1' }, accessToken: 'secret' },
    planType: 'plus'
  });

  assert.deepEqual(result, {
    orderNo: '12',
    cardKey: 'DIRECT-abc',
    status: 'processing',
    planType: 'plus'
  });
  assert.equal(calls[0].url, 'https://card.example/api/v1/third-party/orders/direct');
  assert.equal(calls[0].init.headers['X-API-Key'], 'stable-recharge-key');
  assert.deepEqual(JSON.parse(calls[0].init.body).token, {
    user: { id: 'u1' },
    accessToken: 'secret'
  });
});

test('Zzshu status query never returns full token or PAN', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({
      code: 0,
      message: 'success',
      data: {
        order_no: '12',
        card_key: 'DIRECT-abc',
        plan_type: 'plus',
        status: 'success',
        token: { accessToken: 'secret' },
        bank_card_no: '4242424242424242',
        payment_result: { success: true, status: 'paid', proxy: 'secret' },
        payment_amount: '1150.00',
        payment_currency: 'php',
        is_subscription_cancelled: 0
      }
    })
  });

  const status = await provider.queryStatus('DIRECT-abc');
  assert.deepEqual(status, {
    orderNo: '12',
    cardKey: 'DIRECT-abc',
    planType: 'plus',
    status: 'success',
    failureReason: null,
    paymentResult: { success: true, status: 'paid' },
    paymentAmount: '1150.00',
    paymentCurrency: 'PHP',
    paymentDetailsStatus: 'valid',
    isSubscriptionCancelled: 0,
    finishedAt: null,
    updatedAt: null
  });
  assert.equal('token' in status, false);
  assert.equal('bankCardNo' in status, false);
});

test('Zzshu keeps a confirmed status while refusing malformed settlement fields', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({
      code: 0,
      message: 'success',
      data: { status: 'success', payment_amount: '1,150.00', payment_currency: 'PHP' }
    })
  });
  const status = await provider.queryStatus('DIRECT-abc');
  assert.equal(status.status, 'success');
  assert.equal(status.paymentAmount, null);
  assert.equal(status.paymentCurrency, null);
  assert.equal(status.paymentDetailsStatus, 'invalid');
});

test('Zzshu trusted workflow status returns the latest Session but still drops PAN', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({
      code: 0,
      message: 'success',
      data: {
        order_no: '12', card_key: 'DIRECT-abc', status: 'success',
        token: {
          accessToken: 'latest', sessionToken: 'latest-session', expires: '2032-01-01T00:00:00Z',
          user: { id: 'user-1' }, account: { id: 'account-1' }
        },
        bank_card_no: '4242424242424242', is_subscription_cancelled: 1
      }
    })
  });
  const status = await provider.queryStatusWithSession('DIRECT-abc');
  assert.equal(status.latestSession.accessToken, 'latest');
  assert.equal(status.isSubscriptionCancelled, 1);
  assert.equal('bankCardNo' in status, false);
});

test('Zzshu distinguishes safe capacity retry from ambiguous server failure', async () => {
  const capacity = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({ code: 42902, message: '当前并发过高，请稍后重试', data: null }, 429)
  });
  await assert.rejects(
    capacity.createDirectOrder({ cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123', token: {}, planType: 'plus' }),
    (error) => error.retryable === true && error.uncertain === false
  );

  const ambiguous = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({ code: 50001, message: '充值失败，请稍后重试', data: null }, 500)
  });
  await assert.rejects(
    ambiguous.createDirectOrder({ cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123', token: {}, planType: 'plus' }),
    (error) => error.retryable === false && error.uncertain === true
  );
});

test('Zzshu rejects unknown final statuses instead of guessing success', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({
      code: 0,
      message: 'success',
      data: { card_key: 'DIRECT-abc', status: 'maybe_success' }
    })
  });

  await assert.rejects(
    provider.queryStatus('DIRECT-abc'),
    (error) => error instanceof ProviderSchemaError && error.uncertain === false
  );
});

test('Provider timeout is uncertain and not automatically retryable', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {})
  });

  await assert.rejects(
    provider.createDirectOrder({
      cardNumber: '4242424242424242',
      expMonth: 12,
      expYear: 2032,
      cvv: '123',
      token: {},
      planType: 'plus'
    }),
    (error) => error instanceof ProviderError
      && error.kind === 'timeout'
      && error.uncertain === true
      && error.retryable === false
  );
});

test('Status-query timeout is safe to retry', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {})
  });

  await assert.rejects(
    provider.queryStatus('DIRECT-abc'),
    (error) => error instanceof ProviderError
      && error.kind === 'timeout'
      && error.uncertain === false
      && error.retryable === true
  );
});

test('Connection-check 5xx is retryable because it cannot create an order', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({ code: 50001, message: 'temporary', data: null }, 500)
  });

  await assert.rejects(
    provider.checkConnection(),
    (error) => error instanceof ProviderError
      && error.retryable === true
      && error.uncertain === false
  );
});

test('Malformed create success remains ambiguous because an order may exist', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({ unexpected: true }, 201)
  });

  await assert.rejects(
    provider.createDirectOrder({
      cardNumber: '4242424242424242',
      expMonth: 12,
      expYear: 2032,
      cvv: '123',
      token: {},
      planType: 'plus'
    }),
    (error) => error instanceof ProviderSchemaError && error.uncertain === true
  );
});

test('Native 422 validation response is a definite pre-create rejection', async () => {
  const provider = new ZzshuRechargeProvider({
    baseUrl: 'https://card.example/api/v1',
    apiKey: 'stable-recharge-key',
    fetchImpl: async () => response({ detail: [{ loc: ['body'], msg: 'invalid' }] }, 422)
  });

  await assert.rejects(
    provider.createDirectOrder({
      cardNumber: 'bad',
      expMonth: 12,
      expYear: 2032,
      cvv: '123',
      token: {},
      planType: 'plus'
    }),
    (error) => error instanceof ProviderSchemaError
      && error.uncertain === false
      && error.retryable === false
  );
});
