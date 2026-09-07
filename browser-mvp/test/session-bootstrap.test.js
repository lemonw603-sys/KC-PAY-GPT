import test from 'node:test';
import assert from 'node:assert/strict';

import { ContractError } from '../src/contracts.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';

test('CookieSessionBootstrapAdapter preserves an existing active Profile session', async () => {
  const source = {
    async load(ref) {
      assert.equal(ref, 'session-ref:fixture');
      return { cookieHeader: '__Secure-next-auth.session-token=token-value; other=ignored' };
    },
  };
  const adapter = new CookieSessionBootstrapAdapter({ source, clock: () => 10_000 });
  const lease = await adapter.open('session-ref:fixture', { ttlMs: 5_000 });
  assert.equal(typeof lease.sessionDigest, 'string');
  assert.equal('cookies' in lease, false);
  const added = [];
  const cleared = [];
  const result = await adapter.bootstrap(lease, {
    cookies: async () => [
      { name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', path: '/' },
      { name: '__Secure-next-auth.session-token.1', domain: '.chatgpt.com', path: '/' },
      { name: '__cf_bm', domain: '.chatgpt.com', path: '/' },
    ],
    clearCookies: async (filter) => cleared.push(filter),
    addCookies: async (cookies) => added.push(...cookies),
  });
  assert.equal(result.cookieCount, 2);
  assert.equal(result.replacedCookieCount, 0);
  assert.equal(result.existingSessionPreserved, true);
  assert.deepEqual(cleared, []);
  assert.deepEqual(added, []);
  await adapter.close(lease);
  await assert.rejects(() => adapter.bootstrap(lease, {
    cookies: async () => [], clearCookies: async () => undefined, addCookies: async () => undefined,
  }), ContractError);
});

test('CookieSessionBootstrapAdapter rejects sources without a ChatGPT session token', async () => {
  const adapter = new CookieSessionBootstrapAdapter({ source: { load: async () => ({ cookieHeader: 'foo=bar' }) } });
  await assert.rejects(() => adapter.open('session-ref:missing'), ContractError);
});

test('CookieSessionBootstrapAdapter chunks long session tokens using NextAuth cookie names', async () => {
  const adapter = new CookieSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'x'.repeat(4_100) }) } });
  const lease = await adapter.open('session-ref:chunked');
  const added = [];
  await adapter.bootstrap(lease, {
    cookies: async () => [],
    clearCookies: async () => undefined,
    addCookies: async (cookies) => added.push(...cookies),
  });
  assert.deepEqual(added.map((cookie) => cookie.name), [
    '__Secure-next-auth.session-token.0',
    '__Secure-next-auth.session-token.1',
  ]);
  assert.equal(added[0].value.length, 3_936);
  assert.equal(added[1].value.length, 164);
});

test('CookieSessionBootstrapAdapter replaces a foreign resident session only when asked, and clearSession drops only session cookies', async () => {
  const source = { async load() { return { sessionToken: 'new-token' }; } };
  const adapter = new CookieSessionBootstrapAdapter({ source, clock: () => 10_000 });
  const lease = await adapter.open('session-ref:replace', { ttlMs: 5_000 });
  const added = [];
  const cleared = [];
  const context = {
    cookies: async () => [
      { name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', path: '/' },
      { name: '__Secure-next-auth.session-token.1', domain: '.chatgpt.com', path: '/' },
      { name: 'oai-client-auth-info', domain: 'chatgpt.com', path: '/' },
      { name: 'oai-client-session-epoch', domain: '.chatgpt.com', path: '/' },
      { name: '__Secure-next-auth.callback-url', domain: 'chatgpt.com', path: '/' },
      { name: '__cf_bm', domain: '.chatgpt.com', path: '/' },
      { name: 'cf_clearance', domain: '.chatgpt.com', path: '/' },
      { name: 'oai-did', domain: '.chatgpt.com', path: '/' },
      { name: '__stripe_mid', domain: '.chatgpt.com', path: '/' },
    ],
    clearCookies: async (filter) => cleared.push(filter),
    addCookies: async (cookies) => added.push(...cookies),
  };
  const result = await adapter.bootstrap(lease, context, { replaceExisting: true });
  assert.equal(result.existingSessionPreserved, false);
  assert.equal(result.replacedCookieCount, 2);
  assert.equal(result.clearedLoginCookieCount, 3);
  assert.equal(result.cookieCount, 1);
  const clearedNames = (filter) => (filter.name instanceof RegExp ? [filter.name] : [filter.name]);
  assert.ok(cleared.every((filter) => filter.name !== undefined), 'clearing is always filtered by cookie name, never a blanket clear');
  assert.ok(cleared[0].name instanceof RegExp && cleared[0].name.test('__Secure-next-auth.session-token.1'));
  const explicitlyCleared = cleared.slice(1).map((filter) => filter.name);
  assert.deepEqual(explicitlyCleared.sort(), ['__Secure-next-auth.callback-url', 'oai-client-auth-info', 'oai-client-session-epoch']);
  for (const kept of ['__cf_bm', 'cf_clearance', 'oai-did', '__stripe_mid']) {
    assert.ok(!explicitlyCleared.includes(kept) && !cleared[0].name.test(kept), `${kept} is a device/network cookie and must survive an account switch`);
  }
  void clearedNames;
  assert.deepEqual(added.map((cookie) => cookie.name), ['__Secure-next-auth.session-token']);
  assert.equal(added[0].value, 'new-token');
  await adapter.close(lease);

  cleared.length = 0;
  const releaseResult = await adapter.clearSession(context);
  assert.equal(releaseResult.clearedCookieCount, 2);
  assert.equal(releaseResult.clearedLoginCookieCount, 3);
  assert.equal(cleared.length, 4);
  cleared.length = 0;
  const untouched = await adapter.clearSession({ ...context, cookies: async () => [{ name: '__cf_bm' }, { name: 'oai-did' }] });
  assert.equal(untouched.clearedCookieCount, 0);
  assert.equal(untouched.clearedLoginCookieCount, 0);
  assert.equal(cleared.length, 0, 'a profile holding only device/network cookies is left untouched');
});
