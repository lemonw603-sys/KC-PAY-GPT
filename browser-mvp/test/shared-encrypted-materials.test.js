import test from 'node:test';
import assert from 'node:assert/strict';

import { encryptSecret } from '../../v1/src/security/secret-box.js';
import { ContractError } from '../src/contracts.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';
import { InMemoryCardMaterialLeaseProvider } from '../src/card-material-lease.js';
import {
  browserRunMaterialRef,
  SharedEncryptedCardMaterialSource,
  SharedEncryptedMaterialError,
  SharedEncryptedSessionSource,
} from '../src/shared-encrypted-materials.js';

const key = Buffer.alloc(32, 41);
const nowMs = Date.parse('2026-08-29T06:00:00.000Z');

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'fixture-signature',
  ].join('.');
}

function sessionFixture() {
  const nowSeconds = Math.floor(nowMs / 1000);
  return {
    user: { id: 'fixture-user', email: 'fixture@example.test' },
    account: { id: 'fixture-account' },
    accessToken: jwt({ iat: nowSeconds - 60, exp: nowSeconds + 3600 }),
    sessionToken: 'fixture.jwe.encrypted.payload.tag',
    expires: new Date(nowMs + 3_600_000).toISOString(),
  };
}

function context(overrides = {}) {
  return {
    run_status: 'RUNNING', payment_state: 'NOT_STARTED',
    run_profile_id: 'profile-fixture', attempt_profile_id: 'profile-fixture',
    attempt_id: 'attempt-fixture', attempt_status: 'PREPARED', funds_risk_state: 'ACTIVE',
    executor_kind: 'BROWSER', attempt_route_id: 'route-fixture',
    order_id: 'order-fixture', order_status: 'RECHARGE_PROCESSING',
    order_route_id: 'route-fixture', route_id: 'route-fixture', route_executor_kind: 'BROWSER',
    card_id: 'card-fixture', card_provider_account_id: 'provider-fixture',
    route_card_provider_account_id: 'provider-fixture', consumption_status: 'RESERVED',
    consumption_attempt_id: 'attempt-fixture', consumption_order_id: 'order-fixture',
    consumption_card_id: 'card-fixture',
    session_ciphertext: encryptSecret(JSON.stringify(sessionFixture()), key),
    card_credentials_ciphertext: encryptSecret(JSON.stringify({
      cardNumber: '4111111111111111', expMonth: 12, expYear: 2032, cvv: '123',
    }), key),
    ...overrides,
  };
}

function dbReturning(row) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[row], []];
    },
  };
}

test('shared encrypted sources bind material to one active browser_run and short opaque leases', async () => {
  const sessionDb = dbReturning(context());
  const sessionProvider = new CookieSessionBootstrapAdapter({
    source: new SharedEncryptedSessionSource({ db: sessionDb, encryptionKey: key, now: () => nowMs }),
    clock: () => nowMs,
  });
  const runRef = browserRunMaterialRef('run-fixture');
  const sessionLease = await sessionProvider.open(runRef, { ttlMs: 5_000 });
  assert.equal('session' in sessionLease, false);
  assert.equal('sessionToken' in sessionLease, false);
  const cookies = [];
  const sessionResult = await sessionProvider.bootstrap(sessionLease, {
    addCookies: async (items) => cookies.push(...items),
  });
  assert.equal(sessionResult.cookieCount, 1);
  assert.equal(cookies[0].name, '__Secure-next-auth.session-token');
  assert.equal(sessionDb.calls.length, 1);
  assert.deepEqual(sessionDb.calls[0].params, ['run-fixture']);
  await sessionProvider.close(sessionLease);

  const cardDb = dbReturning(context());
  const cardProvider = new InMemoryCardMaterialLeaseProvider({
    source: new SharedEncryptedCardMaterialSource({ db: cardDb, encryptionKey: key }),
    clock: () => nowMs,
  });
  const cardLease = await cardProvider.open(runRef, { ttlMs: 5_000 });
  for (const field of ['pan', 'cvc', 'expMonth', 'expYear']) {
    assert.equal(Object.hasOwn(cardLease, field), false);
  }
  const safe = await cardProvider.withMaterial(cardLease, (material) => ({
    ready: true,
    fieldCount: Object.keys(material).length,
  }));
  assert.deepEqual(safe, { ready: true, fieldCount: 4 });
  assert.equal(cardDb.calls.length, 1);
  assert.deepEqual(cardDb.calls[0].params, ['run-fixture']);
  await cardProvider.close(cardLease);
});

test('shared encrypted material sources fail closed on state, reservation and ciphertext drift', async () => {
  const sessionSource = new SharedEncryptedSessionSource({
    db: dbReturning(context({ run_status: 'FAILED_SAFE' })),
    encryptionKey: key,
    now: () => nowMs,
  });
  await assert.rejects(
    () => sessionSource.load('browser-run:run-fixture'),
    (error) => error instanceof SharedEncryptedMaterialError && error.code === 'SESSION_INVALID',
  );

  const cardSource = new SharedEncryptedCardMaterialSource({
    db: dbReturning(context({ consumption_order_id: 'another-order' })),
    encryptionKey: key,
  });
  await assert.rejects(
    () => cardSource.load('browser-run:run-fixture'),
    (error) => error instanceof SharedEncryptedMaterialError && error.code === 'CARD_NOT_READY',
  );

  const profileDrift = new SharedEncryptedSessionSource({
    db: dbReturning(context({ attempt_profile_id: 'another-profile' })),
    encryptionKey: key,
    now: () => nowMs,
  });
  await assert.rejects(
    () => profileDrift.load('browser-run:run-fixture'),
    (error) => error.code === 'SESSION_INVALID',
  );

  const corrupt = new SharedEncryptedCardMaterialSource({
    db: dbReturning(context({ card_credentials_ciphertext: Buffer.from('not-a-secret-box') })),
    encryptionKey: key,
  });
  await assert.rejects(
    () => corrupt.load('browser-run:run-fixture'),
    (error) => error.code === 'CARD_NOT_READY'
      && !error.message.includes('not-a-secret-box')
      && !error.message.includes('4111111111111111'),
  );
  await assert.rejects(() => corrupt.load('order:wrong-namespace'), ContractError);
});
