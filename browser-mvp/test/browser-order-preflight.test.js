import assert from 'node:assert/strict';
import test from 'node:test';

import { encryptSecret } from '../../v1/src/security/secret-box.js';
import { sessionFixture } from '../../v1/test-support/session-fixture.js';
import {
  BrowserOrderEncryptedSessionSource,
  BrowserOrderPreflightRepository,
  browserOrderMaterialRef,
  createCardlessPreflightObservation,
  summarizeBrowserPreflight,
} from '../src/browser-order-preflight.js';

const nowMs = Date.parse('2026-09-05T00:00:00.000Z');
const key = Buffer.alloc(32, 19);

test('order-scoped Session source accepts only a pre-payment Browser order', async () => {
  const session = sessionFixture({ nowMs, lifetimeSeconds: 7200 });
  const source = new BrowserOrderEncryptedSessionSource({
    encryptionKey: key,
    now: () => nowMs,
    db: {
      async query(sql, values) {
        assert.match(sql, /fr\.executor_kind/);
        assert.deepEqual(values, ['order-1']);
        return [[{
          status: 'WAITING_FOR_CARD',
          executor_kind: 'BROWSER',
          session_ciphertext: encryptSecret(JSON.stringify(session), key),
        }]];
      },
    },
  });
  const material = await source.load(browserOrderMaterialRef('order-1'));
  assert.equal(material.sessionToken, session.sessionToken);
});

test('order-scoped Session source rejects API and post-payment orders without blaming the Session', async () => {
  for (const row of [
    { status: 'WAITING_FOR_CARD', executor_kind: 'API', session_ciphertext: 'x' },
    { status: 'RECHARGE_PROCESSING', executor_kind: 'BROWSER', session_ciphertext: 'x' },
  ]) {
    const source = new BrowserOrderEncryptedSessionSource({
      encryptionKey: key,
      db: { query: async () => [[row]] },
    });
    await assert.rejects(
      source.load(browserOrderMaterialRef('order-1')),
      (error) => error.code === 'BROWSER_PREFLIGHT_CONTEXT_UNAVAILABLE',
    );
  }
});

test('order-scoped Session source does not misclassify a database outage as customer Session invalid', async () => {
  const source = new BrowserOrderEncryptedSessionSource({
    encryptionKey: key,
    db: { query: async () => { throw new Error('database unavailable'); } },
  });
  await assert.rejects(
    source.load(browserOrderMaterialRef('order-1')),
    (error) => error.code === 'BROWSER_PREFLIGHT_SOURCE_UNAVAILABLE',
  );
});

test('preflight summary keeps only non-payment operational evidence', () => {
  const summary = summarizeBrowserPreflight({
    submitCalls: 0,
    sessionIdentity: {
      loggedIn: true, identityMatched: true, subscriptionStatus: 'FREE', alreadyPlus: false,
      httpStatus: 200, subscriptionHttpStatus: 200,
    },
    checkoutNavigation: { plusEntryPresent: true, checkoutCreated: true, questionnaireSkipped: false },
    checkout: {
      recognized: true, currency: 'PHP', amount: '982.14', estimatedTax: null,
      paymentFormPresent: true, submitControlPresent: true,
      cardFieldsPresent: { number: true, expiry: true, securityCode: true },
    },
  });
  assert.equal(summary.outcome, 'PASSED');
  assert.equal(summary.checkout.amount, '982.14');
  assert.equal(summary.submitCalls, 0);
  assert.throws(() => summarizeBrowserPreflight({ submitCalls: 1 }), /payment submit call/);
});

test('cardless preflight permits the initial VAT quote without weakening the payment contract', () => {
  const strictCheckoutContract = Object.freeze({
    requiredCurrency: 'PHP',
    inspectSecureCardFields: true,
    requireSecureCardFields: true,
    requireZeroTax: true,
    requireQuoteConsistency: true,
  });
  const observation = {
    pageContract: { urlPrefix: 'https://chatgpt.com/' },
    checkoutContract: strictCheckoutContract,
  };
  const preflight = createCardlessPreflightObservation(observation);
  assert.equal(preflight.checkoutContract.requiredCurrency, 'PHP');
  assert.equal(preflight.checkoutContract.inspectSecureCardFields, false);
  assert.equal(preflight.checkoutContract.requireSecureCardFields, false);
  assert.equal(preflight.checkoutContract.requireZeroTax, false);
  assert.equal(preflight.checkoutContract.requireQuoteConsistency, false);
  assert.equal(strictCheckoutContract.requireZeroTax, true);
  assert.equal(strictCheckoutContract.requireQuoteConsistency, true);
});

test('preflight repository claims only Browser preflight tasks with the database profile', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT t.id AS task_id')) {
        return [[{ task_id: 9, order_id: 'order-1', attempts: 0, max_attempts: 5 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const repository = new BrowserOrderPreflightRepository({
    pool: { getConnection: async () => connection, query: async () => [[]] },
    workerId: 'worker-1', executorProfileId: 'database-profile', leaseSeconds: 120,
  });
  const task = await repository.claim();
  assert.equal(task.attempts, 1);
  assert.deepEqual(calls[0].params, ['database-profile', 'BROWSER_PREFLIGHT']);
  assert.match(calls[0].sql, /o\.status IN \('CREATED','WAITING_FOR_CARD','CARD_READY'\)/);
  assert.match(calls[0].sql, /fr\.executor_kind = 'BROWSER'/);
});
