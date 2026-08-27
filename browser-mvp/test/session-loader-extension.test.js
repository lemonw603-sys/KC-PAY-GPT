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
