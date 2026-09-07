import test from 'node:test';
import assert from 'node:assert/strict';

import { isSessionCookieName, splitSessionCookie } from '../extensions/nuohuisheng-session-loader/cookie-chunks.mjs';
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
