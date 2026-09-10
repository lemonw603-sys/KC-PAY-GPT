import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cents, buildRequestInit, isAuthTrouble, createHighvccCardProvider, HighvccProviderError,
} from '../src/providers/highvcc-card.js';

// Same pure-function contract as browser-mvp/scripts/highvcc-card.mjs, re-verified here
// because this is an independent copy (no runtime import between the two packages).
test('cents() accepts a positive dollar amount and rejects everything else', () => {
  assert.equal(cents(50), '5000');
  for (const bad of [0, -5, NaN, undefined, 'abc']) assert.throws(() => cents(bad), /positive number/);
});

test('buildRequestInit: form mode is application/x-www-form-urlencoded and drops null/empty fields', () => {
  const { requestBody, contentType } = buildRequestInit({ vid: '708', amount: '5000', payUnit: 'USD', couponId: null }, true);
  assert.equal(contentType, 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(requestBody, 'vid=708&amount=5000&payUnit=USD');
});

test('isAuthTrouble: HTTP 401/403 or an HTTP-200-wrapped relogin code, not a generic error', () => {
  assert.equal(isAuthTrouble(401, null), true);
  assert.equal(isAuthTrouble(200, { code: 401 }), true);
  assert.equal(isAuthTrouble(200, { code: 200, msg: '登录已过期' }), true);
  assert.equal(isAuthTrouble(500, { msg: '支付钱包不能为空' }), false);
});

function fakeFetch(handlers) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      const handler = handlers[path];
      if (!handler) throw new Error(`unexpected fetch to ${path}`);
      const result = handler(init, calls.length);
      return { ok: result.status < 400, status: result.status, json: async () => result.body };
    },
  };
}

test('provider.cost: posts form-encoded and returns feeInfo data', async () => {
  const { fetch: fetchImpl, calls } = fakeFetch({
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 200, data: { feeDetail: 'x', popMsg: 'notice' } } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl });
  const result = await provider.cost({ vid: '708', amount: 50 });
  assert.equal(result.feeDetail, 'x');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('provider.cost: a missing token throws before any network call', async () => {
  const provider = createHighvccCardProvider({ getAccessToken: async () => null, fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(provider.cost({ vid: '708', amount: 50 }), (e) => e instanceof HighvccProviderError && e.code === 'HIGHVCC_TOKEN_MISSING');
});

test('provider.cost: an expired-token response is classified, not a generic HTTP error', async () => {
  const { fetch: fetchImpl } = fakeFetch({
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 401, msg: '登录已过期' } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'stale', fetchImpl });
  await assert.rejects(provider.cost({ vid: '708', amount: 50 }), (e) => e instanceof HighvccProviderError && e.code === 'HIGHVCC_TOKEN_EXPIRED');
});

// Real failure hit in production 2026-09-10: newCard was cleanly rejected ("美元账户可用
// 余额不足" — insufficient USD wallet balance), a normal business rejection, not a bug — but
// the admin UI had no way to show the operator *why* without this.
test('provider.cost: a clean platform rejection carries the business reason separately from the technical message', async () => {
  const { fetch: fetchImpl } = fakeFetch({
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 500, msg: '美元账户可用余额不足' } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl });
  await assert.rejects(provider.cost({ vid: '708', amount: 50 }), (e) => {
    assert.ok(e instanceof HighvccProviderError);
    assert.equal(e.code, 'HIGHVCC_API_ERROR');
    assert.equal(e.providerMessage, '美元账户可用余额不足');
    return true;
  });
});

test('provider.open: quotes cost, opens with the given address, fetches detail, and never re-decides intent', async () => {
  const { fetch: fetchImpl, calls } = fakeFetch({
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 200, data: { feeDetail: '$50.50' } } }),
    '/api/card/newCard': () => ({ status: 200, body: { code: 200, data: 'HGabc123' } }),
    '/api/card/detail': () => ({ status: 200, body: { code: 200, data: {
      card: { cardId: 'HGabc123', number: '4111111111111111', cvc: '123', expMonth: 9, expYear: 2028, firstName: 'Jamie', lastName: 'Winder', balance: 5000 },
      adress: { street: '1 Main St', city: 'Portland', state: 'OR', zipCode: '97202' },
    } } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl });
  const result = await provider.open({
    vid: '708', amount: 50, firstName: 'Jamie', lastName: 'Winder',
    address: { line1: '1 Main St', city: 'Portland', state: 'OR', postalCode: '97202' },
  });
  assert.equal(result.cardId, 'HGabc123');
  assert.equal(result.detail.card.balance, 5000);
  const newCardCall = calls.find((c) => c.path === '/api/card/newCard');
  const sent = new URLSearchParams(newCardCall.init.body);
  assert.equal(sent.get('firstName'), 'Jamie');
  assert.equal(sent.get('street'), '1 Main St');
  assert.equal(sent.get('rechargeAmount'), '5000');
});

test('provider.open: refuses without a complete address instead of sending a partial one', async () => {
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(
    provider.open({ vid: '708', amount: 50, firstName: 'A', lastName: 'B', address: { line1: '', city: 'x', state: 'OR', postalCode: '1' } }),
    (e) => e instanceof HighvccProviderError && e.code === 'HIGHVCC_ADDRESS_INCOMPLETE'
  );
});

// Real failure hit in production 2026-09-10: newCard succeeded (money spent, card genuinely
// created), but the immediate detail() call came back with no card.number yet — the platform
// was still provisioning it. The caller had no PAN to store despite the card being real.
test('provider.open: retries detail() when the just-created card is still provisioning', async () => {
  let detailCalls = 0;
  const sleeps = [];
  const { fetch: fetchImpl } = fakeFetch({
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 200, data: { feeDetail: '$5.50' } } }),
    '/api/card/newCard': () => ({ status: 200, body: { code: 200, data: 'HGnew' } }),
    '/api/card/detail': () => {
      detailCalls += 1;
      if (detailCalls < 3) return { status: 200, body: { code: 200, data: { card: {}, adress: {} } } }; // still provisioning
      return { status: 200, body: { code: 200, data: {
        card: { cardId: 'HGnew', number: '4111111111111111', cvc: '123', expMonth: 2, expYear: 2029, firstName: 'A', lastName: 'B', balance: 300 },
        adress: { street: '1 St', city: 'X', state: 'OR', zipCode: '00000' },
      } } };
    },
  });
  const provider = createHighvccCardProvider({
    getAccessToken: async () => 'tok', fetchImpl, sleep: async (ms) => { sleeps.push(ms); },
  });
  const result = await provider.open({
    vid: '708', amount: 5, firstName: 'A', lastName: 'B',
    address: { line1: '1 St', city: 'X', state: 'OR', postalCode: '00000' },
  });
  assert.equal(detailCalls, 3);
  assert.deepEqual(sleeps, [1500, 1500]);
  assert.equal(result.detail.card.number, '4111111111111111');
});

test('provider.open: gives up after retrying and returns the incomplete detail rather than hanging forever', async () => {
  const { fetch: fetchImpl } = fakeFetch({
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 200, data: { feeDetail: '$5.50' } } }),
    '/api/card/newCard': () => ({ status: 200, body: { code: 200, data: 'HGstuck' } }),
    '/api/card/detail': () => ({ status: 200, body: { code: 200, data: { card: {}, adress: {} } } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl, sleep: async () => {} });
  const result = await provider.open({
    vid: '708', amount: 5, firstName: 'A', lastName: 'B',
    address: { line1: '1 St', city: 'X', state: 'OR', postalCode: '00000' },
  });
  assert.equal(result.cardId, 'HGstuck');
  assert.equal(result.detail.card.number, undefined); // caller must handle this, not hang or crash
});
