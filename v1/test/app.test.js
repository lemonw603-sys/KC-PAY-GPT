import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app/create-app.js';
import { createFixedWindowRateLimit } from '../src/app/fixed-window-rate-limit.js';
import { OrderIntakeError } from '../src/domain/order-intake-error.js';
import { PublicApiError } from '../src/domain/public-api-error.js';
import { createAdminSessionAuth, hashAdminPassword } from '../src/security/admin-session.js';
import { createAdminStartBusinessService } from '../src/services/admin-start-business-service.js';

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

async function stepUp(baseUrl, sessionCookie, password = 'fixture admin password') {
  const response = await fetch(`${baseUrl}/api/v1/admin/step-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
    body: JSON.stringify({ password })
  });
  assert.equal(response.status, 204);
  return `${sessionCookie}; ${response.headers.get('set-cookie').split(';')[0]}`;
}

async function requestWithHost(baseUrl, path, host) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      headers: { Host: host }
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
    request.end();
  });
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

test('labels local stock refresh separately from provider card synchronization', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/admin/assets/admin.js', import.meta.url), 'utf8');
  assert.match(html, /id="refresh-stock"[^>]*>刷新本地列表</);
  assert.match(html, /id="sync-all-cards"[^>]*>同步卡台余额和交易</);
  assert.match(script, /本地列表已刷新（未同步卡台）/);
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

test('replaces a customer Session on the original order without exposing internal fields', async () => {
  let received;
  const app = createApp({
    replaceCustomerSession: async (body) => {
      received = body;
      return {
        publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        status: 'CARD_READY',
        replacementCount: 1,
        replacementsRemaining: 2,
        repairExpiresAt: '2026-08-24T10:00:00.000Z'
      };
    }
  });
  await withServer(app, async (baseUrl) => {
    const body = {
      publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
      session: { accessToken: 'fixture', sessionToken: 'fixture' }
    };
    const response = await fetch(`${baseUrl}/api/v1/orders/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      order: {
        publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        status: 'CARD_READY',
        replacementCount: 1,
        replacementsRemaining: 2,
        repairExpiresAt: '2026-08-24T10:00:00.000Z'
      }
    });
    assert.deepEqual(received, body);
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

    const leakedSearch = await fetch(`${baseUrl}/api/v1/admin/orders?q=4242424242424242`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(leakedSearch.status, 400);
    assert.deepEqual(await leakedSearch.json(), { error: 'admin_search_body_required' });

    const safeSearch = await fetch(`${baseUrl}/api/v1/admin/orders/search`, {
      method: 'POST',
      headers: { Cookie: sessionCookie, Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '4242424242424242', page: 1 })
    });
    assert.equal(safeSearch.status, 200);
    assert.deepEqual((await safeSearch.json()).query, { q: '4242424242424242', page: 1 });
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

test('isolates admin and customer routes by hostname', async () => {
  const app = createApp({ adminHost: 'ops.vibebridge.top' });
  await withServer(app, async (baseUrl) => {
    const publicAdmin = await requestWithHost(baseUrl, '/admin', 'plus.vibebridge.top');
    assert.equal(publicAdmin.statusCode, 404);
    const adminRoot = await requestWithHost(baseUrl, '/', 'ops.vibebridge.top');
    assert.equal(adminRoot.statusCode, 302);
    assert.equal(adminRoot.headers.location, '/admin');
    const adminCustomerApi = await requestWithHost(baseUrl, '/api/v1/orders/status', 'ops.vibebridge.top');
    assert.equal(adminCustomerApi.statusCode, 404);
  });
});

test('generates CDKs only for an authenticated administrator', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 7) }),
    sessionSecret: Buffer.alloc(32, 8),
    secureCookies: false
  });
  let received;
  let revoked;
  let inspected;
  const app = createApp({
    adminAuth,
    createAdminCdkBatch: async (input) => {
      received = input;
      return { batchNo: 'B-TEST', count: 1, codes: ['PJ-ABCDEFGHJKMNPQRST234'] };
    },
    listAdminCdkBatches: async () => ({ batches: [{ batchNo: 'B-TEST', totalCount: 1 }] }),
    downloadAdminCdkBatch: async (batchNo) => ({ batchNo, codes: ['PJ-ABCDEFGHJKMNPQRST234'] }),
    inspectAdminCdkBatch: async (batchNo) => {
      inspected = batchNo;
      return { batchNo, codes: [{ code: 'PJ-ABCDEFGHJKMNPQRST234', status: 'REVOKED' }] };
    },
    revokeAdminCdkBatch: async (batchNo, reason) => {
      revoked = { batchNo, reason };
      return { batchNo, revokedCount: 1 };
    }
  });

  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/admin/cdks/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-idempotency-001' },
      body: JSON.stringify({ count: 1 })
    });
    assert.equal(denied.status, 401);

    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const sessionCookie = login.headers.get('set-cookie').split(';')[0];
    const stepUpRequired = await fetch(`${baseUrl}/api/v1/admin/cdks/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie,
        Origin: baseUrl, 'Idempotency-Key': 'fixture-idempotency-001' },
      body: JSON.stringify({ count: 1 })
    });
    assert.equal(stepUpRequired.status, 403);
    assert.deepEqual(await stepUpRequired.json(), { error: 'admin_step_up_required' });
    const sensitiveCookie = await stepUp(baseUrl, sessionCookie);
    const generated = await fetch(`${baseUrl}/api/v1/admin/cdks/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie,
        Origin: baseUrl, 'Idempotency-Key': 'fixture-idempotency-001' },
      body: JSON.stringify({ count: 1 })
    });
    assert.equal(generated.status, 201);
    assert.equal(generated.headers.get('cache-control'), 'no-store');
    assert.deepEqual(received, { count: 1, requestKey: 'fixture-idempotency-001' });
    assert.deepEqual(await generated.json(), {
      batchNo: 'B-TEST', count: 1, codes: ['PJ-ABCDEFGHJKMNPQRST234']
    });
    const batches = await fetch(`${baseUrl}/api/v1/admin/cdks/batches`, {
      headers: { Cookie: sessionCookie }
    });
    assert.deepEqual(await batches.json(), { batches: [{ batchNo: 'B-TEST', totalCount: 1 }] });
    const download = await fetch(`${baseUrl}/api/v1/admin/cdks/B-TEST/download`, {
      method: 'POST', headers: { Cookie: sensitiveCookie, Origin: baseUrl }
    });
    assert.deepEqual(await download.json(), {
      batchNo: 'B-TEST', codes: ['PJ-ABCDEFGHJKMNPQRST234']
    });
    const statusReport = await fetch(`${baseUrl}/api/v1/admin/cdks/B-TEST/status-report`, {
      method: 'POST', headers: { Cookie: sensitiveCookie, Origin: baseUrl }
    });
    assert.deepEqual(await statusReport.json(), {
      batchNo: 'B-TEST', codes: [{ code: 'PJ-ABCDEFGHJKMNPQRST234', status: 'REVOKED' }]
    });
    assert.equal(inspected, 'B-TEST');
    const revoke = await fetch(`${baseUrl}/api/v1/admin/cdks/B-TEST/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ reason: 'fixture revoke' })
    });
    assert.deepEqual(await revoke.json(), { batchNo: 'B-TEST', revokedCount: 1 });
    assert.deepEqual(revoked, { batchNo: 'B-TEST', reason: 'fixture revoke' });
  });
});

test('creates paid card stock jobs only through an authenticated admin route', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 9) }),
    sessionSecret: Buffer.alloc(32, 10),
    secureCookies: false
  });
  let received;
  const app = createApp({
    adminAuth,
    getAdminCardStock: async () => ({ threshold: 1, cardTypes: [], jobs: [] }),
    setAdminCardStockThreshold: async (count) => ({ threshold: Number(count) }),
    createAdminCardStockJob: async (input) => {
      received = input;
      return { id: 'job-1', status: 'PENDING' };
    }
  });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/card-stock`)).status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const stock = await fetch(`${baseUrl}/api/v1/admin/card-stock`, { headers: { Cookie: cookie } });
    assert.deepEqual(await stock.json(), { threshold: 1, cardTypes: [], jobs: [] });
    const sensitiveCookie = await stepUp(baseUrl, cookie);
    const created = await fetch(`${baseUrl}/api/v1/admin/card-stock/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ count: 2, amount: 16, cardTypeId: '1', confirmation: '开2张', largeBatchConfirmed: false })
    });
    assert.equal(created.status, 202);
    assert.deepEqual(received, { count: 2, amount: 16, cardTypeId: '1', confirmation: '开2张', largeBatchConfirmed: false });
  });
});

test('exposes guarded provider refresh and default card type routes', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 19) }),
    sessionSecret: Buffer.alloc(32, 20), secureCookies: false
  });
  let refreshed = 0; let selected;
  const app = createApp({
    adminAuth,
    refreshAdminCardStockProvider: async () => { refreshed += 1; return { syncedAt: 'now', cardTypes: [] }; },
    setAdminCardStockDefaultCardType: async (id) => { selected = id; return { cardTypeId: id }; }
  });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/card-stock/provider-refresh`, { method: 'POST' })).status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture admin password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const refresh = await fetch(`${baseUrl}/api/v1/admin/card-stock/provider-refresh`, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl } });
    assert.equal(refresh.status, 200);
    assert.equal(refreshed, 1);
    const stepped = await stepUp(baseUrl, cookie);
    const response = await fetch(`${baseUrl}/api/v1/admin/card-stock/default-card-type`, { method: 'POST', headers: { Cookie: stepped, Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ cardTypeId: '16' }) });
    assert.equal(response.status, 200); assert.equal(selected, '16');
  });
});

test('start-business gates intake and dispatch on read-only readiness and stock', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 21) }),
    sessionSecret: Buffer.alloc(32, 22), secureCookies: false
  });
  let acceptanceCalls = 0; let dispatchCalls = 0;
  const makeApp = ({ available = 1, ready = true, failDispatch = false } = {}) => createApp({
    adminAuth,
    getAdminOverview: async () => ({
      cardStock: { available, needsFunding: 2 },
      providerHealth: { syncedAt: ready ? new Date().toISOString() : null, purchaseEnabled: ready }
    }),
    startAdminBusiness: createAdminStartBusinessService({
      adminReadService: { getOverview: async () => ({ cardStock: { available, needsFunding: 2 }, providerHealth: { syncedAt: ready ? new Date().toISOString() : null, purchaseEnabled: ready } }) },
      cardStockService: { status: async () => ({ provider: { defaultCardTypeId: '16', cardTypes: [{ id: '16', name: 'VISA' }] } }) },
      adminOperationsService: { setOrderAcceptance: async ({ enabled }) => { acceptanceCalls += enabled ? 1 : -1; return { acceptNewOrders: enabled }; }, setDispatch: async () => { if (failDispatch) throw new Error('dispatch failed'); dispatchCalls += 1; return { dispatchExistingOrders: true }; } }
    })
  });
  async function invoke(app) {
    let result;
    await withServer(app, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture admin password' }) });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      result = await fetch(`${baseUrl}/api/v1/admin/operations/start-business`, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl } });
    });
    return result;
  }
  const ready = await invoke(makeApp());
  assert.equal(ready.status, 200); assert.equal(acceptanceCalls, 1); assert.equal(dispatchCalls, 1);
  const blocked = await invoke(makeApp({ available: 0 }));
  assert.equal(blocked.status, 500); assert.equal(acceptanceCalls, 1); assert.equal(dispatchCalls, 1);
  const stale = await invoke(makeApp({ ready: false }));
  assert.equal(stale.status, 500); assert.equal(acceptanceCalls, 1); assert.equal(dispatchCalls, 1);
  const failed = await invoke(makeApp({ failDispatch: true }));
  assert.equal(failed.status, 500); assert.equal(acceptanceCalls, 1); assert.equal(dispatchCalls, 1);
});

test('reads card detail and queues inventory sync without step-up or paid actions', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 14) }),
    sessionSecret: Buffer.alloc(32, 15),
    secureCookies: false
  });
  let received;
  const app = createApp({
    adminAuth,
    getAdminCard: async (providerCardId) => ({ card: { providerCardId }, transactions: [] }),
    requestAdminCardSync: async (input) => {
      received = input;
      return { requested: 1, queued: 1, alreadyActive: 0 };
    }
  });
  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const sessionCookie = login.headers.get('set-cookie').split(';')[0];
    const detail = await fetch(`${baseUrl}/api/v1/admin/cards/card-617`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(detail.status, 200);
    assert.deepEqual(await detail.json(), {
      card: { providerCardId: 'card-617' }, transactions: []
    });
    const queued = await fetch(`${baseUrl}/api/v1/admin/cards/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
      body: JSON.stringify({ providerCardId: 'card-617' })
    });
    assert.equal(queued.status, 202);
    assert.deepEqual(received, { providerCardId: 'card-617' });
    assert.deepEqual(await queued.json(), { requested: 1, queued: 1, alreadyActive: 0 });
  });
});

test('discovers manual cards through authenticated quarantine intake routes', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 21) }),
    sessionSecret: Buffer.alloc(32, 22), secureCookies: false
  });
  const calls = [];
  const app = createApp({
    adminAuth,
    listAdminCardIntake: async () => ({ configured: true, batches: [], discoveries: [] }),
    discoverAdminCards: async () => {
      calls.push('discover');
      return { discovery: { batch: { id: 'batch-1' } }, secondPass: { accepted: 2 } };
    }
  });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/card-intake`)).status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const listed = await fetch(`${baseUrl}/api/v1/admin/card-intake`, { headers: { Cookie: cookie } });
    assert.equal(listed.status, 200);
    const discovered = await fetch(`${baseUrl}/api/v1/admin/card-intake/discover`, {
      method: 'POST', headers: { Cookie: cookie, Origin: baseUrl }
    });
    assert.equal(discovered.status, 202);
    assert.deepEqual(calls, ['discover']);
  });
});

test('changes intake and one-order recharge permits only through authenticated admin routes', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 11) }),
    sessionSecret: Buffer.alloc(32, 12),
    secureCookies: false
  });
  const received = [];
  const app = createApp({
    adminAuth,
    setAdminOrderAcceptance: async (input) => {
      received.push(['intake', input]);
      return { acceptNewOrders: input.enabled, dispatchExistingOrders: true };
    },
    setAdminRechargePermit: async (publicNo, input) => {
      received.push(['permit', publicNo, input]);
      return { publicNo, status: 'ARMED', expiresAt: '2026-08-19T12:00:00.000Z' };
    }
  });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/operations/order-acceptance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    })).status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const intake = await fetch(`${baseUrl}/api/v1/admin/operations/order-acceptance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ enabled: true, confirmation: '开始接单' })
    });
    assert.equal(intake.status, 200);
    const sensitiveCookie = await stepUp(baseUrl, cookie);
    const permit = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-DEMO/recharge-permit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ action: 'arm', confirmation: '确认充值 PJV1-DEMO' })
    });
    assert.equal(permit.status, 202);
    assert.deepEqual(received, [
      ['intake', { enabled: true, confirmation: '开始接单' }],
      ['permit', 'PJV1-DEMO', { action: 'arm', confirmation: '确认充值 PJV1-DEMO' }]
    ]);
  });
});

test('issues an order compensation only through the guarded admin route', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 15) }),
    sessionSecret: Buffer.alloc(32, 16), secureCookies: false
  });
  let received;
  const app = createApp({
    adminAuth,
    compensateAdminOrder: async (publicNo, input) => {
      received = { publicNo, input };
      return { publicNo, planType: 'plus', code: 'PJ-COMPENSATIONFIXTURE', replayed: false };
    }
  });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-DEMO/compensation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    })).status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const sensitiveCookie = await stepUp(baseUrl, cookie);
    const response = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-DEMO/compensation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ confirmation: '补发 PJV1-DEMO' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).code, 'PJ-COMPENSATIONFIXTURE');
    assert.deepEqual(received, {
      publicNo: 'PJV1-DEMO', input: { confirmation: '补发 PJV1-DEMO' }
    });
  });
});

test('cancels an unsubmitted order only through the guarded admin route', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 17) }),
    sessionSecret: Buffer.alloc(32, 18), secureCookies: false
  });
  let received;
  const app = createApp({
    adminAuth,
    cancelAdminOrder: async (publicNo, input) => {
      received = { publicNo, input };
      return { publicNo, status: 'CLOSED', cardReleased: true, replayed: false };
    }
  });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-DEMO/cancellation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    })).status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const sensitiveCookie = await stepUp(baseUrl, cookie);
    const response = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-DEMO/cancellation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ confirmation: '取消订单 PJV1-DEMO' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cardReleased, true);
    assert.deepEqual(received, {
      publicNo: 'PJV1-DEMO', input: { confirmation: '取消订单 PJV1-DEMO' }
    });
  });
});

test('rejects authenticated admin writes from a different origin', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 13) }),
    sessionSecret: Buffer.alloc(32, 14),
    secureCookies: false
  });
  let called = false;
  const app = createApp({
    adminAuth,
    setAdminOrderAcceptance: async () => { called = true; return {}; }
  });
  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${baseUrl}/api/v1/admin/operations/order-acceptance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie,
        Origin: 'https://attacker.example' },
      body: JSON.stringify({ enabled: false, confirmation: '停止接单' })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'admin_origin_required' });
    assert.equal(called, false);
  });
});

test('guards batch recharge authorization and exposes reconciliation, delivery, and safe CSV operations', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 21) }),
    sessionSecret: Buffer.alloc(32, 22), secureCookies: false
  });
  const received = {};
  const app = createApp({
    adminAuth,
    createAdminRechargeAuthorization: async (input) => {
      received.authorization = input;
      return { id: 'auth-1', itemCount: input.publicNos.length };
    },
    recordAdminCdkDelivery: async (input) => {
      received.delivery = input;
      return { recordedCount: input.cdkIds.length };
    },
    listAdminReconciliationCases: async (input) => ({ page: Number(input.page), total: 1, cases: [{ id: 'case-1' }] }),
    assignAdminReconciliationCase: async (input) => ({ ...input, status: 'ASSIGNED' }),
    resolveAdminReconciliationCase: async (input) => ({ ...input, status: 'RESOLVED' }),
    exportAdminOperationsCsv: async (input) => ({
      dataset: input.dataset, rowCount: 1, truncated: false, nextCursor: null,
      contentType: 'text/csv; charset=utf-8', csv: '\uFEFFPublic No,Status\r\nPJV2-1,CARD_READY\r\n'
    })
  });

  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const sessionCookie = login.headers.get('set-cookie').split(';')[0];
    const sensitiveCookie = await stepUp(baseUrl, sessionCookie);

    const authorization = await fetch(`${baseUrl}/api/v1/admin/recharge-authorizations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ publicNos: ['PJV2-1', 'PJV2-2'], confirmation: '确认充值2单' })
    });
    assert.equal(authorization.status, 201);
    assert.deepEqual(received.authorization, { publicNos: ['PJV2-1', 'PJV2-2'], confirmation: '确认充值2单' });

    const delivery = await fetch(`${baseUrl}/api/v1/admin/cdks/deliveries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ batchNo: 'B-1', cdkIds: ['00000000-0000-4000-8000-000000000001'], recipientReference: 'order:1' })
    });
    assert.equal(delivery.status, 201);
    assert.equal((await delivery.json()).recordedCount, 1);

    const cases = await fetch(`${baseUrl}/api/v1/admin/reconciliation-cases?page=1`, { headers: { Cookie: sessionCookie } });
    assert.equal(cases.status, 200);
    assert.equal((await cases.json()).total, 1);
    const assigned = await fetch(`${baseUrl}/api/v1/admin/reconciliation-cases/case-1/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl },
      body: JSON.stringify({ assignedTo: 'ops-a' })
    });
    assert.equal((await assigned.json()).status, 'ASSIGNED');
    const resolved = await fetch(`${baseUrl}/api/v1/admin/reconciliation-cases/case-1/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl },
      body: JSON.stringify({ resolutionNote: 'provider evidence checked' })
    });
    assert.equal((await resolved.json()).status, 'RESOLVED');

    const csv = await fetch(`${baseUrl}/api/v1/admin/exports/orders.csv?limit=10000`, { headers: { Cookie: sessionCookie } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.headers.get('content-disposition'), /orders-/);
    assert.equal(csv.headers.get('x-export-row-count'), '1');
    assert.match(await csv.text(), /PJV2-1,CARD_READY/);
  });
});

test('keeps Browser timelines read-only and requires origin plus step-up for control transfer', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 25) }),
    sessionSecret: Buffer.alloc(32, 26), secureCookies: false
  });
  const received = {};
  const app = createApp({
    adminAuth,
    listAdminBrowserDispatchJobs: async (input) => ({
      page: Number(input.page), total: 1, jobs: [{ id: 41, status: 'QUEUED' }]
    }),
    listAdminBrowserRuns: async (input) => ({ page: Number(input.page), total: 1, runs: [{ id: 'run-1' }] }),
    getAdminBrowserRun: async (runId) => ({ run: { id: runId }, artifacts: [{ id: 'artifact-1' }] }),
    controlAdminBrowserRun: async (runId, input) => {
      received.control = { runId, input };
      return { runId, action: input.action, controlState: 'REQUESTED' };
    }
  });

  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const sessionCookie = login.headers.get('set-cookie').split(';')[0];
    const runs = await fetch(`${baseUrl}/api/v1/admin/browser/runs?page=1`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(runs.status, 200);
    assert.equal((await runs.json()).total, 1);
    const dispatchJobs = await fetch(`${baseUrl}/api/v1/admin/browser/dispatch-jobs?page=1`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(dispatchJobs.status, 200);
    assert.equal((await dispatchJobs.json()).jobs[0].status, 'QUEUED');
    const detail = await fetch(`${baseUrl}/api/v1/admin/browser/runs/run-1`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).run.id, 'run-1');

    const body = JSON.stringify({
      action: 'REQUEST', operationId: 'admin-request:run-1',
      confirmation: '请求人工接管 run-1', reasonCode: 'OPERATOR_REVIEW'
    });
    const noStepUp = await fetch(`${baseUrl}/api/v1/admin/browser/runs/run-1/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: baseUrl }, body
    });
    assert.equal(noStepUp.status, 403);
    assert.deepEqual(await noStepUp.json(), { error: 'admin_step_up_required' });
    assert.equal(received.control, undefined);

    const sensitiveCookie = await stepUp(baseUrl, sessionCookie);
    const wrongOrigin = await fetch(`${baseUrl}/api/v1/admin/browser/runs/run-1/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie,
        Origin: 'https://attacker.example' }, body
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(received.control, undefined);

    const controlled = await fetch(`${baseUrl}/api/v1/admin/browser/runs/run-1/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl }, body
    });
    assert.equal(controlled.status, 200);
    assert.equal((await controlled.json()).controlState, 'REQUESTED');
    assert.deepEqual(received.control, {
      runId: 'run-1',
      input: {
        action: 'REQUEST', operationId: 'admin-request:run-1',
        confirmation: '请求人工接管 run-1', reasonCode: 'OPERATOR_REVIEW'
      }
    });
  });
});
