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

test('provider.ranges: maps the live segment list to {vid, name}', async () => {
  const { fetch: fetchImpl } = fakeFetch({
    '/api/card/rangeList': () => ({ status: 200, body: { code: 200, data: [
      { vid: 708, name: '513989', newCardMinTopupAmount: { amount: 200 } },
      { vid: 713, name: '543156', newCardMinTopupAmount: { amount: 200 } },
    ] } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl });
  const rows = await provider.ranges();
  assert.deepEqual(rows.map((r) => [r.vid, r.name]), [['708', '513989'], ['713', '543156']]);
});

test('provider.wallet: exposes the raw cents fields without asserting what "deposit" means', async () => {
  const { fetch: fetchImpl } = fakeFetch({
    '/api/user/wallet': () => ({ status: 200, body: { code: 200, data: { usdBalance: 2088, usdDeposit: 64480, usdConsume: 0 } } }),
  });
  const provider = createHighvccCardProvider({ getAccessToken: async () => 'tok', fetchImpl });
  const w = await provider.wallet();
  assert.deepEqual(w, { usdBalanceCents: 2088, usdDepositCents: 64480, usdConsumeCents: 0 });
});

// 2026-09-12 对真实响应核实的合同：交易列表的时间戳按 UTC+8 墙上时间编码，不是 UTC epoch。
// 用 9-11 那笔已知扣款坐实：付款提交 03:14:09Z，原始 tradeTime 直读是 11:14:30Z（差整 480 分钟），
// 按 UTC+8 还原得 03:14:30Z——比提交晚 21 秒，正是刷卡耗时。
// 这一条最容易在后续重构里被「简化」掉，而一旦直接当 UTC 解析，对账会把「扣了钱」判成
// 「没扣钱」，进而退卡密让客户重兑、造成重复扣款。所以在这里钉死。
test('transactions(): 时间戳按 UTC+8 归一，页长不足 6 会被抬到 6', async () => {
  const seen = [];
  const provider = createHighvccCardProvider({
    getAccessToken: async () => 'fixture-token',
    fetchImpl: async (url) => {
      seen.push(String(url));
      return {
        ok: true, status: 200,
        json: async () => ({
          code: 200,
          data: {
            haveNext: false, total: 1,
            data: [{
              cardAuthId: 'a1', amount: 1579, lastFour: '3118', status: 'COMPLETE',
              // 卡台按 UTC+8 编码：这个值直读是 2026-09-11T11:14:30Z
              tradeTime: Date.UTC(2026, 8, 11, 11, 14, 30),
              approveTime: Date.UTC(2026, 8, 12, 14, 59, 25),
            }],
          },
        }),
      };
    },
  });

  const { rows, total, hasNext } = await provider.transactions({ pageNo: 1, pageSize: 3 });
  assert.match(seen[0], /pageNo=1/);
  assert.match(seen[0], /pageSize=6/, '页长小于 6 会被卡台拒绝，必须抬到 6');
  assert.equal(total, 1);
  assert.equal(hasNext, false);
  assert.equal(new Date(rows[0].tradeTimeEpochMs).toISOString(), '2026-09-11T03:14:30.000Z',
    'tradeTime 必须按 UTC+8 还原，直接当 UTC 会整整差 8 小时');
  assert.equal(new Date(rows[0].approveTimeEpochMs).toISOString(), '2026-09-12T06:59:25.000Z');
  assert.equal(rows[0].amount, 1579, '金额是分，原样保留');
});

test('transactions(): 缺失或非法的时间戳归一成 null，不得退化成 0（0 会落进任何时间窗口）', async () => {
  const provider = createHighvccCardProvider({
    getAccessToken: async () => 'fixture-token',
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ code: 200, data: { data: [{ cardAuthId: 'a2', amount: 100, tradeTime: null, approveTime: 0 }] } }),
    }),
  });
  const { rows } = await provider.transactions({});
  assert.equal(rows[0].tradeTimeEpochMs, null);
  assert.equal(rows[0].approveTimeEpochMs, null);
});
