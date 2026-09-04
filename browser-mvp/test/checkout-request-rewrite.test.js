import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

import { installOfficialPricingRegionSelection } from '../src/checkout-request-rewrite.js';

test('selects PH pricing before the official request is built and never mutates its POST', async () => {
  const received = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<title>fixture</title>');
      return;
    }
    if (request.method === 'GET' && request.url === '/backend-api/checkout_pricing_config/configs/PH') {
      received.push({ kind: 'pricing', url: request.url });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ country_code: 'PH', currency: 'PHP' }));
      return;
    }
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push({ kind: 'checkout', headers: request.headers, body: JSON.parse(body) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  const selection = await installOfficialPricingRegionSelection(page, { country: 'PH', currency: 'PHP' });
  const headers = {
    authorization: 'Bearer fixture', 'content-type': 'application/json',
    'openai-sentinel-token': 'sentinel-fixture', 'oai-device-id': 'device-fixture',
    'x-openai-target-path': '/payments/checkout', 'x-openai-target-route': 'payments-checkout',
  };
  const postBody = {
    entry_point: 'all_plans_pricing_modal', plan_name: 'chatgptplusplan',
    billing_details: { country: 'PH', currency: 'PHP' }, checkout_ui_mode: 'custom', preserved: 7,
  };
  try {
    const pricing = await page.evaluate((url) => fetch(url).then((response) => response.json()),
      `${base}/backend-api/checkout_pricing_config/configs/US`);
    assert.deepEqual(pricing, { country_code: 'PH', currency: 'PHP' });
    assert.equal(await page.evaluate(async ({ url, headers: requestHeaders, body }) => {
      const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
      return response.status;
    }, { url: `${base}/backend-api/payments/checkout`, headers, body: postBody }), 200);
    await assert.rejects(page.evaluate(async ({ url, headers: requestHeaders, body }) => {
      await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
    }, { url: `${base}/backend-api/payments/checkout`, headers, body: postBody }));
    assert.deepEqual(received.map(({ kind }) => kind), ['pricing', 'checkout']);
    assert.deepEqual(received[1].body, postBody);
    assert.equal(received[1].headers['openai-sentinel-token'], 'sentinel-fixture');
    assert.deepEqual(selection.snapshot(), {
      pricingRequestsRewritten: 1, checkoutRequestsIntercepted: 2,
      upstreamCheckoutRequests: 1, checkoutRequestsAborted: 1,
      selectedCountry: 'PH', selectedCurrency: 'PHP',
      officialHeaders: {
        bearerHeaderPresent: true, sentinelHeaderPresent: true, deviceHeaderPresent: true,
        targetPathHeaderPresent: true, targetRouteHeaderPresent: true,
      },
    });
  } finally {
    await selection.dispose();
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('blocks Checkout when the official frontend did not build the selected region', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const selection = await installOfficialPricingRegionSelection(page, { country: 'PH', currency: 'PHP' });
  try {
    await assert.rejects(page.evaluate(async () => {
      await fetch('https://example.test/backend-api/payments/checkout', {
        method: 'POST', headers: {
          authorization: 'Bearer fixture', 'content-type': 'application/json',
          'openai-sentinel-token': 'sentinel', 'oai-device-id': 'device',
          'x-openai-target-path': 'path', 'x-openai-target-route': 'route',
        },
        body: JSON.stringify({
          plan_name: 'chatgptplusplan', checkout_ui_mode: 'custom',
          billing_details: { country: 'US', currency: 'USD' },
        }),
      });
    }));
    assert.equal(selection.snapshot().upstreamCheckoutRequests, 0);
    assert.equal(selection.snapshot().checkoutRequestsAborted, 1);
  } finally {
    await selection.dispose();
    await browser.close();
  }
});
