import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BitBrowserLocalApiClient,
  BitBrowserProfileRuntimeAdapter,
  BitBrowserRuntimeError,
} from '../src/bitbrowser-profile-runtime.js';
import { createChromeControlManifest } from '../src/fixtures.js';

function response(payload, { ok = true } = {}) {
  return { ok, json: async () => payload };
}

test('BitBrowser client uses only loopback health/open/close and extracts a loopback CDP endpoint', async () => {
  const calls = [];
  const client = new BitBrowserLocalApiClient({
    baseUrl: 'http://127.0.0.1:54345',
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) });
      if (url.endsWith('/browser/open')) {
        return response({ success: true, data: { http: '127.0.0.1:61234' } });
      }
      return response({ success: true, data: {} });
    },
  });

  assert.deepEqual(await client.health(), { ready: true });
  assert.deepEqual(await client.openProfile('bit-profile-001'), {
    cdpEndpoint: 'http://127.0.0.1:61234/',
  });
  assert.deepEqual(await client.closeProfile('bit-profile-001'), { closed: true });
  assert.deepEqual(calls.map(({ url, method, body }) => ({
    path: new URL(url).pathname, method, body,
  })), [
    { path: '/health', method: 'POST', body: {} },
    { path: '/browser/open', method: 'POST', body: { id: 'bit-profile-001' } },
    { path: '/browser/close', method: 'POST', body: { id: 'bit-profile-001' } },
  ]);
});

test('BitBrowser client rejects non-loopback API and CDP endpoints without echoing response data', async () => {
  assert.throws(() => new BitBrowserLocalApiClient({
    baseUrl: 'https://vendor.example/api?token=secret',
  }), (error) => error.code === 'BITBROWSER_NON_LOOPBACK_URL');

  const client = new BitBrowserLocalApiClient({
    fetchImpl: async () => response({
      success: true,
      data: { ws: 'ws://192.0.2.10:9222/devtools/browser/sensitive-profile' },
    }),
  });
  await assert.rejects(() => client.openProfile('bit-profile-001'), (error) => {
    assert.equal(error.code, 'BITBROWSER_NON_LOOPBACK_URL');
    assert.doesNotMatch(error.message, /sensitive-profile|192\.0\.2\.10/);
    return true;
  });
});

test('BitBrowser client closes a profile when open returns no usable CDP endpoint', async () => {
  const paths = [];
  const client = new BitBrowserLocalApiClient({
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname);
      return response({ success: true, data: {} });
    },
  });
  await assert.rejects(
    () => client.openProfile('bit-profile-001'),
    (error) => error.code === 'BITBROWSER_CDP_ENDPOINT_MISSING',
  );
  assert.deepEqual(paths, ['/browser/open', '/browser/close']);
});

test('BitBrowser runtime attaches one existing context and closes the vendor profile', async () => {
  const calls = [];
  const context = { pages: () => [] };
  const browser = {
    contexts: () => [context],
    close: async () => calls.push('disconnect'),
  };
  const adapter = new BitBrowserProfileRuntimeAdapter({
    browserType: {
      connectOverCDP: async (endpoint) => {
        calls.push(`connect:${endpoint}`);
        return browser;
      },
    },
    apiClient: {
      health: async () => calls.push('health'),
      openProfile: async (id) => {
        calls.push(`open:${id}`);
        return { cdpEndpoint: 'http://127.0.0.1:61234/' };
      },
      closeProfile: async (id) => calls.push(`close:${id}`),
    },
    profileId: 'bit-profile-001',
    enabled: true,
  });

  const runtime = await adapter.open(createChromeControlManifest(), { profileRef: 'profile:run-001' });
  assert.equal(runtime.context, context);
  assert.equal(runtime.profileRef, 'profile:run-001');
  assert.equal(runtime.vendorProfileId, 'bit-profile-001');
  await assert.rejects(
    () => adapter.open(createChromeControlManifest(), { profileRef: 'profile:run-002' }),
    (error) => error.code === 'BITBROWSER_PROFILE_BUSY',
  );
  await adapter.close(runtime);
  assert.deepEqual(calls, [
    'health', 'open:bit-profile-001', 'connect:http://127.0.0.1:61234/',
    'close:bit-profile-001', 'disconnect',
  ]);
});

test('BitBrowser runtime is disabled by default and cleans up a failed CDP attach', async () => {
  const apiCalls = [];
  const apiClient = {
    health: async () => apiCalls.push('health'),
    openProfile: async () => {
      apiCalls.push('open');
      return { cdpEndpoint: 'http://127.0.0.1:61234/' };
    },
    closeProfile: async () => apiCalls.push('close'),
  };
  const disabled = new BitBrowserProfileRuntimeAdapter({
    browserType: { connectOverCDP: async () => ({ contexts: () => [] }) },
    apiClient,
    profileId: 'bit-profile-001',
  });
  await assert.rejects(
    () => disabled.open(createChromeControlManifest(), { profileRef: 'profile:run-001' }),
    (error) => error instanceof BitBrowserRuntimeError && error.code === 'BITBROWSER_RUNTIME_DISABLED',
  );
  assert.deepEqual(apiCalls, []);

  const failing = new BitBrowserProfileRuntimeAdapter({
    browserType: { connectOverCDP: async () => { throw new Error('mock attach failure'); } },
    apiClient,
    profileId: 'bit-profile-001',
    enabled: true,
  });
  await assert.rejects(
    () => failing.open(createChromeControlManifest(), { profileRef: 'profile:run-001' }),
    (error) => error.code === 'BITBROWSER_ATTACH_FAILED',
  );
  assert.deepEqual(apiCalls, ['health', 'open', 'close']);
});

test('BitBrowser runtime rejects write-enabled manifests before starting a profile', async () => {
  const adapter = new BitBrowserProfileRuntimeAdapter({
    browserType: { connectOverCDP: async () => undefined },
    apiClient: {
      health: async () => undefined,
      openProfile: async () => undefined,
      closeProfile: async () => undefined,
    },
    profileId: 'bit-profile-001',
    enabled: true,
  });
  await assert.rejects(
    () => adapter.open({ ...createChromeControlManifest(), allowWrites: true }, {
      profileRef: 'profile:run-001',
    }),
    /allowWrites|read-only/,
  );
});
