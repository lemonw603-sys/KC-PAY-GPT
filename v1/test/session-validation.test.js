import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChatGptSession } from '../src/domain/session-validation.js';
import { sessionFixture } from '../test-support/session-fixture.js';

const nowMs = Date.parse('2026-08-17T00:00:00.000Z');

test('validates a complete Session without removing extension fields', () => {
  const session = sessionFixture({ nowMs });
  const result = validateChatGptSession(session, { now: () => nowMs });
  assert.equal(result.session, session);
  assert.equal(result.customerEmail, 'fixture@example.com');
  assert.equal(result.chatgptAccountId, 'account-fixture');
  assert.deepEqual(result.session.extension, { preserved: true });
});

test('rejects incomplete, expired and near-expiry Session inputs', () => {
  const incomplete = sessionFixture({ nowMs });
  delete incomplete.sessionToken;
  assert.throws(
    () => validateChatGptSession(incomplete, { now: () => nowMs }),
    (error) => error.code === 'INCOMPLETE_SESSION'
  );

  const expired = sessionFixture({ nowMs, lifetimeSeconds: -1 });
  assert.throws(
    () => validateChatGptSession(expired, { now: () => nowMs }),
    (error) => ['SESSION_EXPIRED', 'ACCESS_TOKEN_EXPIRED'].includes(error.code)
  );

  const nearExpiry = sessionFixture({ nowMs, lifetimeSeconds: 120 });
  assert.throws(
    () => validateChatGptSession(nearExpiry, { now: () => nowMs }),
    (error) => error.code === 'ACCESS_TOKEN_NEAR_EXPIRY'
  );
});

test('requires a three-part access token and five-part session token', () => {
  const badAccess = sessionFixture({ nowMs });
  badAccess.accessToken = 'not-a-jwt';
  assert.throws(
    () => validateChatGptSession(badAccess, { now: () => nowMs }),
    (error) => error.code === 'INVALID_ACCESS_TOKEN'
  );

  const badSession = sessionFixture({ nowMs });
  badSession.sessionToken = 'only.two.parts';
  assert.throws(
    () => validateChatGptSession(badSession, { now: () => nowMs }),
    (error) => error.code === 'INVALID_SESSION_TOKEN'
  );

  const missingCiphertext = sessionFixture({ nowMs });
  missingCiphertext.sessionToken = 'header..iv..tag';
  assert.throws(
    () => validateChatGptSession(missingCiphertext, { now: () => nowMs }),
    (error) => error.code === 'INVALID_SESSION_TOKEN'
  );
});
