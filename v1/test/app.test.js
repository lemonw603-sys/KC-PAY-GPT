import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app/create-app.js';
import { createFixedWindowRateLimit } from '../src/app/fixed-window-rate-limit.js';
import { OrderIntakeError } from '../src/domain/order-intake-error.js';
import { PublicApiError } from '../src/domain/public-api-error.js';
import { createAdminSessionAuth, hashAdminPassword } from '../src/security/admin-session.js';

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('exposes liveness and readiness without legacy automation', async () => {
  const app = createApp({ readiness: async () => ({ ready: true }) });
  await withServer(app, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/health/live`);
    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(live.headers.has('x-powered-by'), false);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });
  });
});

test('serves the isolated v1 customer page and local assets', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(html, /id="submit-form"/);
    assert.match(html, /id="query-form"/);

    const script = await fetch(`${baseUrl}/assets/customer.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.match(await script.text(), /\/api\/v1\/orders\/status/);
  });
});

test('readiness fails closed and errors do not expose details', async () => {
  const app = createApp({ readiness: async () => { throw new Error('database password leaked'); } });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready' });
  });
});

test('creates a customer order without exposing internal identifiers', async () => {
  let received;
  const app = createApp({
    createCustomerOrder: async (body) => {
      received = body;
      return { orderId: 'internal-id', publicNo: 'PJV1-public', status: 'CREATED' };
    }
  });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cdk: 'fixture-cdk', session: { fixture: true } })
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      order: { publicNo: 'PJV1-public', status: 'CREATED' }
    });
    assert.deepEqual(received, { cdk: 'fixture-cdk', session: { fixture: true } });
  });
});

test('maps intake failures safely and rate-limits repeated submissions', async () => {
  const paused = createApp({
    createCustomerOrder: async () => {
      throw new OrderIntakeError('internal setting detail', {
        code: 'ORDERING_PAUSED',
        status: 503
      });
    }
  });
  await withServer(paused, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'ordering_paused' });
  });

  const limited = createApp({
    createCustomerOrder: async () => ({ publicNo: 'PJV1-public', status: 'CREATED' }),
    orderRateLimit: createFixedWindowRateLimit({ limit: 1, windowMs: 60_000 })
  });
  await withServer(limited, async (baseUrl) => {
    const request = () => fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal((await request()).status, 201);
    const response = await request();
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'rate_limited' });
    assert.equal(response.headers.has('retry-after'), true);
  });
});

test('queries customer order status without caching or exposing internal state', async () => {
  const app = createApp({
    getCustomerOrderStatus: async () => ({
      publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
      status: 'REVIEWING',
      updatedAt: '2026-08-17T10:00:00.000Z'
    })
  });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/orders/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cdk: 'PJ-ABCDEFGH' })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      order: {
        publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        status: 'REVIEWING',
        updatedAt: '2026-08-17T10:00:00.000Z'
      }
    });
  });
});

test('does not cache missing-order responses', async () => {
  const app = createApp({
    getCustomerOrderStatus: async () => {
      throw new PublicApiError('not found detail', {
        code: 'ORDER_NOT_FOUND',
        status: 404
      });
    }
  });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/orders/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' })
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'order_not_found' });
  });
});

test('protects the admin page and read APIs with a server-side signed session', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 4) }),
    sessionSecret: Buffer.alloc(32, 6),
    secureCookies: true
  });
  const app = createApp({
    adminAuth,
    getAdminOverview: async () => ({ metrics: { totalOrders: 2 } }),
    listAdminOrders: async (query) => ({ query, orders: [], total: 0 }),
    getAdminOrder: async (publicNo) => ({
      order: { publicNo },
      card: { last4: '4242' }
    })
  });

  await withServer(app, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/admin/login');

    const denied = await fetch(`${baseUrl}/api/v1/admin/overview`);
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: 'admin_auth_required' });

    const badLogin = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong password' })
    });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.headers.has('set-cookie'), false);

    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    assert.equal(login.status, 204);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /pojia_admin_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);

    const sessionCookie = cookie.split(';')[0];
    const overview = await fetch(`${baseUrl}/api/v1/admin/overview`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(overview.status, 200);
    assert.deepEqual(await overview.json(), { metrics: { totalOrders: 2 } });

    const detail = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-fixture`, {
      headers: { Cookie: sessionCookie }
    });
    assert.deepEqual(await detail.json(), {
      order: { publicNo: 'PJV1-fixture' },
      card: { last4: '4242' }
    });
  });
});

test('keeps the admin closed when login credentials are not configured', async () => {
  const app = createApp({ getAdminOverview: async () => ({}) });
  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'anything at all' })
    });
    assert.equal(login.status, 503);
    assert.deepEqual(await login.json(), { error: 'admin_not_configured' });
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/overview`)).status, 401);
  });
});
