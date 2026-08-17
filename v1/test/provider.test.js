import assert from 'node:assert/strict';
import test from 'node:test';
import { HnskjCardProvider } from '../src/providers/hnskj-card.js';
import { ProviderError, ProviderSchemaError } from '../src/providers/http-client.js';
import { ZzshuRechargeProvider } from '../src/providers/zzshu-recharge.js';

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
    isSubscriptionCancelled: 0,
    finishedAt: null,
    updatedAt: null
  });
  assert.equal('token' in status, false);
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
