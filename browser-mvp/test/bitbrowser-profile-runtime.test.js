import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BitBrowserLocalApiClient,
  BitBrowserProfilePoolRuntimeAdapter,
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

test('BitBrowser client classifies the daily Profile open limit without echoing vendor data', async () => {
  const client = new BitBrowserLocalApiClient({
    fetchImpl: async () => response({ success: false, msg: '今日打开窗口次数已达上限' }),
  });
  await assert.rejects(() => client.openProfile('bit-profile-001'), (error) => {
    assert.equal(error.code, 'BITBROWSER_DAILY_OPEN_LIMIT');
    assert.doesNotMatch(error.message, /今日|窗口次数/);
    return true;
  });
});

test('keep-alive runtime opens once, resets customer state between jobs, and physically closes on shutdown', async () => {
  const calls = [];
  const customerPage = {
    url: () => 'https://chatgpt.com/checkout/example',
    close: async () => calls.push('close-customer-page'),
  };
  const consolePage = { url: () => 'https://console.bitbrowser.net/?id=profile' };
  let pages = [consolePage, customerPage];
  const cdp = {
    send: async (method, input) => calls.push(`${method}:${input.origin}`),
    detach: async () => calls.push('detach-cdp'),
  };
  const context = {
    pages: () => pages,
    clearCookies: async ({ domain }) => {
      assert.ok(domain instanceof RegExp);
      calls.push('clear-customer-cookies');
      pages = [consolePage];
    },
    newCDPSession: async () => cdp,
  };
  const browser = {
    contexts: () => [context],
    isConnected: () => true,
    close: async () => calls.push('disconnect'),
  };
  const adapter = new BitBrowserProfileRuntimeAdapter({
    browserType: {
      connectOverCDP: async () => {
        calls.push('connect');
        return browser;
      },
    },
    apiClient: {
      health: async () => calls.push('health'),
      openProfile: async () => {
        calls.push('open');
        return { cdpEndpoint: 'http://127.0.0.1:61234/' };
      },
      closeProfile: async () => calls.push('close-profile'),
    },
    profileId: 'bit-profile-001',
    enabled: true,
    keepAlive: true,
  });

  const first = await adapter.open(createChromeControlManifest(), { profileRef: 'profile:run-001' });
  await adapter.close(first);
  const second = await adapter.open(createChromeControlManifest(), { profileRef: 'profile:run-002' });
  await adapter.close(second);
  await adapter.shutdown();

  assert.equal(calls.filter((value) => value === 'open').length, 1);
  assert.equal(calls.filter((value) => value === 'connect').length, 1);
  assert.equal(calls.filter((value) => value === 'close-profile').length, 1);
  assert.equal(calls.filter((value) => value === 'clear-customer-cookies').length, 3);
  assert.ok(calls.includes('close-customer-page'));
  assert.ok(calls.includes('Storage.clearDataForOrigin:https://chatgpt.com'));
  assert.ok(calls.includes('Storage.clearDataForOrigin:https://openai.com'));
});

test('customer reset preserves only Profile operational access cookies', async () => {
  const restored = [];
  const context = {
    pages: () => [{ url: () => 'https://console.bitbrowser.net/' }],
    cookies: async () => [
      { name: 'cf_clearance', value: 'profile-access', domain: '.chatgpt.com', path: '/', secure: true, httpOnly: true, sameSite: 'None' },
      { name: 'oai-did', value: 'profile-device', domain: '.chatgpt.com', path: '/', secure: true, sameSite: 'Lax' },
      { name: '__Secure-next-auth.session-token', value: 'customer-secret', domain: '.chatgpt.com', path: '/', secure: true, httpOnly: true },
      { name: 'unknown-cookie', value: 'customer-state', domain: '.chatgpt.com', path: '/' },
    ],
    clearCookies: async () => undefined,
    addCookies: async (cookies) => restored.push(...cookies),
  };
  const browser = { contexts: () => [context], isConnected: () => true, close: async () => undefined };
  const adapter = new BitBrowserProfileRuntimeAdapter({
    browserType: { connectOverCDP: async () => browser },
    apiClient: {
      health: async () => undefined,
      openProfile: async () => ({ cdpEndpoint: 'http://127.0.0.1:61234/' }),
      closeProfile: async () => undefined,
    },
    profileId: 'bit-profile-001', enabled: true, keepAlive: true,
  });
  const runtime = await adapter.open(createChromeControlManifest(), { profileRef: 'profile:run-001' });
  await adapter.close(runtime);
  await adapter.shutdown();
  assert.ok(restored.some((cookie) => cookie.name === 'cf_clearance'));
  assert.ok(restored.some((cookie) => cookie.name === 'oai-did'));
  assert.ok(restored.every((cookie) => !cookie.name.includes('session-token')));
  assert.ok(restored.every((cookie) => cookie.name !== 'unknown-cookie'));
});

test('keep-alive runtime fails closed and shuts down when customer isolation reset fails', async () => {
  const calls = [];
  const context = {
    pages: () => [{ url: () => 'https://console.bitbrowser.net/' }],
    clearCookies: async () => {
      calls.push('clear');
      if (calls.filter((value) => value === 'clear').length > 1) throw new Error('reset failed');
    },
  };
  const browser = {
    contexts: () => [context],
    isConnected: () => true,
    close: async () => calls.push('disconnect'),
  };
  const adapter = new BitBrowserProfileRuntimeAdapter({
    browserType: { connectOverCDP: async () => browser },
    apiClient: {
      health: async () => undefined,
      openProfile: async () => ({ cdpEndpoint: 'http://127.0.0.1:61234/' }),
      closeProfile: async () => calls.push('close-profile'),
    },
    profileId: 'bit-profile-001',
    enabled: true,
    keepAlive: true,
  });
  const runtime = await adapter.open(createChromeControlManifest(), { profileRef: 'profile:run-001' });
  await assert.rejects(() => adapter.close(runtime), (error) => error.code === 'BITBROWSER_ISOLATION_RESET_FAILED');
  assert.deepEqual(calls.slice(-2), ['close-profile', 'disconnect']);
});

test('Profile pool gives concurrent jobs different persistent Profiles and reuses released slots', async () => {
  const opened = [];
  const closed = [];
  const browsers = [];
  const consolePage = { url: () => 'https://console.bitbrowser.net/' };
  const apiClient = {
    health: async () => ({ ready: true }),
    openProfile: async (profileId) => {
      opened.push(profileId);
      return { cdpEndpoint: `http://127.0.0.1:${profileId.endsWith('1') ? 61001 : 61002}/` };
    },
    closeProfile: async (profileId) => closed.push(profileId),
  };
  const pool = new BitBrowserProfilePoolRuntimeAdapter({
    browserType: {
      connectOverCDP: async (endpoint) => {
        const context = {
          pages: () => [consolePage],
          clearCookies: async () => undefined,
        };
        const browser = {
          contexts: () => [context],
          isConnected: () => true,
          close: async () => undefined,
        };
        browsers.push({ endpoint, browser });
        return browser;
      },
    },
    apiClient,
    profileIds: ['bit-profile-001', 'bit-profile-002'],
    enabled: true,
  });
  const first = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-001' });
  const second = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-002' });
  assert.notEqual(first.vendorProfileId, second.vendorProfileId);
  await assert.rejects(
    () => pool.open(createChromeControlManifest(), { profileRef: 'profile:run-003' }),
    (error) => error.code === 'BITBROWSER_POOL_EXHAUSTED',
  );
  await pool.close(first);
  const third = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-003' });
  assert.equal(third.vendorProfileId, first.vendorProfileId);
  assert.equal(opened.filter((id) => id === first.vendorProfileId).length, 1);
  await pool.close(second);
  await pool.close(third);
  await pool.shutdown();
  assert.deepEqual(closed.sort(), ['bit-profile-001', 'bit-profile-002']);
});

test('six-Profile pool reserves six distinct lanes and rejects a seventh concurrent job', async () => {
  const profileIds = Array.from({ length: 6 }, (_, index) => `bit-profile-00${index + 1}`);
  const openCounts = new Map();
  const pool = new BitBrowserProfilePoolRuntimeAdapter({
    browserType: {
      connectOverCDP: async () => ({
        contexts: () => [{ pages: () => [], clearCookies: async () => undefined }],
        isConnected: () => true,
        close: async () => undefined,
      }),
    },
    apiClient: {
      health: async () => ({ ready: true }),
      openProfile: async (profileId) => {
        openCounts.set(profileId, (openCounts.get(profileId) || 0) + 1);
        return { cdpEndpoint: 'http://127.0.0.1:61234/' };
      },
      closeProfile: async () => undefined,
    },
    profileIds,
    enabled: true,
  });
  const runtimes = await Promise.all(profileIds.map((_, index) => (
    pool.open(createChromeControlManifest(), { profileRef: `profile:run-00${index + 1}` })
  )));
  assert.equal(new Set(runtimes.map((runtime) => runtime.vendorProfileId)).size, 6);
  await assert.rejects(
    () => pool.open(createChromeControlManifest(), { profileRef: 'profile:run-007' }),
    (error) => error.code === 'BITBROWSER_POOL_EXHAUSTED',
  );
  await Promise.all(runtimes.map((runtime) => pool.close(runtime)));
  const reused = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-reused' });
  assert.equal(openCounts.get(reused.vendorProfileId), 1);
  await pool.close(reused);
  await pool.shutdown();
});

test('Profile pool rejects a stale or forged handle without releasing the active lane', async () => {
  const pool = new BitBrowserProfilePoolRuntimeAdapter({
    browserType: {
      connectOverCDP: async () => ({
        contexts: () => [{ pages: () => [], clearCookies: async () => undefined }],
        isConnected: () => true,
        close: async () => undefined,
      }),
    },
    apiClient: {
      health: async () => ({ ready: true }),
      openProfile: async () => ({ cdpEndpoint: 'http://127.0.0.1:61234/' }),
      closeProfile: async () => undefined,
    },
    profileIds: ['bit-profile-001'],
    enabled: true,
  });
  const runtime = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-active' });
  await assert.rejects(
    () => pool.close({ ...runtime, profileRef: 'profile:run-forged' }),
    (error) => error.code === 'BITBROWSER_POOL_LEASE_MISMATCH',
  );
  await assert.rejects(
    () => pool.open(createChromeControlManifest(), { profileRef: 'profile:run-next' }),
    (error) => error.code === 'BITBROWSER_POOL_EXHAUSTED',
  );
  await pool.close(runtime);
  await pool.shutdown();
});

test('Profile pool reports partial shutdown failures after attempting every slot', async () => {
  const closed = [];
  const pool = new BitBrowserProfilePoolRuntimeAdapter({
    browserType: {
      connectOverCDP: async () => ({
        contexts: () => [{ pages: () => [], clearCookies: async () => undefined }],
        isConnected: () => true,
        close: async () => undefined,
      }),
    },
    apiClient: {
      health: async () => ({ ready: true }),
      openProfile: async (profileId) => ({ cdpEndpoint: `http://127.0.0.1:${profileId.endsWith('1') ? 61231 : 61232}/` }),
      closeProfile: async (profileId) => {
        closed.push(profileId);
        if (profileId.endsWith('1')) throw new Error('fixture close failure');
      },
    },
    profileIds: ['bit-profile-001', 'bit-profile-002'],
    enabled: true,
  });
  const first = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-1' });
  const second = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-2' });
  // shutdown is a process boundary and must try all slots even while leased.
  await assert.rejects(() => pool.shutdown(), (error) => error.code === 'BITBROWSER_POOL_SHUTDOWN_FAILED');
  assert.deepEqual(closed.sort(), ['bit-profile-001', 'bit-profile-002']);
  assert.ok(first && second);
});

test('one broken Profile is quarantined without blocking the remaining pool', async () => {
  const opened = [];
  const pool = new BitBrowserProfilePoolRuntimeAdapter({
    browserType: {
      connectOverCDP: async () => ({
        contexts: () => [{ pages: () => [], clearCookies: async () => undefined }],
        isConnected: () => true,
        close: async () => undefined,
      }),
    },
    apiClient: {
      health: async () => ({ ready: true }),
      openProfile: async (profileId) => {
        opened.push(profileId);
        if (profileId === 'bit-profile-broken') throw new BitBrowserRuntimeError('fixture', 'BITBROWSER_ATTACH_FAILED');
        return { cdpEndpoint: 'http://127.0.0.1:61234/' };
      },
      closeProfile: async () => undefined,
    },
    profileIds: ['bit-profile-broken', 'bit-profile-good-1', 'bit-profile-good-2'],
    enabled: true,
  });
  const first = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-1' });
  const second = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-2' });
  assert.deepEqual([first.vendorProfileId, second.vendorProfileId], ['bit-profile-good-1', 'bit-profile-good-2']);
  assert.equal(opened.filter((id) => id === 'bit-profile-broken').length, 1);
  await pool.close(first);
  await pool.close(second);
  await pool.shutdown();
});

test('a Profile whose customer cleanup fails is quarantined and cannot serve another order', async () => {
  let resetCount = 0;
  const pool = new BitBrowserProfilePoolRuntimeAdapter({
    browserType: {
      connectOverCDP: async () => ({
        contexts: () => [{
          pages: () => [],
          clearCookies: async () => {
            resetCount += 1;
            if (resetCount > 1) throw new Error('fixture isolation cleanup failure');
          },
        }],
        isConnected: () => true,
        close: async () => undefined,
      }),
    },
    apiClient: {
      health: async () => ({ ready: true }),
      openProfile: async () => ({ cdpEndpoint: 'http://127.0.0.1:61234/' }),
      closeProfile: async () => undefined,
    },
    profileIds: ['bit-profile-001'],
    enabled: true,
  });
  const runtime = await pool.open(createChromeControlManifest(), { profileRef: 'profile:run-1' });
  await assert.rejects(() => pool.close(runtime), (error) => error.code === 'BITBROWSER_ISOLATION_RESET_FAILED');
  await assert.rejects(
    () => pool.open(createChromeControlManifest(), { profileRef: 'profile:run-2' }),
    (error) => error.code === 'BITBROWSER_POOL_UNAVAILABLE',
  );
  await pool.shutdown();
});
