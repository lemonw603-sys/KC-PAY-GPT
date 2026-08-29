import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { FileDispatchStore } from '../src/dispatch-store.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { BrowserExecutionService } from '../src/executor.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { createSyntheticManifest } from '../src/fixtures.js';
import { runNonPaymentUpstreamSimulation } from '../src/nonpayment-simulation.js';
import { runFrontloadedNonPaymentIntegration } from '../src/frontloaded-p0-integration.js';
import { DurableCardMaterialLeaseProvider } from '../src/durable-card-material-lease.js';
import { HnskjCardMaterialSource, mapHnskjCardMaterial } from '../src/hnskj-card-material-source.js';
import { ContractError, hasSensitiveKey } from '../src/contracts.js';
import { projectUpstreamBrowserJob } from '../src/shared-contract-adapter.js';
import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } from '../src/chatgpt-checkout-navigator.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT } from '../src/checkout-observer.js';

const now = Date.parse('2026-08-26T00:00:00.000Z');
const pageHtml = encodeURIComponent(
  '<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main>',
);

function projection(overrides = {}) {
  return {
    order: {
      id: 'ord-upstream-0001', status: 'RECHARGE_PROCESSING',
      fulfillmentRouteId: 'route:browser:0001',
    },
    attempt: {
      id: 'att-upstream-0001', status: 'PREPARED', fundsRiskState: 'ACTIVE',
      executorKind: 'BROWSER', executorProfileId: 'prof-upstream-0001',
      fulfillmentRouteId: 'route:browser:0001',
    },
    profile: { id: 'prof-upstream-0001' },
    card: {
      id: 'card:inventory:0001',
      orderId: 'ord-upstream-0001',
      providerCardRef: 'provider-card:0001',
      providerAccountId: 'provider-account:hnskj:0001',
    },
    cardConsumption: {
      id: 'consumption:0001', status: 'RESERVED',
      attemptId: 'att-upstream-0001', orderId: 'ord-upstream-0001', cardId: 'card:inventory:0001',
    },
    route: {
      id: 'route:browser:0001',
      cardProviderAccountId: 'provider-account:hnskj:0001',
      executorKind: 'BROWSER',
    },
    observation: {
      pageContract: {
        urlPrefix: `data:text/html,${pageHtml}`,
        title: 'Browser MVP fixture',
        requiredSelector: '[data-browser-mvp-marker]',
        markerText: 'observe-only',
      },
    },
    ...overrides,
  };
}

test('upstream projection carries only formal card/route bindings', () => {
  const job = projectUpstreamBrowserJob(projection(), {
    manifest: createSyntheticManifest(),
    now,
  });
  assert.equal(job.metadata.upstream.cardId, 'card:inventory:0001');
  assert.equal(job.metadata.upstream.routeId, 'route:browser:0001');
  assert.equal(job.metadata.upstream.cardProviderAccountId, 'provider-account:hnskj:0001');
  assert.equal(hasSensitiveKey(job), false);
  assert.equal('cardNumber' in job.metadata.upstream, false);
  assert.equal('cvv' in job.metadata.upstream, false);
  assert.equal(job.metadata.upstream.providerCardRef, 'provider-card:0001');
});

test('HNSKJ card material source is read-only and normalizes provider credentials', async () => {
  const calls = [];
  const source = new HnskjCardMaterialSource({
    provider: { card: async (providerCardRef) => { calls.push(providerCardRef); return { data: { card: { cardNumber: '4111111111111111', expiryMonth: 12, expiryYear: 2030, cvv: '123' } } }; } },
  });
  const material = await source.load('provider-card:0001');
  assert.deepEqual(material, { pan: '4111111111111111', cvc: '123', expMonth: 12, expYear: 2030 });
  assert.deepEqual(calls, ['provider-card:0001']);
  assert.throws(() => mapHnskjCardMaterial({ data: { card: { cardNumber: 'bad' } } }), ContractError);
  assert.throws(() => mapHnskjCardMaterial({ data: { card: { cardNumber: '4111111111111111', expiryMonth: 12, expiryYear: 2020, cvv: '123' } } }), ContractError);
  assert.equal(typeof source.provider.purchaseCard, 'undefined');
  assert.equal(source.requiresProviderCardRef, true);
});

test('non-executable, mismatched, or non-browser bindings fail before dispatch', () => {
  assert.throws(
    () => projectUpstreamBrowserJob(projection({
      order: { ...projection().order, status: 'RECONCILIATION_REQUIRED' },
    }), { now }),
    ContractError,
  );
  assert.throws(
    () => projectUpstreamBrowserJob(projection({
      route: { ...projection().route, cardProviderAccountId: 'provider-account:other:0001' },
    }), { now }),
    ContractError,
  );
  assert.throws(
    () => projectUpstreamBrowserJob(projection({
      route: { ...projection().route, executorKind: 'API' },
    }), { now }),
    ContractError,
  );
});

test('non-payment simulation runs upstream projection through dispatch and BrowserContext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-upstream-sim-'));
  try {
    const dispatchStore = await new FileDispatchStore({
      filePath: join(dir, 'dispatch.json'),
      leaseMs: 5_000,
    }).init();
    const evidenceSink = new MemoryEvidenceSink();
    const executionService = new BrowserExecutionService({
      runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
      evidenceSink,
      timeoutMs: 2_000,
    });
    const result = await runNonPaymentUpstreamSimulation({
      projection: projection(),
      dispatchStore,
      executionService,
      now,
    });
    assert.equal(result.result.status, 'OBSERVED');
    assert.equal(result.result.submitCalls, 0);
    assert.equal(result.completed.job.state, 'COMPLETED');
    assert.deepEqual(evidenceSink.events.map((event) => event.type), ['intent', 'checkpoint']);
    const snapshot = await dispatchStore.snapshot();
    assert.equal(snapshot.jobs[result.job.jobId].job.state, 'COMPLETED');
    assert.equal(snapshot.jobs[result.job.jobId].job.metadata.upstream.cardId, 'card:inventory:0001');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('frontloaded P0 integration consumes a card lease and releases it after observation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-upstream-p0-'));
  try {
    const dispatchStore = await new FileDispatchStore({ filePath: join(dir, 'dispatch.json'), leaseMs: 5_000 }).init();
    const evidenceSink = new MemoryEvidenceSink();
    const executionService = new BrowserExecutionService({
      runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
      evidenceSink,
      timeoutMs: 2_000,
    });
    let loads = 0;
    const cardMaterialLeaseProvider = await new DurableCardMaterialLeaseProvider({
      filePath: join(dir, 'card-leases.json'),
      source: { load: async () => { loads += 1; return { pan: '4111111111111111', expMonth: '12', expYear: '2030', cvc: '123' }; } },
    }).init();
    const result = await runFrontloadedNonPaymentIntegration({
      projection: projection(),
      dispatchStore,
      executionService,
      cardMaterialLeaseProvider,
      materialRef: 'provider-card:0001',
      now,
    });
    assert.equal(result.result.status, 'OBSERVED');
    assert.equal(result.result.submitCalls, 0);
    assert.equal(loads, 1, 'card material is read once inside the callback to minimize provider calls');
    assert.equal(Object.values(cardMaterialLeaseProvider.snapshot().leases)[0].state, 'RELEASED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('frontloaded P0 card-fill slice fills fixture Stripe fields, clears them, and never submits', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url?.startsWith('/checkout/')) {
      response.end(`<title>Browser MVP fixture</title><main data-testid="checkout-page-content"><form data-testid="checkout-form"><iframe srcdoc='\
        <input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">\
      '></iframe></form><section data-testid="checkout-summary-column"><h2>Plus plan</h2><div><span>Total due today</span><span>US$20.00</span></div><div><span>Estimated tax</span><span>US$0.00</span></div><button type="submit">Subscribe</button></section></main>`);
      return;
    }
    response.end(`<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main><button type="button" aria-label="Upgrade">Upgrade</button><section role="dialog" hidden><button type="button">Upgrade to Plus</button></section><script>document.querySelector('[aria-label=Upgrade]').onclick=()=>{document.querySelector('[role=dialog]').hidden=false};document.querySelector('[role=dialog] button').onclick=()=>location.assign('/checkout/fixture');</script>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await mkdtemp(join(tmpdir(), 'browser-upstream-card-fill-'));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const dispatchStore = await new FileDispatchStore({ filePath: join(dir, 'dispatch.json'), leaseMs: 5_000 }).init();
    const evidenceSink = new MemoryEvidenceSink();
    const executionService = new BrowserExecutionService({
      runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
      evidenceSink,
      timeoutMs: 2_000,
    });
    const providerCalls = [];
    const cardMaterialSource = new HnskjCardMaterialSource({
      provider: {
        card: async (providerCardRef) => {
          providerCalls.push(providerCardRef);
          return { data: { card: { cardNumber: '4111111111111111', expiryMonth: 12, expiryYear: 2030, cvv: '123' } } };
        },
      },
    });
    const cardMaterialLeaseProvider = await new DurableCardMaterialLeaseProvider({
      filePath: join(dir, 'card-leases.json'),
      source: cardMaterialSource,
    }).init();
    const result = await runFrontloadedNonPaymentIntegration({
      projection: projection({
        observation: {
          pageContract: {
            urlPrefix: `${base}/`,
            title: 'Browser MVP fixture',
            requiredSelector: '[data-browser-mvp-marker]',
            markerText: 'observe-only',
          },
          checkoutNavigationContract: {
            ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
            homeUrlPrefix: `${base}/`,
            checkoutUrlPrefix: `${base}/checkout/`,
            openPricingSelectors: ['button[aria-label="Upgrade"]'],
            upgradeLabels: ['Upgrade to Plus'],
            questionnaireSkipLabels: ['Skip'],
            checkoutReadySelector: '[data-testid="checkout-page-content"]',
          },
          checkoutContract: { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, urlPrefix: `${base}/checkout/`, secureFieldTimeoutMs: 500 },
        },
      }),
      dispatchStore,
      executionService,
      cardMaterialLeaseProvider,
      materialRef: 'provider-card:0001',
      fillCardFields: true,
      now,
    });
    assert.deepEqual(result.result.cardFill, {
      status: 'FILLED_AND_CLEARED',
      fieldsFilled: 3,
      fieldsCleared: 3,
      submitCalls: 0,
      paymentClicked: false,
    });
    assert.equal(result.result.submitCalls, 0);
    assert.deepEqual(providerCalls, ['provider-card:0001']);
    assert.equal(Object.values(cardMaterialLeaseProvider.snapshot().leases)[0].state, 'RELEASED');
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.close();
    await once(server, 'close');
  }
});
