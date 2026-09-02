import { RuntimeAdapter } from './ports.js';
import { assertCohortManifest, assertRef, ContractError } from './contracts.js';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:54345';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const PROFILE_SCOPED_START_FAILURES = new Set([
  'BITBROWSER_ATTACH_FAILED',
  'BITBROWSER_CONTEXT_CONFLICT',
  'BITBROWSER_ISOLATION_RESET_FAILED',
]);

export class BitBrowserRuntimeError extends Error {
  constructor(message, code, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BitBrowserRuntimeError';
    this.code = code;
  }
}

function loopbackUrl(value, label, protocols) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new BitBrowserRuntimeError(`${label} must be a valid URL`, 'BITBROWSER_INVALID_URL');
  }
  if (!protocols.includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username || url.password) {
    throw new BitBrowserRuntimeError(`${label} must use an allowed loopback URL`, 'BITBROWSER_NON_LOOPBACK_URL');
  }
  return url;
}

function normalizeCdpEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const endpoint = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  return loopbackUrl(endpoint, 'BitBrowser CDP endpoint', ['http:', 'https:', 'ws:', 'wss:']).toString();
}

function cdpEndpointFromResponse(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  for (const key of [
    'http', 'ws', 'cdp', 'cdpUrl', 'debuggingAddress', 'debuggerAddress',
    'wsEndpoint', 'webSocketDebuggerUrl',
  ]) {
    if (data?.[key]) return normalizeCdpEndpoint(data[key]);
  }
  throw new BitBrowserRuntimeError(
    'BitBrowser open response did not contain a supported CDP endpoint',
    'BITBROWSER_CDP_ENDPOINT_MISSING',
  );
}

function assertApiSuccess(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BitBrowserRuntimeError('BitBrowser Local API returned an invalid response', 'BITBROWSER_API_INVALID_RESPONSE');
  }
  if (payload.success === false || payload.code === -1 || payload.status === 'error') {
    if (String(payload.msg || '').trim() === '今日打开窗口次数已达上限') {
      throw new BitBrowserRuntimeError(
        'BitBrowser daily profile open limit was reached',
        'BITBROWSER_DAILY_OPEN_LIMIT',
      );
    }
    // Never include the vendor response body: profile metadata may be present.
    throw new BitBrowserRuntimeError('BitBrowser Local API rejected the request', 'BITBROWSER_API_REJECTED');
  }
  return payload;
}

export class BitBrowserLocalApiClient {
  constructor({ baseUrl = DEFAULT_API_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 60_000) {
      throw new TypeError('timeoutMs must be an integer between 250 and 60000');
    }
    const url = loopbackUrl(baseUrl, 'BitBrowser API URL', ['http:']);
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new BitBrowserRuntimeError('BitBrowser API URL must not contain a path, query, or fragment', 'BITBROWSER_INVALID_API_URL');
    }
    this.baseUrl = url.toString().replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #post(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response?.ok) {
        throw new BitBrowserRuntimeError('BitBrowser Local API returned a non-success HTTP status', 'BITBROWSER_API_HTTP_ERROR');
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new BitBrowserRuntimeError('BitBrowser Local API did not return JSON', 'BITBROWSER_API_INVALID_JSON', error);
      }
      return assertApiSuccess(payload);
    } catch (error) {
      if (error instanceof BitBrowserRuntimeError) throw error;
      const code = error?.name === 'AbortError' ? 'BITBROWSER_API_TIMEOUT' : 'BITBROWSER_API_UNAVAILABLE';
      throw new BitBrowserRuntimeError('BitBrowser Local API request failed', code, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    await this.#post('/health');
    return { ready: true };
  }

  async openProfile(profileId) {
    const id = assertRef(profileId, 'BitBrowser profileId');
    const payload = await this.#post('/browser/open', { id });
    try {
      return { cdpEndpoint: cdpEndpointFromResponse(payload) };
    } catch (error) {
      // /browser/open may already have started the profile even when its
      // response shape is unusable. Close by opaque ID before surfacing it.
      await this.closeProfile(id).catch(() => undefined);
      throw error;
    }
  }

  async closeProfile(profileId) {
    const id = assertRef(profileId, 'BitBrowser profileId');
    await this.#post('/browser/close', { id });
    return { closed: true };
  }
}

/**
 * Local BitBrowser profile lane. Queue/run/lease/payment state remains owned by
 * the shared core; this adapter only starts one preconfigured local profile and
 * exposes its existing BrowserContext over CDP.
 */
export class BitBrowserProfileRuntimeAdapter extends RuntimeAdapter {
  constructor({
    browserType,
    apiClient,
    profileId,
    enabled = false,
    keepAlive = false,
    connectOptions = {},
  } = {}) {
    super();
    if (!browserType || typeof browserType.connectOverCDP !== 'function') {
      throw new TypeError('browserType.connectOverCDP is required');
    }
    if (!apiClient || typeof apiClient.health !== 'function'
      || typeof apiClient.openProfile !== 'function' || typeof apiClient.closeProfile !== 'function') {
      throw new TypeError('apiClient with health/openProfile/closeProfile is required');
    }
    this.browserType = browserType;
    this.apiClient = apiClient;
    this.profileId = assertRef(profileId, 'BitBrowser profileId');
    this.enabled = enabled === true;
    this.keepAlive = keepAlive === true;
    this.connectOptions = { ...connectOptions };
    this.activeProfileRef = null;
    this.cachedRuntime = null;
  }

  async #resetCustomerState(runtime) {
    const context = runtime?.context;
    if (!context || typeof context.pages !== 'function') {
      throw new BitBrowserRuntimeError('BitBrowser context is unavailable', 'BITBROWSER_ISOLATION_RESET_FAILED');
    }
    const pages = context.pages();
    // Preserve only the local BitBrowser workspace tab. Every customer page is
    // closed between leases so no DOM, popup or Checkout can cross orders.
    await Promise.all(pages.map(async (page) => {
      let url = '';
      try { url = page.url(); } catch { return; }
      if (url.startsWith('https://console.bitbrowser.net/')) return;
      await page.close({ runBeforeUnload: false });
    }));
    if (typeof context.clearCookies !== 'function') {
      throw new BitBrowserRuntimeError('BitBrowser cookie reset is unavailable', 'BITBROWSER_ISOLATION_RESET_FAILED');
    }
    await context.clearCookies({ domain: /(^|\.)(chatgpt|openai)\.com$/i });
    let anchor = context.pages()[0];
    let temporaryAnchor = null;
    if (!anchor && typeof context.newPage === 'function') {
      temporaryAnchor = await context.newPage();
      anchor = temporaryAnchor;
    }
    if (anchor && typeof context.newCDPSession === 'function') {
      const session = await context.newCDPSession(anchor);
      try {
        for (const origin of [
          'https://chatgpt.com',
          'https://openai.com',
          'https://auth.openai.com',
          'https://platform.openai.com',
        ]) {
          await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
        }
      } finally {
        await session.detach().catch(() => undefined);
        await temporaryAnchor?.close?.({ runBeforeUnload: false }).catch(() => undefined);
      }
    } else if (temporaryAnchor) {
      await temporaryAnchor.close({ runBeforeUnload: false }).catch(() => undefined);
    }
  }

  async #physicalClose(runtime = this.cachedRuntime) {
    if (!runtime) return;
    let closeError = null;
    try {
      await this.apiClient.closeProfile(this.profileId);
    } catch (error) {
      closeError = error;
    }
    await runtime.browser?.close?.().catch(() => undefined);
    this.cachedRuntime = null;
    this.activeProfileRef = null;
    if (closeError) {
      throw new BitBrowserRuntimeError('BitBrowser profile cleanup failed', 'BITBROWSER_CLEANUP_FAILED', closeError);
    }
  }

  async checkHealth() {
    if (!this.enabled) {
      throw new BitBrowserRuntimeError('BitBrowser runtime is disabled', 'BITBROWSER_RUNTIME_DISABLED');
    }
    return this.apiClient.health();
  }

  async open(manifest, { profileRef } = {}) {
    assertCohortManifest(manifest);
    if (!this.enabled) throw new BitBrowserRuntimeError('BitBrowser runtime is disabled', 'BITBROWSER_RUNTIME_DISABLED');
    if (manifest.mode !== 'CHROME_CONTROL') throw new ContractError('BitBrowser profile runtime requires CHROME_CONTROL mode');
    if (manifest.capability !== 'CHECKOUT_OBSERVE') throw new ContractError('BitBrowser profile runtime requires CHECKOUT_OBSERVE capability');
    if (manifest.allowWrites !== false) throw new ContractError('BitBrowser profile runtime requires a read-only manifest');
    const runProfileRef = assertRef(profileRef, 'profileRef');
    if (this.activeProfileRef) {
      throw new BitBrowserRuntimeError('BitBrowser profile already has an active runtime lease', 'BITBROWSER_PROFILE_BUSY');
    }

    let browser = null;
    let profileStarted = false;
    this.activeProfileRef = runProfileRef;
    try {
      if (this.keepAlive && this.cachedRuntime) {
        if (this.cachedRuntime.browser?.isConnected?.() === false) {
          await this.#physicalClose(this.cachedRuntime).catch(() => undefined);
        } else {
          return { ...this.cachedRuntime, profileRef: runProfileRef };
        }
      }
      await this.apiClient.health();
      const { cdpEndpoint } = await this.apiClient.openProfile(this.profileId);
      profileStarted = true;
      browser = await this.browserType.connectOverCDP(cdpEndpoint, this.connectOptions);
      const contexts = browser.contexts();
      if (contexts.length !== 1) {
        throw new BitBrowserRuntimeError(
          'BitBrowser profile must expose exactly one BrowserContext',
          'BITBROWSER_CONTEXT_CONFLICT',
        );
      }
      const runtime = {
        browser,
        context: contexts[0],
        profileRef: runProfileRef,
        vendorProfileId: this.profileId,
        cdpEndpoint,
        ownsContext: false,
      };
      if (this.keepAlive) {
        await this.#resetCustomerState(runtime);
        this.cachedRuntime = { ...runtime, profileRef: null };
      }
      return runtime;
    } catch (error) {
      if (profileStarted) await this.apiClient.closeProfile(this.profileId).catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
      this.activeProfileRef = null;
      if (error instanceof ContractError || error instanceof BitBrowserRuntimeError) throw error;
      throw new BitBrowserRuntimeError('failed to attach to BitBrowser profile', 'BITBROWSER_ATTACH_FAILED', error);
    }
  }

  async close(runtime) {
    if (!runtime?.browser || runtime.vendorProfileId !== this.profileId) {
      throw new TypeError('BitBrowser runtime handle is required');
    }
    if (!this.keepAlive) return this.#physicalClose(runtime);
    if (runtime.profileRef !== this.activeProfileRef) {
      throw new BitBrowserRuntimeError('BitBrowser runtime lease does not match the active job', 'BITBROWSER_PROFILE_LEASE_MISMATCH');
    }
    try {
      await this.#resetCustomerState(runtime);
      this.activeProfileRef = null;
      return { released: true, keptAlive: true };
    } catch (error) {
      await this.#physicalClose(runtime).catch(() => undefined);
      if (error instanceof BitBrowserRuntimeError) throw error;
      throw new BitBrowserRuntimeError(
        'BitBrowser customer state reset failed',
        'BITBROWSER_ISOLATION_RESET_FAILED',
        error,
      );
    }
  }

  async interrupt(runtime) {
    if (!this.keepAlive) return this.close(runtime);
    if (!runtime || runtime.profileRef !== this.activeProfileRef) return;
    // Interrupt page waits immediately but retain the logical slot until the
    // executor reaches its awaited finally/close boundary.
    await Promise.all(runtime.context.pages().map(async (page) => {
      let url = '';
      try { url = page.url(); } catch { return; }
      if (!url.startsWith('https://console.bitbrowser.net/')) {
        await page.close({ runBeforeUnload: false }).catch(() => undefined);
      }
    }));
  }

  /** Physical process-shutdown hook. Logical job close keeps the Profile warm. */
  async shutdown() {
    await this.#physicalClose();
    return { closed: true };
  }
}

/**
 * In-process pool for 1-6 isolated, persistent BitBrowser Profiles. A slot is
 * synchronously reserved before any await, so concurrent job claims cannot
 * receive the same BrowserContext.
 */
export class BitBrowserProfilePoolRuntimeAdapter extends RuntimeAdapter {
  constructor({ browserType, apiClient, profileIds, enabled = false, connectOptions = {} } = {}) {
    super();
    if (!Array.isArray(profileIds) || profileIds.length < 1 || profileIds.length > 6) {
      throw new TypeError('profileIds must contain between 1 and 6 Profiles');
    }
    const normalized = profileIds.map((id) => assertRef(id, 'BitBrowser profileId'));
    if (new Set(normalized).size !== normalized.length) throw new TypeError('profileIds must be unique');
    this.apiClient = apiClient;
    this.slots = normalized.map((profileId, index) => ({
      index,
      reserved: false,
      leaseRef: null,
      quarantined: false,
      adapter: new BitBrowserProfileRuntimeAdapter({
        browserType,
        apiClient,
        profileId,
        enabled,
        keepAlive: true,
        connectOptions,
      }),
    }));
  }

  async checkHealth() {
    return this.apiClient.health();
  }

  async open(manifest, options = {}) {
    const candidates = this.slots.filter((candidate) => !candidate.reserved && !candidate.quarantined);
    if (!candidates.length) {
      const hasBusyHealthySlot = this.slots.some((candidate) => candidate.reserved && !candidate.quarantined);
      throw new BitBrowserRuntimeError(
        hasBusyHealthySlot ? 'all BitBrowser Profile slots are busy' : 'no healthy BitBrowser Profile slot is available',
        hasBusyHealthySlot ? 'BITBROWSER_POOL_EXHAUSTED' : 'BITBROWSER_POOL_UNAVAILABLE',
      );
    }
    let lastError = null;
    for (const slot of candidates) {
      slot.reserved = true;
      try {
        const runtime = await slot.adapter.open(manifest, options);
        slot.leaseRef = runtime.profileRef;
        return { ...runtime, poolSlot: slot.index };
      } catch (error) {
        slot.reserved = false;
        slot.leaseRef = null;
        // The daily open cap is account-wide; probing every slot would only
        // consume time and repeat the same vendor rejection.
        if (!PROFILE_SCOPED_START_FAILURES.has(error?.code)) throw error;
        slot.quarantined = true;
        lastError = error;
      }
    }
    throw new BitBrowserRuntimeError(
      'every available BitBrowser Profile failed to start and was quarantined',
      'BITBROWSER_POOL_UNAVAILABLE',
      lastError,
    );
  }

  async close(runtime) {
    const slot = this.slots[runtime?.poolSlot];
    if (!slot || !slot.reserved || !runtime?.profileRef
      || runtime.profileRef !== slot.leaseRef
      || runtime.vendorProfileId !== slot.adapter.profileId) {
      throw new BitBrowserRuntimeError('BitBrowser pool lease is invalid', 'BITBROWSER_POOL_LEASE_MISMATCH');
    }
    let releasedCleanly = false;
    try {
      const result = await slot.adapter.close(runtime);
      releasedCleanly = true;
      return result;
    } finally {
      slot.reserved = false;
      slot.leaseRef = null;
      if (!releasedCleanly) slot.quarantined = true;
    }
  }


  async interrupt(runtime) {
    const slot = this.slots[runtime?.poolSlot];
    if (!slot || !slot.reserved || runtime?.profileRef !== slot.leaseRef
      || runtime.vendorProfileId !== slot.adapter.profileId) return;
    await slot.adapter.interrupt(runtime);
  }

  async shutdown() {
    const results = await Promise.allSettled(this.slots.map((slot) => slot.adapter.shutdown()));
    for (const slot of this.slots) {
      slot.reserved = false;
      slot.leaseRef = null;
      slot.quarantined = false;
    }
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      throw new BitBrowserRuntimeError(
        `failed to shut down ${failures.length} BitBrowser Profile slot(s)`,
        'BITBROWSER_POOL_SHUTDOWN_FAILED',
        new AggregateError(failures.map((result) => result.reason)),
      );
    }
    return { closed: true };
  }
}

export { DEFAULT_API_BASE_URL };
