import assert from 'node:assert/strict';
import test from 'node:test';
import { BitBrowserControlRuntimeAdapter } from '../src/bitbrowser-control-runtime.js';

const manifest = { mode: 'BITBROWSER_CONTROL', capability: 'CHECKOUT_OBSERVE', allowWrites: false,
  profileDigest: 'a'.repeat(32), networkDigest: 'b'.repeat(32) };
const profileId = '10f0dc7b534844c083165796447d5893';

function fakeFetch(calls, { failOpen = false } = {}) {
  return async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(init.body) });
    if (path === '/health') return new Response(JSON.stringify({ success: true, data: 'the server is running good.' }), { status: 200 });
    if (path === '/browser/list') return new Response(JSON.stringify({ success: true, data: { list: [{ id: profileId, platform: 'https://chatgpt.com/' }] } }), { status: 200 });
    if (path === '/browser/open' && failOpen) return new Response(JSON.stringify({ success: false }), { status: 500 });
    if (path === '/browser/open') return new Response(JSON.stringify({ success: true, data: { http: '127.0.0.1:62388', ws: 'ws://127.0.0.1:62388/devtools/browser/test' } }), { status: 200 });
    if (path === '/browser/close') return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
    return new Response(JSON.stringify({ success: false }), { status: 404 });
  };
}

function fakeBrowser() {
  const closed = [];
  const pages = [{ close: async () => closed.push('old-1') }, { close: async () => closed.push('old-2') }];
  const keeper = { close: async () => closed.push('keeper') };
  const context = {
    close: async () => {},
    newPage: async () => { pages.push(keeper); return keeper; },
    pages: () => pages,
    closed,
  };
  return {
    contexts: () => [context],
    close: async () => { closed.push('browser-client'); },
    context,
  };
}

test('BitBrowser adapter opens an approved ChatGPT profile through CDP and closes it', async () => {
  const calls = [];
  const browser = fakeBrowser();
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId,
    browserType: { connectOverCDP: async (url) => { assert.equal(url, 'http://127.0.0.1:62388'); return browser; } },
    fetchImpl: fakeFetch(calls),
  });
  const runtime = await adapter.open(manifest, { profileRef: 'profile:database-uuid' });
  assert.equal(runtime.context, browser.context);
  assert.equal(runtime.profileRef, 'profile:database-uuid');
  assert.equal(runtime.bitbrowserProfileId, profileId);
  assert.deepEqual(browser.context.closed, []);
  await adapter.close(runtime);
  assert.deepEqual(calls.map((call) => call.path), ['/health', '/browser/list', '/browser/open', '/browser/close']);
});

test('BitBrowser adapter can detach automation without closing the persistent Profile', async () => {
  const calls = [];
  const browser = fakeBrowser();
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId,
    browserType: { connectOverCDP: async () => browser },
    fetchImpl: fakeFetch(calls),
  });
  const runtime = await adapter.open(manifest, { profileRef: 'profile:database-uuid' });
  await adapter.detach(runtime);
  assert.equal(runtime.detached, true);
  assert.equal(browser.context.closed.includes('browser-client'), true);
  assert.deepEqual(calls.map((call) => call.path), ['/health', '/browser/list', '/browser/open']);
});

test('BitBrowser adapter rejects an unapproved profile before opening it', async () => {
  const calls = [];
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: 'unknown-profile',
    browserType: { connectOverCDP: async () => { throw new Error('must not connect'); } },
    fetchImpl: fakeFetch(calls),
  });
  await assert.rejects(adapter.open(manifest, { profileRef: 'profile:database-uuid' }), /not in the approved profile list/);
  assert.deepEqual(calls.map((call) => call.path), ['/health', '/browser/list']);
});

test('BitBrowser adapter rejects write-capable manifests', async () => {
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId,
    browserType: { connectOverCDP: async () => fakeBrowser() },
    fetchImpl: fakeFetch([]),
  });
  await assert.rejects(adapter.open({ ...manifest, allowWrites: true }, { profileRef: profileId }), /allowWrites must be false|read-only/);
});

// D-407：/health 没应答 → 先拉起比特浏览器，再问一次；页面上什么都还没做。
function flakyHealthFetch(calls, { downTimes = 1, respondedFailure = false } = {}) {
  const base = fakeFetch(calls);
  let remaining = downTimes;
  return async (url, init) => {
    if (new URL(url).pathname === '/health') {
      if (respondedFailure) { calls.push({ path: '/health', body: {} }); return new Response(JSON.stringify({ success: false }), { status: 500 }); }
      if (remaining > 0) { remaining -= 1; calls.push({ path: '/health(down)', body: {} }); throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }
    }
    return base(url, init);
  };
}

test('D-407：比特浏览器没开 → 拉起后再试一次，照常打开窗口', async () => {
  const calls = []; let recovers = 0;
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId, browserType: { connectOverCDP: async () => fakeBrowser() },
    fetchImpl: flakyHealthFetch(calls), recover: async () => { recovers += 1; return { recovered: true, launched: true }; },
  });
  await adapter.open(manifest, { profileRef: 'profile:x' });
  assert.equal(recovers, 1);
  assert.deepEqual(calls.map((call) => call.path), ['/health(down)', '/health', '/browser/list', '/browser/open']);
});

test('D-407：拉起也没救回来 → 照旧抛原来的错，不开窗口', async () => {
  const calls = [];
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId, browserType: { connectOverCDP: async () => fakeBrowser() },
    fetchImpl: flakyHealthFetch(calls, { downTimes: 5 }), recover: async () => ({ recovered: false, reason: 'STILL_DOWN' }),
  });
  await assert.rejects(adapter.open(manifest, { profileRef: 'profile:x' }), /fetch failed/);
  assert.deepEqual(calls.map((call) => call.path), ['/health(down)']);
});

test('D-407：只重试一次——拉起说好了、再问还是不应答，就抛错', async () => {
  const calls = []; let recovers = 0;
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId, browserType: { connectOverCDP: async () => fakeBrowser() },
    fetchImpl: flakyHealthFetch(calls, { downTimes: 5 }), recover: async () => { recovers += 1; return { recovered: true }; },
  });
  await assert.rejects(adapter.open(manifest, { profileRef: 'profile:x' }), /fetch failed/);
  assert.equal(recovers, 1);
  assert.deepEqual(calls.map((call) => call.path), ['/health(down)', '/health(down)']);
});

test('D-407：比特浏览器应答了但说失败 → 不拉起（拉起解决不了），照旧抛错', async () => {
  const calls = []; let recovers = 0;
  const adapter = new BitBrowserControlRuntimeAdapter({
    bitbrowserProfileId: profileId, browserType: { connectOverCDP: async () => fakeBrowser() },
    fetchImpl: flakyHealthFetch(calls, { respondedFailure: true }), recover: async () => { recovers += 1; return { recovered: true }; },
  });
  await assert.rejects(adapter.open(manifest, { profileRef: 'profile:x' }), /BitBrowser \/health failed/);
  assert.equal(recovers, 0);
});
