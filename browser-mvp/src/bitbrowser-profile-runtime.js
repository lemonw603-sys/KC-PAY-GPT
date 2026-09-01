import { RuntimeAdapter } from './ports.js';
import { assertCohortManifest, assertRef, ContractError } from './contracts.js';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:54345';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

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
  constructor({ browserType, apiClient, profileId, enabled = false, connectOptions = {} } = {}) {
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
    this.connectOptions = { ...connectOptions };
    this.activeProfileRef = null;
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
      return {
        browser,
        context: contexts[0],
        profileRef: runProfileRef,
        vendorProfileId: this.profileId,
        cdpEndpoint,
        ownsContext: false,
      };
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
    let closeError = null;
    try {
      await this.apiClient.closeProfile(this.profileId);
    } catch (error) {
      closeError = error;
    }
    await runtime.browser.close().catch(() => undefined);
    this.activeProfileRef = null;
    if (closeError) {
      throw new BitBrowserRuntimeError('BitBrowser profile cleanup failed', 'BITBROWSER_CLEANUP_FAILED', closeError);
    }
  }
}

export { DEFAULT_API_BASE_URL };
