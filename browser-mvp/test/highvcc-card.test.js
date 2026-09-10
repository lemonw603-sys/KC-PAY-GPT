import assert from 'node:assert/strict';
import test from 'node:test';

import { cents, buildRequestInit, isAuthTrouble } from '../scripts/highvcc-card.mjs';

// Regression coverage for two real failures hit live against highvcc.com on 2026-09-10:
// (1) the script sent JSON bodies while the live API only accepts form-urlencoded, which
//     surfaced as an unrelated "支付钱包不能为空" error instead of anything about encoding;
// (2) a missing/garbled --amount silently became NaN cents instead of failing before any
//     network call. Both are pinned here so a future edit can't quietly reintroduce them.

test('cents() accepts a positive dollar amount and rounds to integer cents', () => {
  assert.equal(cents(50), '5000');
  assert.equal(cents('2'), '200');
  assert.equal(cents(19.995), '2000'); // rounds, matches Math.round semantics
});

test('cents() fails fast on anything that is not a positive number', () => {
  for (const bad of [0, -5, NaN, undefined, null, 'abc', '']) {
    assert.throws(() => cents(bad), /positive number/);
  }
});

test('buildRequestInit: no body means no request body and no content-type', () => {
  assert.deepEqual(buildRequestInit(null, false), { requestBody: undefined, contentType: undefined });
  assert.deepEqual(buildRequestInit(null, true), { requestBody: undefined, contentType: undefined });
});

test('buildRequestInit: form mode encodes as application/x-www-form-urlencoded (the live API contract)', () => {
  const { requestBody, contentType } = buildRequestInit({ vid: '708', amount: '5000', payUnit: 'USD' }, true);
  assert.equal(contentType, 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(requestBody, 'vid=708&amount=5000&payUnit=USD');
  assert.deepEqual(Array.from(new URLSearchParams(requestBody).keys()), ['vid', 'amount', 'payUnit']);
});

test('buildRequestInit: form mode drops null/empty fields instead of sending literal "null"', () => {
  const { requestBody } = buildRequestInit({ vid: '708', couponId: null, tags: '', gid: undefined }, true);
  assert.equal(requestBody, 'vid=708');
});

test('buildRequestInit: non-form mode still encodes as JSON (used by GET-style/no-body calls elsewhere)', () => {
  const { requestBody, contentType } = buildRequestInit({ cardId: 'HG123' }, false);
  assert.equal(contentType, 'application/json');
  assert.equal(requestBody, JSON.stringify({ cardId: 'HG123' }));
});

test('isAuthTrouble: recognizes HTTP 401/403 regardless of body', () => {
  assert.equal(isAuthTrouble(401, null), true);
  assert.equal(isAuthTrouble(403, {}), true);
});

test('isAuthTrouble: recognizes an HTTP-200-wrapped relogin signal', () => {
  assert.equal(isAuthTrouble(200, { code: 401 }), true);
  assert.equal(isAuthTrouble(200, { code: 200, msg: '登录已过期，请重新登录' }), true);
  assert.equal(isAuthTrouble(200, { code: 200, msg: 'token invalid' }), true);
});

test('isAuthTrouble: a genuine server/business error is not misreported as a token problem', () => {
  assert.equal(isAuthTrouble(200, { code: 200 }), false);
  assert.equal(isAuthTrouble(500, { msg: '支付钱包不能为空' }), false);
  assert.equal(isAuthTrouble(500, null), false);
});
