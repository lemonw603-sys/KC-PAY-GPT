import assert from 'node:assert/strict';
import test from 'node:test';

import { encryptSecret } from '../../v1/src/security/secret-box.js';
import { sessionFixture } from '../../v1/test-support/session-fixture.js';
import {
  BrowserOrderEncryptedSessionSource,
  BrowserOrderPreflightRepository,
  browserOrderMaterialRef,
  createCardlessPreflightObservation,
  createBrowserOrderPreflightWorker,
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

function failHarness({ attempts, maxAttempts = 5, orderStatus = 'CARD_READY' }) {
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT status,version FROM orders')) return [[{ status: orderStatus, version: 1 }]];
      if (sql.includes('SELECT attempts,max_attempts FROM tasks')) return [[{ attempts, max_attempts: maxAttempts }]];
      return [{ affectedRows: 1 }];
    },
  };
  const repository = new BrowserOrderPreflightRepository({
    pool: { getConnection: async () => connection, query: async () => [[]] },
    workerId: 'worker-1', executorProfileId: 'database-profile', leaseSeconds: 120,
  });
  return { repository, calls };
}

// F-1: a lost lease is the worker's problem; it must not eat the order's attempt budget.
test('preflight lease loss requeues without counting an attempt, even at the last attempt', async () => {
  const { repository, calls } = failHarness({ attempts: 5 });
  const outcome = await repository.fail({ task_id: 9, order_id: 'order-1' }, Object.assign(new Error('lease lost'), { reason: 'LEASE_LOST' }));
  assert.deepEqual(outcome, { status: 'PENDING', reasonCode: 'LEASE_LOST', attemptCounted: false });
  const update = calls.find(({ sql }) => sql.includes('UPDATE tasks SET status=?'));
  assert.equal(update.params[0], 'PENDING');
  assert.equal(update.params[2], 1, 'attempt refunded');
  assert.equal(calls.some(({ sql }) => sql.includes('operator_alerts')), false);
});

// F-1: the fifth real failure used to write one order_event and nothing else; nobody was told.
test('preflight exhaustion raises a critical operator alert and points at the reopen script', async () => {
  const { repository, calls } = failHarness({ attempts: 5 });
  const outcome = await repository.fail({ task_id: 9, order_id: 'order-1' }, Object.assign(new Error('checkout 403'), { reason: 'CHECKOUT_NAVIGATION_FAILED' }));
  assert.deepEqual(outcome, { status: 'DEAD', reasonCode: 'CHECKOUT_NAVIGATION_FAILED', attemptCounted: true });
  const update = calls.find(({ sql }) => sql.includes('UPDATE tasks SET status=?'));
  assert.equal(update.params[0], 'DEAD');
  assert.equal(update.params[2], 0, 'a real failure is counted');
  const alert = calls.find(({ sql }) => sql.includes('INSERT INTO operator_alerts'));
  assert.ok(alert, 'operator alert written in the same transaction');
  assert.equal(alert.params[0], 'BROWSER_HUMAN_REQUIRED');
  assert.match(alert.params[5], /reopen-browser-preflight/);
  assert.ok(calls.some(({ sql }) => sql.includes('Browser preflight exhausted without payment')));
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


test('preflight passes the injected provider into the executor instead of constructing COOKIE', async (t) => {
  const { BrowserExecutionService } = await import('../src/executor.js');
  const calls = [];
  const provider = {
    open: async (ref) => { calls.push(ref); return { leaseId: 'fixture' }; },
    bootstrap: async () => { calls.push('injected-bootstrap'); return {}; },
    close: async () => { calls.push('closed'); },
    clearSession: async () => {},
  };
  t.mock.method(BrowserOrderPreflightRepository.prototype, 'claim', async () => ({ task_id:'fixture', order_id:'order-1' }));
  t.mock.method(BrowserOrderPreflightRepository.prototype, 'loadIdentity', async () => ({}));
  t.mock.method(BrowserOrderPreflightRepository.prototype, 'complete', async () => {});
  t.mock.method(BrowserOrderPreflightRepository.prototype, 'fail', async (_task,error) => { throw error; });
  t.mock.method(BrowserExecutionService.prototype, 'execute', async function(job) {
    assert.equal(this.sessionProvider, provider);
    const lease = await this.sessionProvider.open(job.metadata.sessionRef);
    await this.sessionProvider.bootstrap(lease, {});
    await this.sessionProvider.close(lease);
    return { submitCalls:0 };
  });
  const worker = createBrowserOrderPreflightWorker({
    pool:{query(){throw Error('unexpected DB');},getConnection(){throw Error('unexpected DB');}},
    workerId:'fixture',executorProfileId:'fixture',runtimeAdapter:{open(){},close(){}},
    observation:{},evidenceSink:{append(){}},sessionProvider:provider,
  });
  assert.equal((await worker.runOnce()).status,'COMPLETED');
  assert.deepEqual(calls,['browser-order:order-1','injected-bootstrap','closed']);
});
