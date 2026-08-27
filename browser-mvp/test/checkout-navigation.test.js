import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, navigateToChatGPTPlusCheckout } from '../src/chatgpt-checkout-navigator.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT } from '../src/checkout-observer.js';
import { ContractError } from '../src/contracts.js';
import { BrowserExecutionService } from '../src/executor.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createSyntheticJob } from '../src/fixtures.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';

test('executor navigates an optional questionnaire to Checkout and remains observe-only', async () => {
  let submitted = 0;
  const server = createServer((request, response) => {
    if (request.url === '/submitted') {
      submitted += 1;
      response.writeHead(500);
      response.end('submit must not happen');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url?.startsWith('/checkout/')) {
      response.end(`
        <title>Checkout fixture</title>
        <main data-testid="checkout-page-content">
          <form data-testid="checkout-form" action="/submitted" method="post"><iframe srcdoc='
            <input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">
          '></iframe></form>
          <section data-testid="checkout-summary-column">
            <h2>Plus plan</h2>
            <div><span>Estimated tax</span><span>US$0.00</span></div>
            <div><span>Total due today</span><span>US$20.00</span></div>
            <button type="submit" aria-label="Subscribe">Subscribe</button>
          </section>
        </main>
      `);
      return;
    }
    response.end(`
      <title>Navigator fixture</title>
      <main data-browser-mvp-marker>observe-only</main>
      <button type="button" aria-label="Upgrade" onclick="document.querySelector('[role=dialog]').hidden=false; document.querySelector('#questionnaire').hidden=false">Upgrade</button>
      <section role="dialog" hidden>
        <button type="button" id="upgrade-plus">Upgrade to Plus</button>
        <div id="questionnaire" hidden><button type="button">Skip</button></div>
      </section>
      <script>
        let attempted = false;
        document.querySelector('#upgrade-plus').addEventListener('click', () => {
          if (!attempted) {
            attempted = true;
            document.querySelector('#questionnaire').hidden = false;
            return;
          }
          location.assign('/checkout/session-fixture');
        });
        document.querySelector('#questionnaire button').addEventListener('click', () => {
          document.querySelector('#questionnaire').hidden = true;
        });
      </script>
    `);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
  const evidenceSink = new MemoryEvidenceSink();
  const executor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, timeoutMs: 5_000 });
  const navigationContract = {
    ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
    homeUrlPrefix: `${base}/`,
    checkoutUrlPrefix: `${base}/checkout/`,
    openPricingSelectors: ['button[aria-label="Upgrade"]'],
    upgradeLabels: ['Upgrade to Plus'],
    questionnaireSkipLabels: ['Skip'],
  };
  const job = createSyntheticJob({
    state: 'RUNNING',
    metadata: {
      pageContract: {
        urlPrefix: `${base}/`,
        title: 'Navigator fixture',
        requiredSelector: '[data-browser-mvp-marker]',
        markerText: 'observe-only',
      },
      checkoutNavigationContract: navigationContract,
      checkoutContract: { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, urlPrefix: `${base}/checkout/` },
    },
  });
  try {
    const result = await executor.execute(job, { assertLease: async () => true });
    assert.equal(result.checkoutNavigation.checkoutCreated, true);
    assert.equal(result.checkoutNavigation.questionnaireSkipped, true);
    assert.deepEqual(result.checkoutNavigation.actions, ['pricing-opened', 'questionnaire-skipped', 'upgrade-requested', 'questionnaire-skipped', 'upgrade-requested']);
    assert.equal(result.checkout.currency, 'USD');
    assert.equal(result.checkout.amount, '20.00');
    assert.equal(result.checkout.submitCalls, 0);
    assert.equal(result.submitCalls, 0);
    assert.equal(submitted, 0);
    assert.deepEqual(evidenceSink.events.map((event) => event.summary.action), ['observe-page', 'page-signature', 'checkout-navigation']);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Checkout navigator rejects any navigation control that could submit a form', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form onsubmit="window.submits=(window.submits||0)+1; return false">
        <button type="submit" aria-label="Upgrade">Upgrade</button>
      </form>
    `);
    await assert.rejects(
      () => navigateToChatGPTPlusCheckout(page, {
        ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
        homeUrlPrefix: 'about:blank',
        checkoutUrlPrefix: 'https://example.test/checkout/',
        openPricingSelectors: ['button[aria-label="Upgrade"]'],
      }, { timeoutMs: 500 }),
      /may submit a form/,
    );
    assert.equal(await page.evaluate(() => window.submits || 0), 0);
  } finally {
    await browser.close();
  }
});

test('executor refuses Checkout navigation without a read-only observer contract', async () => {
  let opened = false;
  const executor = new BrowserExecutionService({
    runtimeAdapter: {
      open: async () => { opened = true; },
      close: async () => undefined,
    },
    evidenceSink: new MemoryEvidenceSink(),
  });
  const job = createSyntheticJob({
    state: 'RUNNING',
    metadata: {
      pageContract: {
        urlPrefix: 'https://example.test/',
        title: 'fixture',
        requiredSelector: 'main',
        markerText: 'fixture',
      },
      checkoutNavigationContract: CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
    },
  });
  await assert.rejects(() => executor.execute(job, { assertLease: async () => true }), ContractError);
  assert.equal(opened, false);
});
