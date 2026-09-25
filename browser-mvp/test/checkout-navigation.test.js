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
            <div><span>Monthly subscription</span><span>₱982.14</span></div>
            <div><span>VAT (0%)</span><span>₱0.00</span></div>
            <div><span>Due today</span><span>₱982.14</span></div>
            <button type="submit" aria-label="Subscribe">Subscribe</button>
          </section>
        </main>
      `);
      return;
    }
    if (request.url === '/api/auth/session') {
      response.end(JSON.stringify({
        user: { id: 'user-fixture', email: 'buyer@example.test' },
        account: { id: 'account-fixture' },
        accessToken: 'fixture-access-token',
      }));
      return;
    }
    if (request.url?.startsWith('/backend-api/accounts/check/')) {
      response.end(JSON.stringify({
        accounts: { default: { entitlement: { has_active_subscription: false, subscription_plan: 'free' } } },
      }));
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
      sessionIdentity: { email: 'buyer@example.test', accountId: 'account-fixture' },
      accountProbeContract: {
        accountCheckPath: '/backend-api/accounts/check/v4-fixture',
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
    assert.equal(result.checkout.currency, 'PHP');
    assert.equal(result.checkout.amount, '982.14');
    assert.equal(result.checkout.submitCalls, 0);
    assert.equal(result.submitCalls, 0);
    assert.deepEqual(result.readonlyChecklist, {
      loggedIn: true,
      identityMatched: true,
      alreadyPlus: false,
      plusEntryPresent: true,
      checkoutRecognized: true,
      fieldsWritten: 0,
      submitCalls: 0,
    });
    assert.equal(submitted, 0);
    assert.deepEqual(evidenceSink.events.map((event) => event.summary.action), [
      'observe-page', 'account-readonly-probe', 'page-signature', 'checkout-navigation',
      // 每单都记：Stripe Link 有没有接管支付区、有没有切到新卡（D-202）。
      // 上一版没留证，2026-09-13 整天查不出这一步到底做没做、成没成。
      'saved-payment-method',
    ]);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('readonly harness stops an already-Plus account before opening the purchase entry', async () => {
  let pricingClicks = 0;
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': request.url?.startsWith('/api/')
      || request.url?.startsWith('/backend-api/') ? 'application/json' : 'text/html' });
    if (request.url === '/api/auth/session') {
      response.end(JSON.stringify({
        user: { email: 'plus@example.test' }, accessToken: 'fixture-token',
      }));
      return;
    }
    if (request.url?.startsWith('/backend-api/accounts/check/')) {
      response.end(JSON.stringify({
        accounts: { default: { entitlement: { has_active_subscription: true, subscription_plan: 'plus' } } },
      }));
      return;
    }
    response.end(`
      <title>Plus fixture</title><main data-browser-mvp-marker>observe-only</main>
      <button type="button" aria-label="Upgrade" onclick="fetch('/pricing-click')">Upgrade</button>
    `);
    if (request.url === '/pricing-click') pricingClicks += 1;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const executor = new BrowserExecutionService({
    runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
    evidenceSink: new MemoryEvidenceSink(),
    timeoutMs: 2_000,
  });
  const job = createSyntheticJob({
    state: 'RUNNING',
    metadata: {
      pageContract: {
        urlPrefix: `${base}/`, title: 'Plus fixture',
        requiredSelector: '[data-browser-mvp-marker]', markerText: 'observe-only',
      },
      sessionIdentity: { email: 'plus@example.test' },
      accountProbeContract: { accountCheckPath: '/backend-api/accounts/check/v4-fixture' },
      checkoutNavigationContract: {
        ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
        homeUrlPrefix: `${base}/`, checkoutUrlPrefix: `${base}/checkout/`,
        openPricingSelectors: ['button[aria-label="Upgrade"]'],
      },
      checkoutContract: { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, urlPrefix: `${base}/checkout/` },
    },
  });
  try {
    await assert.rejects(
      () => executor.execute(job, { assertLease: async () => true }),
      (error) => error instanceof Error && error.reason === 'ACCOUNT_ALREADY_PLUS',
    );
    assert.equal(pricingClicks, 0);
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

test('Checkout navigator opens the live-style Profile menu before Upgrade and remains observe-only', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div role="button" tabindex="0" data-testid="accounts-profile-button" style="pointer-events:none">Covered profile</div>
      <div role="button" tabindex="0" data-testid="accounts-profile-button" onclick="document.querySelector('#menu').hidden=false">Profile</div>
      <div id="menu" hidden>
        <button type="button" aria-label="Upgrade" onclick="document.querySelector('[role=dialog]').hidden=false">Upgrade</button>
      </div>
      <section role="dialog" hidden>
        <button type="button" id="upgrade-plus" onclick="document.querySelector('[data-testid=checkout-page-content]').hidden=false">Upgrade to Plus</button>
      </section>
      <main data-testid="checkout-page-content" hidden><span>Checkout ready</span></main>
    `);
    const result = await navigateToChatGPTPlusCheckout(page, {
      ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
      homeUrlPrefix: 'about:blank',
      checkoutUrlPrefix: 'about:blank',
      openPricingSelectors: ['button[data-direct-upgrade]'],
      profileMenuSelectors: ['[data-testid="accounts-profile-button"]'],
      profileUpgradeSelectors: ['button[aria-label="Upgrade"]'],
      upgradeLabels: ['Upgrade to Plus'],
    }, { timeoutMs: 2_000 });
    assert.deepEqual(result.actions, ['profile-menu-opened', 'pricing-opened', 'upgrade-requested']);
    assert.equal(result.submitCalls, 0);
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

test('navigator skips the covered header control when the plan picker is already open', async () => {
  const html = `<title>ChatGPT Plans</title>
    <button type="button" aria-label="Upgrade" onclick="document.body.dataset.headerClicked='1'">Upgrade</button>
    <section role="dialog"><p>See what’s new</p></section>
    <section role="dialog">
      <button type="button" disabled>Your current plan</button>
      <button type="button" id="upgrade-plus" onclick="document.querySelector('[data-testid=checkout-page-content]').hidden=false; history.replaceState(null, '', '/checkout/oaics_new')">Rejoin Plus</button>
    </section>
    <main data-testid="checkout-page-content" hidden>checkout</main>`;
  const { navigateToChatGPTPlusCheckout, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } = await import('../src/chatgpt-checkout-navigator.js');
  const { chromium } = await import('playwright');
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${base}#pricing`, { waitUntil: 'domcontentloaded' });
    const result = await navigateToChatGPTPlusCheckout(page, {
      ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/`,
    }, { timeoutMs: 5_000 });
    assert.deepEqual(result.actions, ['pricing-already-open', 'upgrade-requested']);
    assert.equal(result.checkoutCreated, true);
    assert.equal(await page.evaluate(() => document.body.dataset.headerClicked || null), null, 'header control must not be clicked behind the modal');
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

test('navigator reports a session-expired overlay as SESSION_INVALID instead of navigation drift', async () => {
  const html = `<title>ChatGPT Plans</title>
    <section role="dialog"><button type="button" disabled>Your current plan</button><button type="button">Rejoin Plus</button></section>
    <div role="dialog" style="position:fixed;inset:0;background:#fff">Your session has expired. Please log in again to continue using ChatGPT.</div>`;
  const { navigateToChatGPTPlusCheckout, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } = await import('../src/chatgpt-checkout-navigator.js');
  const { chromium } = await import('playwright');
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${base}#pricing`, { waitUntil: 'domcontentloaded' });
    await assert.rejects(
      () => navigateToChatGPTPlusCheckout(page, { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` }, { timeoutMs: 3_000 }),
      (error) => error.code === 'SESSION_INVALID',
    );
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

test('navigator selects the Pro tier before pressing Upgrade to Pro, and refuses unknown plans', async () => {
  const html = `<title>ChatGPT Plans</title>
    <section role="dialog">
      <button type="button" disabled>Your current plan</button>
      <button type="button">Rejoin Plus</button>
      <button type="button" id="tier-5x" aria-pressed="true" onclick="document.body.dataset.tier='5x'">5x</button>
      <button type="button" id="tier-20x" aria-pressed="false" onclick="document.body.dataset.tier='20x'">20x</button>
      <button type="button" id="upgrade-pro" onclick="document.body.dataset.upgraded=document.body.dataset.tier; document.querySelector('[data-testid=checkout-page-content]').hidden=false; history.replaceState(null, '', '/checkout/oaics_pro')">Upgrade to Pro</button>
    </section>
    <main data-testid="checkout-page-content" hidden>checkout</main>`;
  const { navigateToChatGPTCheckout, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, resolvePlanSpec } = await import('../src/chatgpt-checkout-navigator.js');
  assert.deepEqual(resolvePlanSpec(CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, 'pro_20x').tierLabels, ['20x']);
  assert.throws(() => resolvePlanSpec(CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, 'team'), /no plan spec/);
  const { chromium } = await import('playwright');
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${base}#pricing`, { waitUntil: 'domcontentloaded' });
    const result = await navigateToChatGPTCheckout(page, { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` }, { timeoutMs: 5_000, plan: 'pro_20x' });
    assert.equal(result.plan, 'pro_20x');
    assert.deepEqual(result.actions, ['pricing-already-open', 'tier-selected:20x', 'upgrade-requested']);
    assert.equal(await page.evaluate(() => document.body.dataset.upgraded), '20x');
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

test('navigator can stop on the Confirm plan changes dialog of a subscribed account and never presses Pay now', async () => {
  const html = `<title>ChatGPT Plans</title>
    <section role="dialog" id="picker">
      <button type="button" disabled>Your current plan</button>
      <button type="button" id="tier-5x" aria-pressed="true" onclick="document.body.dataset.tier='5x'">5x</button>
      <button type="button" id="tier-20x" aria-pressed="false" onclick="document.body.dataset.tier='20x'">20x</button>
      <button type="button" id="upgrade-pro" onclick="document.body.dataset.upgraded=document.body.dataset.tier; document.getElementById('confirm').hidden=false; setTimeout(() => document.getElementById('late').hidden=false, 700)">Upgrade to Pro</button>
    </section>
    <section role="dialog" id="confirm" hidden>
      <h2>Confirm plan changes</h2>
      <div id="late" hidden>
      <p>ChatGPT Pro subscription</p><p>₱8,919.64</p>
      <p>Billed monthly, starting today</p>
      <p>Adjustment</p><p>-₱973.87</p>
      <p>Prorated credit for the remainder of your Plus subscription</p>
      <p>Total due today</p><p>₱7,945.77</p>
      <p>Payment method</p><p>VISA *5980</p>
      <button type="button" id="cancel" onclick="document.getElementById('confirm').hidden=true">Cancel</button>
      <button type="button" id="pay" onclick="document.body.dataset.paid='yes'">Pay now</button>
      </div>
    </section>`;
  const { navigateToChatGPTCheckout, cancelPlanChangeDialog, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } = await import('../src/chatgpt-checkout-navigator.js');
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${base}#pricing`, { waitUntil: 'domcontentloaded' });
    const contract = { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` };
    await assert.rejects(() => navigateToChatGPTCheckout(page, contract, { plan: 'pro_20x', expect: 'pay' }), /expect must be/);
    const result = await navigateToChatGPTCheckout(page, contract, { timeoutMs: 5_000, plan: 'pro_20x', expect: 'plan-change' });
    assert.equal(result.state, 'plan-change');
    assert.equal(result.checkoutCreated, false);
    assert.deepEqual(result.actions, ['pricing-already-open', 'tier-selected:20x', 'upgrade-requested']);
    assert.deepEqual(result.planChange, {
      title: 'Confirm plan changes', subscriptionLine: 'ChatGPT Pro subscription', subscriptionAmount: '₱8,919.64',
      adjustmentAmount: '-₱973.87', totalDueToday: '₱7,945.77', paymentMethod: { brand: 'VISA', last4: '5980' },
      payButtonPresent: true, cancelButtonPresent: true, lineCount: 12,
    });
    assert.equal(await page.evaluate(() => document.body.dataset.paid), undefined);
    assert.deepEqual(await cancelPlanChangeDialog(page, contract, { timeoutMs: 5_000 }), { cancelled: true });
    assert.equal(await page.evaluate(() => document.getElementById('confirm').hidden), true);
    assert.equal(await page.evaluate(() => document.body.dataset.paid), undefined);
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

test('plan-change navigation recognises a fresh Pro Checkout opening in a new tab and stops without touching Subscribe', async () => {
  const picker = (base) => `<title>ChatGPT Plans</title>
    <section role="dialog">
      <button type="button" disabled>Your current plan</button>
      <button type="button" aria-pressed="true">5x</button>
      <button type="button" aria-pressed="false" onclick="document.body.dataset.tier='20x'">20x</button>
      <button type="button" onclick="window.open('${base}checkout/openai_llc/oaics_fixture', '_blank')">Upgrade to Pro</button>
    </section>`;
  const checkout = `<title>ChatGPT</title><main data-testid="checkout-page-content">
    <button type="button">5x more usage than Plus ₱6,490/month</button><button type="button">20x more usage than Plus ₱9,990/month</button>
    <button type="button" onclick="document.body.dataset.subscribed='yes'">Subscribe</button></main>`;
  let base;
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url.startsWith('/checkout/') ? checkout : picker(base));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/`;
  const { navigateToChatGPTCheckout } = await import('../src/chatgpt-checkout-navigator.js');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}#pricing`, { waitUntil: 'domcontentloaded' });
    const contract = { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` };
    const result = await navigateToChatGPTCheckout(page, contract, { timeoutMs: 5_000, plan: 'pro_20x', expect: 'plan-change' });
    assert.equal(result.state, 'checkout-popup');
    assert.deepEqual(result.actions, ['pricing-already-open', 'tier-selected:20x', 'upgrade-requested']);
    assert.deepEqual(result.checkoutInsteadOfDialog.tierLabels, ['5x more usage than Plus ₱6,490/month', '20x more usage than Plus ₱9,990/month']);
    assert.equal(result.checkoutInsteadOfDialog.subscribePresent, true);
    assert.equal(result.checkoutInsteadOfDialog.payButtonPresent, false);
    const popup = context.pages().find((candidate) => candidate.url().includes('/checkout/'));
    assert.equal(await popup.evaluate(() => document.body.dataset.subscribed), undefined);
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});


// 块 6（D-372）：2026-09-24 实测一次点页头「Upgrade」直接落在结账页、没经过选档。Pro 单此时必须付款前停下；Plus 照旧。
test('a Pro order that lands on Checkout without selecting its tier stops before payment; Plus is unchanged', async () => {
  const html = `<title>ChatGPT</title>
    <button type="button" aria-label="Upgrade" onclick="document.querySelector('[data-testid=checkout-page-content]').hidden=false; history.replaceState(null, '', '/checkout/openai_llc/oaics_direct')">Upgrade</button>
    <main data-testid="checkout-page-content" hidden><button type="button" onclick="document.body.dataset.subscribed='yes'">Subscribe</button></main>`;
  const { navigateToChatGPTCheckout } = await import('../src/chatgpt-checkout-navigator.js');
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const contract = { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const expect of ['checkout', 'plan-change']) {
      const page = await browser.newPage();
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await assert.rejects(
        navigateToChatGPTCheckout(page, contract, { timeoutMs: 5_000, plan: 'pro_5x', expect }),
        (error) => error instanceof ContractError && /pro_5x checkout was reached without selecting its tier/.test(error.message),
      );
      assert.equal(await page.evaluate(() => document.body.dataset.subscribed), undefined);
      await page.close();
    }
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const plus = await navigateToChatGPTCheckout(page, contract, { timeoutMs: 5_000, plan: 'plus' });
    assert.equal(plus.state, 'checkout');
    assert.deepEqual(plus.actions, ['pricing-opened']);
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

// 块 6（D-373）：落地的结账页上恰好一个选中档位、value 是该套餐结账名、文字以档位开头 → 放行。
// 夹具照 2026-09-25 真实 5x 结账页只读核对的结构：button[role=radio][value][aria-checked] + 隐藏 input[type=radio]。
test('a Pro order that lands on Checkout proceeds only when the page itself shows its tier checked', async () => {
  const checkout = ({ checked, value5x = 'chatgptprolite', label5x = '5x more usage than Plus ₱6,490/month' }) => `<title>ChatGPT</title>
    <button type="button" aria-label="Upgrade" onclick="document.querySelector('[data-testid=checkout-page-content]').hidden=false; history.replaceState(null, '', '/checkout/openai_llc/oaics_resumed')">Upgrade</button>
    <main data-testid="checkout-page-content" hidden>
      <button type="button" role="radio" value="${value5x}" aria-checked="${checked === '5x'}" data-state="${checked === '5x' ? 'checked' : 'unchecked'}">${label5x}</button>
      <input type="radio" value="${value5x}" ${checked === '5x' ? 'checked' : ''} hidden>
      <button type="button" role="radio" value="chatgptpro" aria-checked="${checked === '20x'}" ${checked === '20x' ? '' : 'disabled'}>20x more usage than Plus ₱9,990/month</button>
      <input type="radio" value="chatgptpro" ${checked === '20x' ? 'checked' : ''} hidden>
      <button type="button" onclick="document.body.dataset.subscribed='yes'">Subscribe</button>
    </main>`;
  const { navigateToChatGPTCheckout } = await import('../src/chatgpt-checkout-navigator.js');
  let html = '';
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const contract = { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` };
  const browser = await chromium.launch({ headless: true });
  const run = async (page, plan) => navigateToChatGPTCheckout(page, contract, { timeoutMs: 3_000, plan });
  try {
    html = checkout({ checked: '5x' });
    let page = await browser.newPage(); await page.goto(base, { waitUntil: 'domcontentloaded' });
    const ok = await run(page, 'pro_5x');
    assert.deepEqual(ok.actions, ['pricing-opened', 'tier-verified-on-checkout:5x']);
    assert.equal(await page.evaluate(() => document.body.dataset.subscribed), undefined);
    await page.close();
    for (const [variant, plan] of [[{ checked: '20x' }, 'pro_5x'], [{ checked: '5x', value5x: 'chatgptplusplan' }, 'pro_5x'],
      [{ checked: '5x', label5x: '20x more usage than Plus' }, 'pro_5x'], [{ checked: 'none' }, 'pro_5x'], [{ checked: '5x' }, 'pro_20x']]) {
      html = checkout(variant);
      page = await browser.newPage(); await page.goto(base, { waitUntil: 'domcontentloaded' });
      await assert.rejects(run(page, plan), (error) => error instanceof ContractError && /without selecting its tier/.test(error.message), JSON.stringify({ variant, plan }));
      await page.close();
    }
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

// D-374：真实页面时间线（2026-09-25 Lane 3）：页头「Upgrade」在 domcontentloaded 后约 1.8 秒才出现；
// 号上有未付结账单时，#pricing 不弹定价框、约十几秒后自己跳到那张结账页。
test('navigator waits for a late header entry instead of falling back on the first empty read', async () => {
  const html = `<title>ChatGPT</title>
    <script>setTimeout(() => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Upgrade'); b.textContent = 'Upgrade';
      b.onclick = () => { document.getElementById('picker').hidden = false; }; document.body.prepend(b); }, 1500);</script>
    <section role="dialog" id="picker" hidden><button type="button" disabled>Your current plan</button>
      <button type="button" onclick="document.querySelector('[data-testid=checkout-page-content]').hidden=false; history.replaceState(null, '', '/checkout/oaics_new')">Rejoin Plus</button></section>
    <main data-testid="checkout-page-content" hidden>checkout</main>`;
  const { navigateToChatGPTCheckout } = await import('../src/chatgpt-checkout-navigator.js');
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const result = await navigateToChatGPTCheckout(page, { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` }, { timeoutMs: 5_000, plan: 'plus' });
    assert.deepEqual(result.actions, ['pricing-opened', 'upgrade-requested']);
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

test('navigator recognises #pricing taking the page to an unpaid Checkout, then lets the tier check decide', async () => {
  const page5x = (checked) => `<title>ChatGPT</title>
    <script>addEventListener('hashchange', () => { if (location.hash === '#pricing') setTimeout(() => {
      document.querySelector('[data-testid=checkout-page-content]').hidden = false; history.replaceState(null, '', '/checkout/openai_llc/oaics_unpaid'); }, 1200); });</script>
    <main data-testid="checkout-page-content" hidden>
      <button type="button" role="radio" value="chatgptprolite" aria-checked="${checked === '5x'}">5x more usage than Plus ₱6,490/month</button>
      <button type="button" role="radio" value="chatgptpro" aria-checked="${checked === '20x'}">20x more usage than Plus ₱9,990/month</button>
      <button type="button" onclick="document.body.dataset.subscribed='yes'">Subscribe</button></main>`;
  const { navigateToChatGPTCheckout } = await import('../src/chatgpt-checkout-navigator.js');
  let html = '';
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const contract = { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: base, checkoutUrlPrefix: `${base}checkout/` };
  const browser = await chromium.launch({ headless: true });
  try {
    html = page5x('5x');
    let page = await browser.newPage(); await page.goto(base, { waitUntil: 'domcontentloaded' });
    const ok = await navigateToChatGPTCheckout(page, contract, { timeoutMs: 3_000, plan: 'pro_5x' });
    assert.deepEqual(ok.actions, ['landed-on-checkout', 'tier-verified-on-checkout:5x']);
    assert.equal(await page.evaluate(() => document.body.dataset.subscribed), undefined);
    await page.close();
    html = page5x('20x');
    page = await browser.newPage(); await page.goto(base, { waitUntil: 'domcontentloaded' });
    await assert.rejects(navigateToChatGPTCheckout(page, contract, { timeoutMs: 3_000, plan: 'pro_5x' }), /without selecting its tier/);
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

// D-375：导航失败时，fail-closed 事件带清洗过的报错首行与已走步骤（以前只有原因码，09-12～09-14 的失败查不回来）。
test('a navigation failure records its cleaned first line and the steps taken on the fail-closed event', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/api/auth/session') {
      response.end(JSON.stringify({ user: { id: 'user-fixture', email: 'buyer@example.test' }, account: { id: 'account-fixture' }, accessToken: 'fixture-access-token' }));
      return;
    }
    if (request.url?.startsWith('/backend-api/accounts/check/')) {
      response.end(JSON.stringify({ accounts: { default: { entitlement: { has_active_subscription: false, subscription_plan: 'free' } } } }));
      return;
    }
    response.end(`<title>Navigator fixture</title><main data-browser-mvp-marker>observe-only</main>
      <button type="button" aria-label="Upgrade" onclick="document.querySelector('[role=dialog]').hidden=false">Upgrade</button>
      <section role="dialog" hidden><button type="button">Upgrade to Pro</button></section>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const evidenceSink = new MemoryEvidenceSink();
  const executor = new BrowserExecutionService({ runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }), evidenceSink, timeoutMs: 3_000 });
  const job = createSyntheticJob({
    state: 'RUNNING',
    metadata: {
      pageContract: { urlPrefix: `${base}/`, title: 'Navigator fixture', requiredSelector: '[data-browser-mvp-marker]', markerText: 'observe-only' },
      sessionIdentity: { email: 'buyer@example.test', accountId: 'account-fixture' },
      accountProbeContract: { accountCheckPath: '/backend-api/accounts/check/v4-fixture' },
      checkoutNavigationContract: { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: `${base}/`, checkoutUrlPrefix: `${base}/checkout/`, openPricingSelectors: ['button[aria-label="Upgrade"]'] },
      checkoutContract: { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, urlPrefix: `${base}/checkout/` },
    },
  });
  try {
    await assert.rejects(executor.execute(job, { assertLease: async () => true }), (error) => error.reason === 'CHECKOUT_NAVIGATION_FAILED');
    const closed = evidenceSink.events.at(-1).summary;
    assert.equal(closed.action, 'fail-closed');
    assert.equal(closed.reason, 'CHECKOUT_NAVIGATION_FAILED');
    assert.match(closed.navigationError, /upgrade control/);
    assert.deepEqual(closed.navigationActions, ['pricing-opened']);
    assert.ok(!/fixture-access-token|buyer@example/.test(JSON.stringify(closed)));
  } finally { server.close(); await once(server, 'close'); }
});

test('navigation failure text keeps only a cleaned first line: origin-only URLs, no tokens, no long digit runs', async () => {
  const { navigationFailureDetail } = await import('../src/executor.js');
  const error = Object.assign(new Error([
    'x click failed at https://chatgpt.com/checkout/openai_llc/cs_live_abcdefghijklmnopqrstuvwxyz0123456789?session=1',
    'Call log:', '  - <input value="4111 1111 1111 1111">',
  ].join('\n')), { navigationActions: ['pricing-opened', 'tier-selected:5x', '<img src=x>', 'a'.repeat(80)] });
  assert.deepEqual(navigationFailureDetail(error), {
    navigationError: 'x click failed at https://chatgpt.com', navigationActions: ['pricing-opened', 'tier-selected:5x'],
  });
  assert.equal(navigationFailureDetail(new Error('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig card 4111-1111-1111-1111 after 45000ms')).navigationError,
    'token [token] card [digits] after 45000ms');
  assert.equal(navigationFailureDetail(new Error('y'.repeat(300))).navigationError.length <= 200, true);
  assert.deepEqual(navigationFailureDetail(new Error('')), {});
});
