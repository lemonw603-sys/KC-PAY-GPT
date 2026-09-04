import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

import {
  installOfficialCheckoutRegionRewrite,
  rewriteOfficialCheckoutBody,
} from '../src/checkout-request-rewrite.js';

test('rewrites only official Checkout billing country and currency', () => {
  const original = {
    entry_point: 'all_plans_pricing_modal',
    plan_name: 'chatgptplusplan',
    billing_details: { country: 'US', currency: 'USD', keep: 'yes' },
    checkout_ui_mode: 'custom',
    preserved: { value: 7 },
  };
  const rewritten = JSON.parse(rewriteOfficialCheckoutBody(JSON.stringify(original), { country: 'PH', currency: 'PHP' }));
  assert.deepEqual(rewritten, {
    ...original,
    billing_details: { country: 'PH', currency: 'PHP', keep: 'yes' },
  });
});

test('preserves official headers, changes body once, and blocks a second upstream request', async () => {
  const received = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<title>fixture</title>');
      return;
    }
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push({ headers: request.headers, body: JSON.parse(body) });
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
  const rewrite = await installOfficialCheckoutRegionRewrite(page, { country: 'PH', currency: 'PHP' });
  const request = () => page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture',
        'content-type': 'application/json',
        'openai-sentinel-token': 'sentinel-fixture',
        'oai-device-id': 'device-fixture',
        'x-openai-target-path': '/payments/checkout',
        'x-openai-target-route': 'payments-checkout',
      },
      body: JSON.stringify({
        entry_point: 'all_plans_pricing_modal', plan_name: 'chatgptplusplan',
        billing_details: { country: 'US', currency: 'USD' }, checkout_ui_mode: 'custom',
      }),
    });
    return response.status;
  }, `${base}/backend-api/payments/checkout`);
  try {
    assert.equal(await request(), 200);
    await assert.rejects(request);
    assert.equal(received.length, 1);
    assert.equal(received[0].body.billing_details.country, 'PH');
    assert.equal(received[0].body.billing_details.currency, 'PHP');
    assert.equal(received[0].headers['openai-sentinel-token'], 'sentinel-fixture');
    assert.deepEqual(rewrite.snapshot(), {
      interceptedRequests: 2, upstreamRequests: 1, extraRequestsAborted: 1,
      rewrittenCountry: 'PH', rewrittenCurrency: 'PHP',
      officialHeaders: {
        bearerHeaderPresent: true, sentinelHeaderPresent: true, deviceHeaderPresent: true,
        targetPathHeaderPresent: true, targetRouteHeaderPresent: true,
      },
    });
  } finally {
    await rewrite.dispose();
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});
