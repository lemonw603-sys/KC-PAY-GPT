import test from 'node:test';
import assert from 'node:assert/strict';

import { isSessionCookieName, sessionCookieRemovals, splitSessionCookie, staleLoginCookieRemovals } from '../extensions/nuohuisheng-session-loader/cookie-chunks.mjs';
import { parseSessionInput, SUPPORTED_SESSION_COOKIE_NAMES } from '../extensions/nuohuisheng-session-loader/token.mjs';

test('derived session loader parses JSON and chunks long NextAuth tokens', () => {
  const token = 'x'.repeat(8_500);
  const parsed = parseSessionInput(JSON.stringify({ sessionToken: token }));
  const chunks = splitSessionCookie(parsed.name, parsed.value);
  assert.deepEqual(chunks.map((chunk) => chunk.name), [
    '__Secure-next-auth.session-token.0',
    '__Secure-next-auth.session-token.1',
    '__Secure-next-auth.session-token.2',
  ]);
  assert.equal(chunks.map((chunk) => chunk.value).join(''), token);
  assert.equal(chunks.every((chunk) => chunk.value.length <= 3936), true);
});

test('derived session loader recognizes base and chunk cookie names', () => {
  assert.equal(isSessionCookieName('__Secure-next-auth.session-token.0', SUPPORTED_SESSION_COOKIE_NAMES), true);
  assert.equal(isSessionCookieName('__Secure-authjs.session-token', SUPPORTED_SESSION_COOKIE_NAMES), true);
  assert.equal(isSessionCookieName('__cf_bm', SUPPORTED_SESSION_COOKIE_NAMES), false);
});

test('derived session loader finds sessionToken inside nested JSON and snake_case keys', () => {
  const token = 'eyJ' + 'a'.repeat(40) + '.b.c.d.e';
  assert.equal(parseSessionInput(JSON.stringify({ data: { session: { session_token: token } } })).value, token);
  assert.equal(parseSessionInput(JSON.stringify([{ sessionToken: token }])).value, token);
});

test('derived session loader rejects an accessToken JWT and explains what to paste instead', () => {
  const accessToken = 'eyJhbGciOiJSUzI1NiJ9.' + 'p'.repeat(60) + '.' + 's'.repeat(40);
  assert.throws(() => parseSessionInput(accessToken), /accessToken/);
  assert.throws(() => parseSessionInput(JSON.stringify({ accessToken, user: { id: 'user-1' } })), /没有 sessionToken 字段/);
  const sessionToken = 'eyJhbGciOiJkaXIi.' + 'q'.repeat(60) + '.r.s.t';
  assert.equal(parseSessionInput(sessionToken).value, sessionToken);
});

test('derived session loader recovers the token from non-strict or partially copied JSON', () => {
  const token = 'eyJhbGciOiJkaXIi..' + 'v'.repeat(60) + '.w.x';
  // Explanatory text around the JSON, as sellers often paste it.
  assert.equal(parseSessionInput(`账号信息：{"sessionToken":"${token}","accessToken":"eyJ.a.b"} 请勿外传`).value, token);
  // Unquoted key and single quotes: JSON.parse fails, the loose scan still finds the value.
  assert.equal(parseSessionInput(`{sessionToken: '${token}', user: {id: 'user-1'}}`).value, token);
  // Copy cut off after the token: the token itself is intact, so it is accepted.
  assert.equal(parseSessionInput(`{"user":{"id":"user-1"},"sessionToken":"${token}","expi`).value, token);
  // Copy cut off inside the token: rejected with an "incomplete" hint instead of a bad cookie.
  assert.throws(() => parseSessionInput(`{"sessionToken":"${token.slice(0, 40)}`), /不完整/);
  // Unparseable text without any token key: explains what to paste.
  assert.throws(() => parseSessionInput('{"user":{"id":"user-1"},"accessTo'), /找不到 sessionToken/);
});

test('derived session loader removes every existing session cookie variant before writing a replacement', () => {
  const existing = [
    { name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token.1', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token', domain: 'chatgpt.com', path: '/' },
    { name: '__Secure-authjs.session-token', domain: '.chatgpt.com', path: '/api' },
    { name: '__cf_bm', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', path: '/' }
  ];
  assert.deepEqual(sessionCookieRemovals(existing, SUPPORTED_SESSION_COOKIE_NAMES), [
    { url: 'https://chatgpt.com/', name: '__Secure-next-auth.session-token.0' },
    { url: 'https://chatgpt.com/', name: '__Secure-next-auth.session-token.1' },
    { url: 'https://chatgpt.com/', name: '__Secure-next-auth.session-token' },
    { url: 'https://chatgpt.com/api', name: '__Secure-authjs.session-token' }
  ]);
});


test('derived session loader drops the previous login state but keeps device and Cloudflare cookies', () => {
  const existing = [
    { name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', path: '/' },
    { name: 'oai-client-auth-info', domain: 'chatgpt.com', path: '/' },
    { name: 'oai-client-session-epoch', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.callback-url', domain: 'chatgpt.com', path: '/' },
    { name: '__Host-next-auth.csrf-token', domain: 'chatgpt.com', path: '/' },
    { name: 'cf_clearance', domain: '.chatgpt.com', path: '/' },
    { name: '__cf_bm', domain: '.chatgpt.com', path: '/' },
    { name: 'oai-did', domain: '.chatgpt.com', path: '/' },
    { name: '__stripe_mid', domain: '.chatgpt.com', path: '/' }
  ];
  assert.deepEqual(staleLoginCookieRemovals(existing, SUPPORTED_SESSION_COOKIE_NAMES).map((t) => t.name).sort(), [
    '__Host-next-auth.csrf-token', '__Secure-next-auth.callback-url', 'oai-client-auth-info', 'oai-client-session-epoch'
  ]);
});
