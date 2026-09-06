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
