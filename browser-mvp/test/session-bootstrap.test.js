import test from 'node:test';
import assert from 'node:assert/strict';

import { ContractError } from '../src/contracts.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';

test('CookieSessionBootstrapAdapter returns opaque lease and injects only inside the runtime boundary', async () => {
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
  assert.equal(result.cookieCount, 1);
  assert.equal(result.replacedCookieCount, 2);
  assert.deepEqual(cleared, [
    { name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token.1', domain: '.chatgpt.com', path: '/' },
  ]);
  assert.equal(added[0].name, '__Secure-next-auth.session-token');
  assert.equal(added[0].url, 'https://chatgpt.com');
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
