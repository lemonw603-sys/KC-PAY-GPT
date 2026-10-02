// D-414 补记十三第 4 条：从 highvcc.com 点书签回后台是跨站导航，SameSite=Strict 的会话 cookie
// 不随这一跳发出，服务器 302 到登录页。会话其实还有效时，登录页应自己用同源请求确认会话、
// 直接回 /admin（token 由 admin.js 既有流程保存），不再要求重输密码；会话无效时登录页一切照旧。
// 这里把真实的 login.js 放进 vm 里跑：先用桩子覆盖各个分支，再接上真服务器的会话接口跑一遍。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createApp } from '../src/app/create-app.js';
import { createAdminSessionAuth, hashAdminPassword } from '../src/security/admin-session.js';

const LOGIN_JS = fs.readFileSync(new URL('../public/admin/assets/login.js', import.meta.url), 'utf8');
const LOGIN_HTML = fs.readFileSync(new URL('../public/admin/login.html', import.meta.url), 'utf8');
const TOKEN = 'synthetic-highvcc-token.abc+/=';
const PENDING = 'highvcc-token-pending';
const MARK = 'admin-session-resume-at';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

// 在 vm 里加载一次登录页脚本。fetch 由调用方给（桩子或接真服务器的薄壳）。
function loadLoginPage({ hash = '', storage = memoryStorage(), fetch }) {
  const replaced = [];
  const urlWrites = [];
  const consoleLines = [];
  const fetchCalls = [];
  let submit = null;
  const elements = {
    '#login-form': { addEventListener: (type, fn) => { if (type === 'submit') submit = fn; } },
    '#password': { value: '' },
    '#login-button': { disabled: false, textContent: '登录后台 →' },
    '#login-notice': { textContent: '', hidden: true, focus() {} }
  };
  const record = (...args) => consoleLines.push(args.map(String).join(' '));
  const ctx = {
    location: { hash, pathname: '/admin/login', search: '', replace: (url) => replaced.push(url) },
    history: { replaceState: (_state, _title, url) => urlWrites.push(url) },
    sessionStorage: storage,
    document: { querySelector: (selector) => elements[selector] },
    console: { log: record, info: record, warn: record, error: record, debug: record },
    fetch: async (url, options) => { fetchCalls.push({ url, options }); return fetch(url, options); }
  };
  ctx.window = ctx;
  vm.runInNewContext(LOGIN_JS, ctx);
  return {
    replaced, urlWrites, consoleLines, fetchCalls, elements, storage,
    async submitPassword(password) {
      elements['#password'].value = password;
      await submit({ preventDefault() {} });
    }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const jsonResponse = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('login page cache-busts the changed script', () => {
  assert.match(LOGIN_HTML, /\/admin\/assets\/login\.js\?v=4"/);
});

test('token arrives cross-site with a still-valid session: goes straight back to /admin without a password', async () => {
  const page = loadLoginPage({
    hash: `#highvcc-token=${encodeURIComponent(TOKEN)}`,
    fetch: async () => jsonResponse(200, { authenticated: true })
  });
  await settle();
  assert.equal(page.storage.getItem(PENDING), TOKEN, 'token handed to admin.js through the existing stash');
  assert.deepEqual(page.urlWrites, ['/admin/login'], 'fragment cleared from the address bar');
  assert.equal(page.fetchCalls.length, 1);
  assert.equal(page.fetchCalls[0].url, '/api/v1/admin/session');
  assert.equal(page.fetchCalls[0].options.method, undefined, 'read-only GET');
  assert.equal(page.fetchCalls[0].options.body, undefined);
  assert.equal(page.fetchCalls[0].options.credentials, 'same-origin');
  assert.deepEqual(page.replaced, ['/admin']);
  assert.ok(Number(page.storage.getItem(MARK)) > 0, 'loop guard marked before leaving');
  const everything = JSON.stringify([page.fetchCalls, page.replaced, page.urlWrites, page.consoleLines]);
  assert.equal(everything.includes(TOKEN) || everything.includes(encodeURIComponent(TOKEN)), false, 'token never leaves sessionStorage');
  assert.deepEqual(page.consoleLines, []);
});

test('token arrives but the session is invalid: login page behaves as before and the token survives the login', async () => {
  const calls = [];
  const page = loadLoginPage({
    hash: `#highvcc-token=${encodeURIComponent(TOKEN)}`,
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      if (options.method === 'POST') return { status: 204, ok: true, json: async () => ({}) };
      return jsonResponse(401, { error: 'admin_auth_required' });
    }
  });
  await settle();
  assert.deepEqual(page.replaced, [], 'stays on the password form');
  assert.equal(page.storage.getItem(PENDING), TOKEN);
  assert.equal(page.storage.getItem(MARK), null);
  await page.submitPassword('a long enough password');
  assert.deepEqual(calls, [
    { url: '/api/v1/admin/session', method: 'GET' },
    { url: '/api/v1/admin/session', method: 'POST' }
  ]);
  assert.deepEqual(page.replaced, ['/admin']);
  assert.equal(page.storage.getItem(PENDING), TOKEN, 'admin.js picks it up after login');
  assert.equal(page.elements['#password'].value, '');
});

test('plain visit without a token never asks about the session', async () => {
  const page = loadLoginPage({ fetch: async () => { throw new Error('must not be called'); } });
  await settle();
  assert.deepEqual(page.fetchCalls, []);
  assert.deepEqual(page.replaced, []);
  assert.deepEqual(page.urlWrites, []);
});

for (const [name, fetch] of [
  ['network failure', async () => { throw new TypeError('Failed to fetch'); }],
  ['200 without authenticated:true', async () => jsonResponse(200, { authenticated: false })],
  ['200 with a non-JSON body', async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('bad'); } })],
  ['server error', async () => jsonResponse(503, { error: 'x' })]
]) {
  test(`session check ${name}: stays on the password form`, async () => {
    const page = loadLoginPage({ hash: `#highvcc-token=${TOKEN}`, fetch });
    await settle();
    assert.deepEqual(page.replaced, []);
    assert.equal(page.storage.getItem(MARK), null);
    assert.deepEqual(page.consoleLines, []);
  });
}

test('bounced straight back from /admin: does not redirect again (no loop); an old mark is ignored', async () => {
  const recent = loadLoginPage({
    storage: memoryStorage({ [PENDING]: TOKEN, [MARK]: String(Date.now() - 2000) }),
    fetch: async () => jsonResponse(200, { authenticated: true })
  });
  await settle();
  assert.deepEqual(recent.fetchCalls, []);
  assert.deepEqual(recent.replaced, []);
  assert.equal(recent.storage.getItem(MARK), null, 'mark consumed');
  assert.equal(recent.storage.getItem(PENDING), TOKEN);

  const stale = loadLoginPage({
    storage: memoryStorage({ [PENDING]: TOKEN, [MARK]: String(Date.now() - 10 * 60 * 1000) }),
    fetch: async () => jsonResponse(200, { authenticated: true })
  });
  await settle();
  assert.equal(stale.fetchCalls.length, 1);
  assert.deepEqual(stale.replaced, ['/admin']);
});

test('sessionStorage unavailable: no session check, form unchanged', async () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const page = loadLoginPage({ hash: `#highvcc-token=${TOKEN}`, storage: broken, fetch: async () => jsonResponse(200, { authenticated: true }) });
  await settle();
  assert.deepEqual(page.fetchCalls, []);
  assert.deepEqual(page.replaced, []);
});

// 接上真的 createApp + 会话签发：服务器侧一行没改，登录页靠的就是既有的 GET /api/v1/admin/session。
// 浏览器在跨站那一跳不带 Strict cookie（这里不带 Cookie 头来模拟），本页的同源请求会带（薄壳补上 Cookie 头）。
async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('against the real session routes: valid session resumes, expired session falls back to the password', async () => {
  const password = 'fixture admin password';
  let nowMs = Date.parse('2026-10-02T00:00:00.000Z');
  const adminAuth = createAdminSessionAuth({
    passwordHash: await hashAdminPassword(password, { salt: Buffer.alloc(16, 4) }),
    sessionSecret: Buffer.alloc(32, 6),
    now: () => nowMs
  });
  const app = createApp({ adminAuth });
  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/v1/admin/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
    });
    assert.equal(login.status, 204);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /SameSite=Strict/, 'cookie policy unchanged');
    const sessionCookie = cookie.split(';')[0];

    // 跨站那一跳：浏览器不带 Strict cookie → 服务器门禁照旧送去登录页。
    const hop = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(hop.status, 302);
    assert.equal(hop.headers.get('location'), '/admin/login');

    const sent = [];
    const sameOriginFetch = (url, options = {}) => {
      sent.push({ url, body: options.body ?? null });
      return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options.headers || {}), Cookie: sessionCookie } });
    };

    const page = loadLoginPage({ hash: `#highvcc-token=${encodeURIComponent(TOKEN)}`, fetch: sameOriginFetch });
    await settle();
    assert.deepEqual(page.replaced, ['/admin']);
    assert.equal(page.storage.getItem(PENDING), TOKEN);
    // 本页回 /admin 是同站导航，cookie 照常带上 → GET /admin 的门禁（就是这个 authenticateRequest）放行。
    // 不直接请求 /admin：它走 sendFile，在 .claude/worktrees/ 这类带点的目录下会 404，结果随检出位置变。
    assert.equal(await adminAuth.authenticateRequest({ headers: { cookie: sessionCookie } }), true);

    // 12 小时会话过期后再来一次：会话接口 401，登录页照旧要密码，登录后同样回 /admin。
    nowMs += 13 * 60 * 60 * 1000;
    const expired = loadLoginPage({ hash: `#highvcc-token=${encodeURIComponent(TOKEN)}`, fetch: sameOriginFetch });
    await settle();
    assert.deepEqual(expired.replaced, []);
    assert.equal(expired.storage.getItem(PENDING), TOKEN);
    await expired.submitPassword(password);
    assert.deepEqual(expired.replaced, ['/admin']);

    assert.equal(sent.some(({ url, body }) => `${url}${body}`.includes(TOKEN) || `${url}${body}`.includes(encodeURIComponent(TOKEN))), false,
      'the token is never sent by the login page');
  });
});
