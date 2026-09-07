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

// D-129: there is no step-up password any more; sensitive routes accept the plain
// admin session. Kept as a no-op so the route tests read unchanged.
async function stepUp(_baseUrl, sessionCookie) {
  return sessionCookie;
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

test('admin overview does not describe disabled automatic card opening as enabled', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/admin/assets/admin.js', import.meta.url), 'utf8');
  assert.match(html, /admin\.js\?v=34/);
  assert.match(script, /supplyOn \? '自动开卡与补余额' : d\.supplyAutomationMixed \? '部分开启' : '全部人工'/);
  assert.match(script, /开卡与补余额都由人工在卡片页操作/);
  assert.match(script, /没有合格卡，新订单会等卡/);
  assert.doesNotMatch(script, /自动补卡已开启，已到库存线/);
  assert.doesNotMatch(script, /自动开卡已关闭；当前无合格卡时需要人工处理/);
});

test('admin script only references elements it declares and ids that exist in the page', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/admin/assets/admin.js', import.meta.url), 'utf8');
  const start = script.indexOf('const elements = {');
  const block = script.slice(start, script.indexOf('\n};', start));
  const declared = new Set([...block.matchAll(/(?:^|[\s,{])([A-Za-z0-9_]+):\s*(?:document|\[)/g)].map((m) => m[1]));
  const used = [...new Set([...script.matchAll(/elements\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  assert.deepEqual(used.filter((key) => !declared.has(key)), []);
  const ids = [...new Set([...block.matchAll(/querySelector\('#([a-z0-9-]+)'\)/g)].map((m) => m[1]))];
  assert.deepEqual(ids.filter((id) => !html.includes(`id="${id}"`)), []);
});

test('exposes the one-to-four card capacity setting in the admin UI', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/admin/assets/admin.js', import.meta.url), 'utf8');
  assert.match(html, /id="card-capacity-form"/);
  assert.match(html, /id="card-capacity"[^>]*required/);
  for (const value of [1, 2, 3, 4]) assert.match(html, new RegExp(`<option value="${value}">${value} 次</option>`));
  assert.match(script, /\/api\/v1\/admin\/card-stock\/max-successful-payments/);
  assert.match(script, /payload\.maxSuccessfulPayments \|\| 3/);
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
    // Daily CDK operations are authorized by the admin login itself; no
    // repeated password (step-up) prompt.
    const sensitiveCookie = sessionCookie;
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

test('updates card capacity through the guarded admin route without provider calls', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 23) }),
    sessionSecret: Buffer.alloc(32, 24), secureCookies: false
  });
  let capacity = 3;
  let settingWrites = 0;
  let providerCalls = 0;
  const app = createApp({
    adminAuth,
    getAdminCardStock: async () => ({ maxSuccessfulPayments: capacity }),
    setAdminCardMaxSuccessfulPayments: async (count) => {
      settingWrites += 1;
      capacity = count;
      return { maxSuccessfulPayments: count };
    },
    refreshAdminCardStockProvider: async () => {
      providerCalls += 1;
      return {};
    }
  });
  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/admin/card-stock/max-successful-payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 4 })
    });
    assert.equal(denied.status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const invalid of [0, 5, 1.5, '2', true, 'invalid']) {
      const response = await fetch(`${baseUrl}/api/v1/admin/card-stock/max-successful-payments`, {
        method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: invalid })
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid_card_capacity' });
    }
    const updated = await fetch(`${baseUrl}/api/v1/admin/card-stock/max-successful-payments`, {
      method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 4 })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { maxSuccessfulPayments: 4 });
    const stock = await fetch(`${baseUrl}/api/v1/admin/card-stock`, { headers: { Cookie: cookie } });
    assert.deepEqual(await stock.json(), { maxSuccessfulPayments: 4 });
  });
  assert.equal(settingWrites, 1);
  assert.equal(providerCalls, 0);
});

test('start-business gates intake and dispatch on read-only readiness and stock', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 21) }),
    sessionSecret: Buffer.alloc(32, 22), secureCookies: false
  });
  let acceptanceCalls = 0; let dispatchCalls = 0;
  const makeApp = ({ available = 1, needsFunding = 2, autoReplenishmentEnabled = false, ready = true, failDispatch = false } = {}) => createApp({
    adminAuth,
    getAdminOverview: async () => ({
      cardStock: { available, needsFunding, autoReplenishmentEnabled },
      providerHealth: { rechargeMethod: 'API', syncedAt: ready ? new Date().toISOString() : null, purchaseEnabled: ready }, runtimeHealth: { workerHealthy: ready, rechargeWritesEnabled: true }
    }),
    startAdminBusiness: createAdminStartBusinessService({
      adminReadService: { getOverview: async () => ({ cardStock: { available, needsFunding, autoReplenishmentEnabled }, providerHealth: { rechargeMethod: 'API', syncedAt: ready ? new Date().toISOString() : null, purchaseEnabled: ready }, runtimeHealth: { workerHealthy: ready, rechargeWritesEnabled: true } }) },
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
  assert.equal(blocked.status, 409); assert.equal(acceptanceCalls, 1); assert.equal(dispatchCalls, 1);
  const autoHeal = await invoke(makeApp({ available: 0, needsFunding: 0, autoReplenishmentEnabled: true }));
  assert.equal(autoHeal.status, 200); assert.equal((await autoHeal.json()).readiness.status, 'AUTO_HEAL');
  assert.equal(acceptanceCalls, 2); assert.equal(dispatchCalls, 2);
  const stale = await invoke(makeApp({ ready: false }));
  assert.equal(stale.status, 409); assert.equal(acceptanceCalls, 2); assert.equal(dispatchCalls, 2);
  const failed = await invoke(makeApp({ failDispatch: true }));
  assert.equal(failed.status, 500); assert.equal(acceptanceCalls, 2); assert.equal(dispatchCalls, 2);
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

test('changes intake and default recharge method only through authenticated admin routes', async () => {
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
    setAdminDefaultRechargeMethod: async (input) => {
      received.push(['method', input]);
      return { method: input.method, changed: true };
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
    const method = await fetch(`${baseUrl}/api/v1/admin/operations/default-recharge-method`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ method: 'BROWSER', confirmation: '切换默认充值方式为 BROWSER' })
    });
    assert.equal(method.status, 200);
    const permit = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-DEMO/recharge-permit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ action: 'arm', confirmation: '确认充值 PJV1-DEMO' })
    });
    assert.equal(permit.status, 404);
    assert.deepEqual(received, [
      ['intake', { enabled: true, confirmation: '开始接单' }],
      ['method', { method: 'BROWSER', actorId: 'admin', confirmation: '切换默认充值方式为 BROWSER' }]
    ]);
  });
});

test('exposes reconciliation cases and safe CSV operations; batch authorization and delivery routes are gone', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 21) }),
    sessionSecret: Buffer.alloc(32, 22), secureCookies: false
  });
  const received = {};
  const app = createApp({
    adminAuth,
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

    for (const gone of ['recharge-authorizations', 'cdks/deliveries', 'orders/PJV2-1/compensation', 'orders/PJV2-1/tags',
      'orders/PJV2-1/notes', 'card-stock/threshold', 'card-stock/replenishment-settings', 'step-up']) {
      const response = await fetch(`${baseUrl}/api/v1/admin/${gone}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sensitiveCookie, Origin: baseUrl }, body: '{}'
      });
      assert.equal(response.status, 404, gone);
    }
    assert.equal(received.authorization, undefined);

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

test('keeps Browser timelines read-only and requires same-origin for control transfer', async () => {
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

test('closes an open internal alert through the guarded admin route without step-up', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 14) }),
    sessionSecret: Buffer.alloc(32, 15),
    secureCookies: false
  });
  const closed = [];
  const app = createApp({
    adminAuth,
    closeAdminAlert: async (alertId) => { closed.push(alertId); return { alertId, closed: alertId === 'alert-1' }; }
  });
  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/admin/alerts/alert-1/close`, { method: 'POST' });
    assert.equal(denied.status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const sessionCookie = login.headers.get('set-cookie').split(';')[0];
    const ok = await fetch(`${baseUrl}/api/v1/admin/alerts/alert-1/close`, {
      method: 'POST', headers: { Cookie: sessionCookie, Origin: baseUrl }
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { alertId: 'alert-1', closed: true });
    const missing = await fetch(`${baseUrl}/api/v1/admin/alerts/alert-9/close`, {
      method: 'POST', headers: { Cookie: sessionCookie, Origin: baseUrl }
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(closed, ['alert-1', 'alert-9']);
  });
});

test('backup card snapshot import commits with the admin login alone and echoes the preview confirmation', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 7) }),
    sessionSecret: Buffer.alloc(32, 8),
    secureCookies: false
  });
  let committed = null;
  const app = createApp({
    adminAuth,
    previewManualCardImport: async () => ({
      sourceName: '备用卡台 A', rowCount: 2, confirmation: '确认提交 2 张卡的完整快照', rows: [], commitAllowed: true
    }),
    commitManualCardImport: async (input) => {
      if (input.confirmation !== '确认提交 2 张卡的完整快照') throw new PublicApiError('import confirmation mismatch', { code: 'MANUAL_CARD_IMPORT_CONFIRMATION_REQUIRED', status: 400 });
      committed = input;
      return { batchId: 'batch-fixture', rowCount: 2 };
    }
  });
  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const body = { providerAccountId: 'backup-a', filename: 'cards.xlsx', fileBase64: 'AAAA' };
    const preview = await fetch(`${baseUrl}/api/v1/admin/manual-cards/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify(body)
    });
    assert.equal(preview.status, 200);
    const { confirmation } = await preview.json();

    // A mistyped word is still rejected server-side with a specific code the UI can explain.
    const mismatch = await fetch(`${baseUrl}/api/v1/admin/manual-cards/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ ...body, confirmation: '确认提交2张卡的完整快照' })
    });
    assert.equal(mismatch.status, 400);
    assert.deepEqual(await mismatch.json(), { error: 'manual_card_import_confirmation_required' });
    assert.equal(committed, null);

    // No step-up (password) round trip: the login session authorizes the commit.
    const imported = await fetch(`${baseUrl}/api/v1/admin/manual-cards/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ ...body, confirmation })
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(await imported.json(), { batchId: 'batch-fixture', rowCount: 2 });
    assert.equal(committed.confirmation, '确认提交 2 张卡的完整快照');
    assert.equal(committed.requestedBy, 'admin');
  });
});

test('updates the minimum required card balance through the guarded admin route', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 25) }),
    sessionSecret: Buffer.alloc(32, 26), secureCookies: false
  });
  const writes = [];
  const app = createApp({
    adminAuth,
    getAdminCardStock: async () => ({ maxSuccessfulPayments: 3, minimumRequiredCardBalance: writes.at(-1) || '16.00' }),
    setAdminCardMinimumBalance: async (amount) => { const normalized = amount.toFixed(2); writes.push(normalized); return { minimumRequiredCardBalance: normalized }; }
  });
  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/admin/card-stock/minimum-balance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 8 })
    });
    assert.equal(denied.status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture admin password' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const invalid of [-1, 1000.01, 8.001, '8', null, true, Number.NaN]) {
      const response = await fetch(`${baseUrl}/api/v1/admin/card-stock/minimum-balance`, {
        method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: invalid })
      });
      assert.equal(response.status, 400, `amount ${String(invalid)} must be rejected`);
      assert.deepEqual(await response.json(), { error: 'invalid_minimum_balance' });
    }
    const updated = await fetch(`${baseUrl}/api/v1/admin/card-stock/minimum-balance`, {
      method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 8 })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { minimumRequiredCardBalance: '8.00' });
    const stock = await fetch(`${baseUrl}/api/v1/admin/card-stock`, { headers: { Cookie: cookie } });
    assert.deepEqual(await stock.json(), { maxSuccessfulPayments: 3, minimumRequiredCardBalance: '8.00' });
  });
  assert.deepEqual(writes, ['8.00']);
});

test('order execution timeline is readable by an authenticated administrator only', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 27) }),
    sessionSecret: Buffer.alloc(32, 28), secureCookies: false
  });
  const app = createApp({
    adminAuth,
    getAdminOrderTimeline: async (publicNo) => ({ publicNo, events: [{ at: '2026-09-07T09:29:15.000Z', sequence: 1, type: 'intent', action: 'observe-page', jobKind: 'run', runId: 'run-1', workerId: 'pool:lane-3', facts: {} }] })
  });
  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-TIMELINE/timeline`);
    assert.equal(denied.status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture admin password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${baseUrl}/api/v1/admin/orders/PJV1-TIMELINE/timeline`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.publicNo, 'PJV1-TIMELINE');
    assert.equal(body.events[0].action, 'observe-page');
  });
});

test('the two home-page decision switches are guarded, boolean-only and audited through their services', async () => {
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword('fixture admin password', { salt: Buffer.alloc(16, 29) }),
    sessionSecret: Buffer.alloc(32, 30), secureCookies: false
  });
  const calls = [];
  const app = createApp({
    adminAuth,
    setAdminBrowserPaymentWrites: async (input) => { calls.push(['payment', input]); return { browserPaymentWritesEnabled: input.enabled, previous: !input.enabled, executorProfilesUpdated: 1 }; },
    setAdminSupplyAutomation: async (input) => { calls.push(['supply', input]); return { supplyAutomationEnabled: input.enabled, cardAutoReplenishmentEnabled: input.enabled, cardBalanceRechargeEnabled: input.enabled }; }
  });
  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/admin/operations/browser-payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.equal(denied.status, 401);
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture admin password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const path of ['browser-payment', 'supply-automation']) {
      const bad = await fetch(`${baseUrl}/api/v1/admin/operations/${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'true' }) });
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { error: 'invalid_operation_state' });
      const ok = await fetch(`${baseUrl}/api/v1/admin/operations/${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
      assert.equal(ok.status, 200);
    }
  });
  assert.deepEqual(calls.map(([name, input]) => [name, input.enabled, input.actorId]), [['payment', false, 'admin'], ['supply', false, 'admin']]);
});
