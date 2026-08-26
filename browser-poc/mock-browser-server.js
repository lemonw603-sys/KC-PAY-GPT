'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { MockPaymentGateway } = require('./mock-gateway');
const { ContractError } = require('./experiment-core');

function html(body, script = '') {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser executor local mock</title>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

function jsonResponse(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
    });
    response.end(JSON.stringify(payload));
}

function htmlResponse(response, payload) {
    response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN'
    });
    response.end(payload);
}

async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}

function accountPage({ runId, scenario, popup, variant }) {
    const checkoutHref = `/checkout?runId=${encodeURIComponent(runId)}&scenario=${encodeURIComponent(scenario)}&variant=${encodeURIComponent(variant)}`;
    return html(`
<main>
  <h1>Synthetic Free account</h1>
  <dl>
    <dt>Account</dt><dd data-testid="account-identity">synthetic-account@example.test</dd>
    <dt>Plan</dt><dd data-testid="plan-status">Free</dd>
  </dl>
  <a href="${checkoutHref}"${popup ? ' target="_blank" rel="opener"' : ''}>Start synthetic checkout</a>
</main>`);
}

function checkoutPage({ checkoutId, variant }) {
    const drifted = variant === 'DRIFTED';
    return html(`
<main>
  <h1>Synthetic Plus checkout</h1>
  <p data-testid="product">${drifted ? 'Unknown Premium product' : 'ChatGPT Plus (synthetic)'}</p>
  <p data-testid="amount">${drifted ? 'USD 20.00 (unexpected synthetic drift)' : 'PHP 1,100.00 (synthetic)'}</p>
  <iframe title="${drifted ? 'Unrecognized embedded form' : 'Synthetic payment frame'}" src="/payment-frame?checkoutId=${encodeURIComponent(checkoutId)}"></iframe>
  <p aria-live="polite" data-testid="checkout-status">CHECKOUT_READY</p>
  <button type="button" data-testid="cancel-renewal" hidden>Cancel synthetic renewal</button>
</main>`, `
const statusNode = document.querySelector('[data-testid="checkout-status"]');
const cancelButton = document.querySelector('[data-testid="cancel-renewal"]');
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== 'mock-payment-status') return;
  statusNode.textContent = event.data.status;
  if (['ENTITLEMENT_CONFIRMED', 'CANCELLATION_PENDING'].includes(event.data.status)) {
    cancelButton.hidden = false;
  }
});
cancelButton.addEventListener('click', async () => {
  cancelButton.disabled = true;
  const response = await fetch('/api/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkoutId: ${JSON.stringify(checkoutId)} })
  });
  const result = await response.json();
  statusNode.textContent = result.status;
});`);
}

function paymentFramePage({ checkoutId }) {
    return html(`
<main data-sensitive-mode="true">
  <h1>Synthetic payment details</h1>
  <form data-testid="payment-form">
    <label>Name on synthetic card <input name="name" autocomplete="off" required></label>
    <label>Synthetic card number <input name="number" inputmode="numeric" autocomplete="off" required></label>
    <label>Expiry <input name="expiry" autocomplete="off" required></label>
    <label>Security code <input name="code" inputmode="numeric" autocomplete="off" required></label>
    <button type="submit" data-testid="submit-payment">Submit synthetic payment</button>
  </form>
  <button type="button" data-testid="complete-3ds" hidden>Complete synthetic 3DS</button>
  <p aria-live="polite" data-testid="payment-status">PAYMENT_ARMED</p>
</main>`, `
const form = document.querySelector('[data-testid="payment-form"]');
const submitButton = document.querySelector('[data-testid="submit-payment"]');
const threeDsButton = document.querySelector('[data-testid="complete-3ds"]');
const statusNode = document.querySelector('[data-testid="payment-status"]');
let submitted = false;
let authorizationRef = null;
function publish(status) {
  statusNode.textContent = status;
  parent.postMessage({ type: 'mock-payment-status', status }, window.location.origin);
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitted) return;
  submitted = true;
  submitButton.disabled = true;
  publish('PAYMENT_SUBMITTING');
  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkoutId: ${JSON.stringify(checkoutId)}, permitNonce: 'synthetic-browser-permit' })
    });
    if (!response.ok) throw new Error('mock submit rejected');
    const result = await response.json();
    authorizationRef = result.authorizationRef;
    publish(result.status);
    if (result.status === 'REQUIRES_3DS') threeDsButton.hidden = false;
  } catch {
    publish('PAYMENT_UNKNOWN');
  }
});
threeDsButton.addEventListener('click', async () => {
  threeDsButton.disabled = true;
  const response = await fetch('/api/3ds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkoutId: ${JSON.stringify(checkoutId)}, authorizationRef })
  });
  const result = await response.json();
  publish(result.status);
});`);
}

function createMockBrowserServer({ gateway = new MockPaymentGateway() } = {}) {
    const runToCheckout = new Map();
    let server;
    let baseUrl;

    async function handler(request, response) {
        const url = new URL(request.url, 'http://127.0.0.1');
        try {
            if (request.method === 'GET' && url.pathname === '/account') {
                const runId = url.searchParams.get('runId') || 'local-mock-run';
                const scenario = url.searchParams.get('scenario') || 'SUBMIT_UNKNOWN';
                const popup = url.searchParams.get('popup') === '1';
                const variant = url.searchParams.get('variant') || 'STABLE';
                htmlResponse(response, accountPage({ runId, scenario, popup, variant }));
                return;
            }
            if (request.method === 'GET' && url.pathname === '/checkout') {
                const runId = url.searchParams.get('runId') || 'local-mock-run';
                const scenario = url.searchParams.get('scenario') || 'SUBMIT_UNKNOWN';
                const variant = url.searchParams.get('variant') || 'STABLE';
                let checkoutId = runToCheckout.get(runId);
                if (!checkoutId) {
                    checkoutId = gateway.createCheckout({
                        accountKeyHmac: `synthetic-account-${runId}`,
                        scenario
                    }).checkoutId;
                    runToCheckout.set(runId, checkoutId);
                }
                htmlResponse(response, checkoutPage({ checkoutId, variant }));
                return;
            }
            if (request.method === 'GET' && url.pathname === '/payment-frame') {
                htmlResponse(response, paymentFramePage({ checkoutId: url.searchParams.get('checkoutId') || '' }));
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/submit') {
                const input = await readJson(request);
                const result = gateway.submit(input);
                if (result.status === 'PAYMENT_UNKNOWN') {
                    request.socket.destroy();
                    return;
                }
                jsonResponse(response, 200, result);
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/3ds') {
                jsonResponse(response, 200, gateway.complete3ds(await readJson(request)));
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/cancel') {
                const input = await readJson(request);
                jsonResponse(response, 200, gateway.confirmCancellation(input.checkoutId));
                return;
            }
            jsonResponse(response, 404, { error: 'NOT_FOUND' });
        } catch (error) {
            const code = error instanceof ContractError ? error.code : 'MOCK_SERVER_ERROR';
            jsonResponse(response, 409, { error: code });
        }
    }

    return {
        gateway,
        runToCheckout,
        async start() {
            if (server) return baseUrl;
            server = http.createServer((request, response) => {
                handler(request, response).catch(() => {
                    if (!response.headersSent) jsonResponse(response, 500, { error: 'MOCK_SERVER_ERROR' });
                    else response.destroy();
                });
            });
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            baseUrl = `http://127.0.0.1:${address.port}`;
            return baseUrl;
        },
        async stop() {
            if (!server) return;
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            server = null;
            baseUrl = null;
        }
    };
}

module.exports = { createMockBrowserServer };
