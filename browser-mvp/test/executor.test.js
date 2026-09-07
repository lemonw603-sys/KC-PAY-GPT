import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { BrowserExecutionError, BrowserExecutionService } from '../src/executor.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';
import { createSyntheticJob } from '../src/fixtures.js';

const pageContract = {
  urlPrefix: 'data:text/html,',
  title: 'Browser MVP fixture',
  requiredSelector: '[data-browser-mvp-marker]',
  markerText: 'observe-only',
};

function makeJob(html = '<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main>') {
  const encoded = encodeURIComponent(html);
  return createSyntheticJob({
    state: 'RUNNING',
    metadata: { source: 'playwright-fixture', pageContract: { ...pageContract, urlPrefix: `data:text/html,${encoded}` } },
  });
}

async function withExecutor(callback) {
  const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
  const evidenceSink = new MemoryEvidenceSink();
  const executor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, timeoutMs: 3_000 });
  return callback(executor, evidenceSink);
}

test('local BrowserContext observes a page and never exposes a submit operation', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    const result = await executor.execute(makeJob(), { assertLease: async () => true });
    assert.equal(result.status, 'OBSERVED');
    assert.equal(result.submitCalls, 0);
    assert.deepEqual(evidenceSink.events.map((event) => event.type), ['intent', 'checkpoint']);
  });
});

test('page checkpoint waits for client hydration before checking the final title', async () => {
  await withExecutor(async (executor) => {
    const job = makeJob(`
      <title>Loading application</title>
      <script>
        setTimeout(() => {
          document.title = 'Browser MVP fixture';
          document.body.innerHTML = '<main data-browser-mvp-marker>observe-only</main>';
        }, 50);
      </script>
    `);
    const result = await executor.execute(job, { assertLease: async () => true });
    assert.equal(result.status, 'OBSERVED');
    assert.equal(result.submitCalls, 0);
  });
});

test('executor reuses the sole active-order page instead of opening another tab', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const job = makeJob();
  const existing = await context.newPage();
  await existing.goto(job.metadata.pageContract.urlPrefix);
  let newPageCalls = 0;
  const runtimeAdapter = {
    async open() {
      return { context: {
        pages: () => context.pages(),
        newPage: async () => { newPageCalls += 1; return context.newPage(); },
      } };
    },
    async close() {},
  };
  try {
    const executor = new BrowserExecutionService({
      runtimeAdapter, evidenceSink: new MemoryEvidenceSink(), timeoutMs: 1_000,
    });
    const result = await executor.execute(job, { assertLease: async () => true });
    assert.equal(result.status, 'OBSERVED');
    assert.equal(newPageCalls, 0);
    assert.equal(context.pages().length, 1);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('executor bootstraps an opaque Session lease before page observation', async () => {
  const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
  const evidenceSink = new MemoryEvidenceSink();
  const sessionProvider = new CookieSessionBootstrapAdapter({
    source: { load: async () => ({ cookieHeader: '__Secure-next-auth.session-token=fixture-session' }) },
  });
  const executor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, sessionProvider, timeoutMs: 3_000 });
  const job = makeJob();
  job.metadata.sessionRef = 'session-ref:executor';
  const result = await executor.execute(job, { assertLease: async () => true });
  assert.equal(result.sessionBootstrapped, true);
  assert.equal(result.submitCalls, 0);
  assert.equal(evidenceSink.events[1].summary.action, 'session-bootstrap');
  assert.equal(evidenceSink.events[1].summary.sessionDigest.length, 64);
  assert.equal(sessionProvider.leases.size, 0);
});

test('lease loss immediately before Session material access is not misclassified and reads nothing', async () => {
  let sourceReads = 0;
  const sessionProvider = new CookieSessionBootstrapAdapter({
    source: { load: async () => { sourceReads += 1; return { sessionToken: 'must-not-load' }; } },
  });
  const executor = new BrowserExecutionService({
    runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
    evidenceSink: new MemoryEvidenceSink(),
    sessionProvider,
    timeoutMs: 3_000,
  });
  const job = makeJob();
  job.metadata.sessionRef = 'session-ref:lease-loss';
  let leaseChecks = 0;
  await assert.rejects(
    () => executor.execute(job, { assertLease: async () => ++leaseChecks === 1 }),
    (error) => error instanceof BrowserExecutionError && error.reason === 'LEASE_LOST',
  );
  assert.equal(sourceReads, 0);
  assert.equal(sessionProvider.leases.size, 0);
});

test('card material preflight is read once, never written to the page, and closed immediately', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    const calls = [];
    const provider = {
      async open(ref, options) {
        calls.push(['open', ref, options.purpose, options.ttlMs]);
        return { leaseId: 'lease-fixture', cardRef: ref, expiresAt: Date.now() + 60_000 };
      },
      async withMaterial(_lease, callback) {
        calls.push(['withMaterial']);
        return callback({ pan: '4111111111111111', expMonth: 12, expYear: 2032, cvc: '123' });
      },
      async close(lease) {
        calls.push(['close', lease.leaseId]);
      },
    };
    const result = await executor.execute(makeJob(), {
      assertLease: async () => true,
      cardMaterialLeaseProvider: provider,
      cardMaterialRef: 'browser-run:fixture',
      validateCardMaterialOnly: true,
    });
    assert.equal(result.cardMaterialReady, true);
    assert.equal(result.submitCalls, 0);
    assert.deepEqual(calls, [
      ['open', 'browser-run:fixture', 'browser-nonpayment-preflight', 300_000],
      ['withMaterial'],
      ['close', 'lease-fixture'],
    ]);
    const event = evidenceSink.events.find((entry) => entry.summary.action === 'card-material-preflight');
    assert.deepEqual(event.summary, {
      action: 'card-material-preflight', ready: true, fieldsWritten: 0, submitCalls: 0,
    });
    assert.equal(JSON.stringify(result).includes('4111111111111111'), false);
    assert.equal(JSON.stringify(evidenceSink.events).includes('4111111111111111'), false);
  });
});

test('page drift fails closed and records a redacted freeze reason', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    await assert.rejects(
      () => executor.execute(makeJob('<title>Unexpected page</title><main data-browser-mvp-marker>observe-only</main>'), { assertLease: async () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'PAGE_DRIFT',
    );
    assert.equal(evidenceSink.events.at(-1).type, 'freeze');
    assert.equal(evidenceSink.events.at(-1).summary.reason, 'PAGE_DRIFT');
  });
});

test('LIVE recovery mode detaches instead of destroying the active-order Profile on failure', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const calls = [];
  const runtimeAdapter = {
    async open() { calls.push('open'); return { context }; },
    async detach() { calls.push('detach'); },
    async close() { calls.push('close'); await context.close(); },
  };
  const executor = new BrowserExecutionService({
    runtimeAdapter,
    evidenceSink: new MemoryEvidenceSink(),
    timeoutMs: 1_000,
  });
  try {
    await assert.rejects(
      () => executor.execute(
        makeJob('<title>Unexpected page</title><main data-browser-mvp-marker>observe-only</main>'),
        { assertLease: async () => true, preserveRuntimeOnFailure: true },
      ),
      (error) => error instanceof BrowserExecutionError && error.reason === 'PAGE_DRIFT',
    );
    assert.deepEqual(calls, ['open', 'detach']);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close();
  }
});

test('lease loss after navigation fails closed before checkpoint', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    let checks = 0;
    await assert.rejects(
      () => executor.execute(makeJob(), { assertLease: async () => ++checks < 2 }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'LEASE_LOST',
    );
    assert.deepEqual(evidenceSink.events.map((event) => event.type), ['intent', 'freeze']);
  });
});

test('manual freeze and navigation timeout both fail closed', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    await assert.rejects(
      () => executor.execute(makeJob(), { assertLease: async () => true, freezeRequested: () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'MANUAL_FREEZE',
    );
    assert.equal(evidenceSink.events.at(-1).summary.reason, 'MANUAL_FREEZE');
  });

  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main>');
    }, 250);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/slow`;
    const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
    const evidenceSink = new MemoryEvidenceSink();
    const timedExecutor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, timeoutMs: 20 });
    const job = createSyntheticJob({
      state: 'RUNNING',
      metadata: { source: 'slow-fixture', pageContract: { ...pageContract, urlPrefix: url } },
    });
    await assert.rejects(
      () => timedExecutor.execute(job, { assertLease: async () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'ACTION_TIMEOUT',
    );
    assert.equal(evidenceSink.events.at(-1).summary.reason, 'ACTION_TIMEOUT');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

// Regression for the 2026-09-06 real order: with a paymentHandler present the
// executor used to fill address/email itself and then block on a strict
// zero-tax requote before any card existed, timing out with
// CHECKOUT_OBSERVATION_FAILED so the LIVE adapter never ran. Now it hands the
// non-strict observation straight to the handler, which owns the single pass.
test('payment handler receives the checkout without a pre-card strict zero-tax requote', async () => {
  const checkoutHtml = `<title>ChatGPT fixture</title><main data-testid="checkout-page-content"><form data-testid="checkout-form"><iframe srcdoc='<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">'></iframe></form><section data-testid="checkout-summary-column"><h2>ChatGPT Plus</h2><div><span>Monthly subscription</span><span>₱982.14</span></div><div><span>VAT (12%)</span><span>₱117.86</span></div><div><span>Due today</span><span>₱1,100.00</span></div><button type="submit">Subscribe</button></section></main>`;
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ user: { id: 'user-001', email: 'buyer@example.test' }, account: { id: 'acct-001' }, accessToken: 'fixture-token' }));
    }
    if (request.url === '/backend-api/accounts/check/v4-fixture') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ accounts: { default: { entitlement: { has_active_subscription: false, subscription_plan: 'chatgptplusplan' } } } }));
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(checkoutHtml);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    await withExecutor(async (executor, evidenceSink) => {
      const { CHATGPT_PLUS_CHECKOUT_CONTRACT } = await import('../src/checkout-observer.js');
      const job = createSyntheticJob({
        state: 'RUNNING',
        metadata: {
          source: 'playwright-fixture',
          pageContract: { urlPrefix: base, title: 'ChatGPT fixture', requiredSelector: 'main[data-testid="checkout-page-content"]', markerText: '' },
          accountProbeContract: { accountCheckPath: '/backend-api/accounts/check/v4-fixture' },
          sessionIdentity: { email: 'buyer@example.test', accountId: 'acct-001', userId: 'user-001' },
          checkoutContract: { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, urlPrefix: base },
        },
      });
      const provider = {
        async open(ref) { return { leaseId: 'lease-fixture', cardRef: ref, expiresAt: Date.now() + 60_000 }; },
        async withMaterial(_lease, callback) {
          return callback({ pan: '4111111111111111', expMonth: 12, expYear: 2032, cvc: '123', billingAddress: { line1: '1 Main St', city: 'Wilmington', state: 'DE', postalCode: '19801', country: 'US', name: 'Test User' } });
        },
        async close() {},
      };
      const handlerCalls = [];
      const startedAt = Date.now();
      const result = await executor.execute(job, {
        assertLease: async () => true,
        cardMaterialLeaseProvider: provider,
        cardMaterialRef: 'browser-run:fixture',
        paymentHandler: async ({ page, checkout, checkoutContract, cardMaterial, billingEmail }) => {
          handlerCalls.push({
            recognized: checkout?.recognized, estimatedTax: checkout?.estimatedTax, currency: checkout?.currency,
            strictContract: checkoutContract?.requireZeroTax, hasCard: Boolean(cardMaterial?.pan), billingEmail,
            // the handler owns the single fill pass: fields must still be untouched here
            emailFieldPresent: await page.locator('input[type="email"]').count(),
          });
          return { status: 'COMPLETED', paymentSubmitCalls: 0 };
        },
      });
      const elapsedMs = Date.now() - startedAt;
      assert.equal(result.status, 'PAYMENT_EXECUTED');
      assert.equal(handlerCalls.length, 1);
      assert.equal(handlerCalls[0].recognized, true);
      assert.equal(handlerCalls[0].currency, 'PHP');
      assert.notEqual(Number(handlerCalls[0].estimatedTax), 0, 'handler must get the pre-card quote even though VAT is not yet zero');
      assert.equal(handlerCalls[0].strictContract, true, 'the strict contract is still passed down for the adapter to enforce after the fill');
      assert.equal(handlerCalls[0].hasCard, true);
      assert.equal(handlerCalls[0].billingEmail, 'buyer@example.test');
      assert.equal(result.checkout, null, 'no strict requote is observed by the executor itself');
      assert.ok(elapsedMs < 2_500, `executor must not block on a zero-tax requote before the card (took ${elapsedMs}ms)`);
      assert.equal(evidenceSink.events.some((event) => event.type === 'freeze'), false);
      assert.equal(JSON.stringify(evidenceSink.events).includes('4111111111111111'), false);
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});

// One resident identity serves customers one after another. When the profile
// still holds the previous customer's session, the identity probe fails and the
// executor must replace that session once with this order's token, reload and
// probe again, instead of failing the order with SESSION_IDENTITY_MISMATCH.
test('executor replaces a resident session that belongs to another customer, once, then proceeds', async () => {
  let residentIdentity = { id: 'user-prev', email: 'previous@example.test', accountId: 'acct-prev' };
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ user: { id: residentIdentity.id, email: residentIdentity.email }, account: { id: residentIdentity.accountId }, accessToken: 'fixture-token' }));
    }
    if (request.url === '/backend-api/accounts/check/v4-fixture') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ accounts: { default: { entitlement: { has_active_subscription: false, subscription_plan: 'chatgptplusplan' } } } }));
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<title>ChatGPT fixture</title><main data-browser-mvp-marker>logged in</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const bootstrapCalls = [];
  let closed = 0;
  const sessionProvider = {
    async open() { return { leaseId: 'lease-replace', sessionDigest: 'a'.repeat(64), expiresAt: Date.now() + 60_000, purpose: 'browser-observe' }; },
    async bootstrap(_lease, _context, options = {}) {
      bootstrapCalls.push(options.replaceExisting === true ? 'replace' : 'preserve');
      if (options.replaceExisting) {
        // the new token now logs in as this order's customer
        residentIdentity = { id: 'user-001', email: 'buyer@example.test', accountId: 'acct-001' };
        return { cookieCount: 1, replacedCookieCount: 1, existingSessionPreserved: false, sessionDigest: 'b'.repeat(64) };
      }
      return { cookieCount: 1, replacedCookieCount: 0, existingSessionPreserved: true, sessionDigest: 'a'.repeat(64) };
    },
    async close() { closed += 1; },
  };
  try {
    const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
    const evidenceSink = new MemoryEvidenceSink();
    const executor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, sessionProvider, timeoutMs: 3_000 });
    const job = createSyntheticJob({
      state: 'RUNNING',
      metadata: {
        source: 'playwright-fixture',
        sessionRef: 'session-ref:replace',
        pageContract: { urlPrefix: base, title: 'ChatGPT fixture', requiredSelector: '[data-browser-mvp-marker]', markerText: '' },
        accountProbeContract: { accountCheckPath: '/backend-api/accounts/check/v4-fixture' },
        sessionIdentity: { email: 'buyer@example.test', accountId: 'acct-001', userId: 'user-001' },
      },
    });
    const result = await executor.execute(job, { assertLease: async () => true });
    assert.equal(result.status, 'OBSERVED');
    assert.equal(result.sessionBootstrapped, true);
    assert.equal(result.sessionIdentity.identityMatched, true);
    assert.deepEqual(bootstrapCalls, ['preserve', 'replace']);
    assert.equal(closed, 1, 'the session lease is closed exactly once after the probe settles');
    const actions = evidenceSink.events.map((event) => event.summary.action);
    assert.deepEqual(actions.filter((action) => ['session-bootstrap', 'session-replaced', 'account-readonly-probe'].includes(action)),
      ['session-bootstrap', 'session-replaced', 'account-readonly-probe']);
    assert.equal(JSON.stringify(evidenceSink.events).includes('fixture-token'), false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('executor still fails closed when the replaced session does not match either', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ user: { id: 'user-prev', email: 'previous@example.test' }, account: { id: 'acct-prev' }, accessToken: 'fixture-token' }));
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<title>ChatGPT fixture</title><main data-browser-mvp-marker>logged in</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const bootstrapCalls = [];
  const sessionProvider = {
    async open() { return { leaseId: 'lease-replace-2', sessionDigest: 'a'.repeat(64), expiresAt: Date.now() + 60_000, purpose: 'browser-observe' }; },
    async bootstrap(_lease, _context, options = {}) {
      bootstrapCalls.push(options.replaceExisting === true ? 'replace' : 'preserve');
      return options.replaceExisting
        ? { cookieCount: 1, replacedCookieCount: 1, existingSessionPreserved: false, sessionDigest: 'b'.repeat(64) }
        : { cookieCount: 1, replacedCookieCount: 0, existingSessionPreserved: true, sessionDigest: 'a'.repeat(64) };
    },
    async close() {},
  };
  try {
    const executor = new BrowserExecutionService({
      runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
      evidenceSink: new MemoryEvidenceSink(), sessionProvider, timeoutMs: 3_000,
    });
    const job = createSyntheticJob({
      state: 'RUNNING',
      metadata: {
        source: 'playwright-fixture',
        sessionRef: 'session-ref:replace-2',
        pageContract: { urlPrefix: base, title: 'ChatGPT fixture', requiredSelector: '[data-browser-mvp-marker]', markerText: '' },
        accountProbeContract: { accountCheckPath: '/backend-api/accounts/check/v4-fixture' },
        sessionIdentity: { email: 'buyer@example.test', accountId: 'acct-001', userId: 'user-001' },
      },
    });
    await assert.rejects(
      () => executor.execute(job, { assertLease: async () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'SESSION_IDENTITY_MISMATCH',
    );
    assert.deepEqual(bootstrapCalls, ['preserve', 'replace'], 'exactly one replacement attempt, never a loop');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
