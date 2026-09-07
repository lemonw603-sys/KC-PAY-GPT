import { RuntimeAdapter } from './ports.js';
import { assertCohortManifest, assertRef, ContractError } from './contracts.js';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:54345';

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_API_BASE_URL));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('BitBrowser API URL must use http or https');
  return url.toString().replace(/\/$/, '');
}

async function readJson(response, endpoint) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`BitBrowser ${endpoint} returned invalid JSON`); }
  if (!response.ok || body?.success !== true) {
    throw new Error(`BitBrowser ${endpoint} failed`);
  }
  return body.data;
}

/**
 * BitBrowser Local API lane. It is deliberately read-only: the adapter only
 * opens/closes a pre-approved Profile and returns a CDP BrowserContext. It
 * exposes no payment or page-submit capability.
 */
export class BitBrowserControlRuntimeAdapter extends RuntimeAdapter {
  constructor({
    browserType,
    bitbrowserProfileId,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchImpl = globalThis.fetch,
    // BitBrowser may need several seconds to launch an already configured
    // Chromium profile. Ten seconds was shorter than the observed cold-open
    // path and caused false timeouts before CDP became available.
    timeoutMs = 20_000,
    // Resident identities are never closed by the worker: close() only drops
    // the CDP transport, exactly like detach(). Non-resident (legacy) mode
    // still calls /browser/close.
    residentProfile = false,
  } = {}) {
    super();
    if (!browserType || typeof browserType.connectOverCDP !== 'function') throw new TypeError('browserType.connectOverCDP is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new TypeError('timeoutMs must be between 1000 and 60000');
    this.browserType = browserType;
    this.bitbrowserProfileId = assertRef(bitbrowserProfileId, 'bitbrowserProfileId');
    this.apiBaseUrl = normalizeBaseUrl(apiBaseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.residentProfile = residentProfile === true;
  }

  async request(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      return await readJson(response, path);
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`BitBrowser ${path} timed out`, { cause: error });
      throw error;
    } finally { clearTimeout(timer); }
  }

  async open(manifest, { profileRef } = {}) {
    assertCohortManifest(manifest);
    if (manifest.mode !== 'BITBROWSER_CONTROL') throw new ContractError('BitBrowser adapter requires BITBROWSER_CONTROL mode');
    if (manifest.capability !== 'CHECKOUT_OBSERVE') throw new ContractError('BitBrowser adapter requires CHECKOUT_OBSERVE capability');
    if (manifest.allowWrites !== false) throw new ContractError('BitBrowser adapter is read-only');
    const logicalProfileRef = assertRef(profileRef, 'profileRef');
    const ref = this.bitbrowserProfileId;
    const health = await this.request('/health', {});
    if (typeof health !== 'string' && health !== undefined) throw new Error('BitBrowser health response is invalid');
    const listing = await this.request('/browser/list', { page: 0, pageSize: 100 });
    const profiles = Array.isArray(listing?.list) ? listing.list : [];
    const profile = profiles.find((item) => String(item?.id || '') === ref);
    if (!profile) throw new Error('BitBrowser Profile is not in the approved profile list');
    if (String(profile.platform || '').replace(/\/$/, '') !== 'https://chatgpt.com') throw new Error('BitBrowser Profile platform is not ChatGPT');
    let opened = false;
    let browser;
    try {
      const openedData = await this.request('/browser/open', { id: ref });
      if (!openedData?.http || !openedData?.ws) throw new Error('BitBrowser open response is incomplete');
      opened = true;
      browser = await this.browserType.connectOverCDP(`http://${openedData.http}`);
      const context = browser.contexts()[0];
      if (!context) throw new Error('BitBrowser CDP returned no BrowserContext');
      // Reconnecting to a persistent Profile must be non-destructive. Existing
      // pages can contain the active order's authenticated Checkout or 20X
      // handoff. Cross-customer cleanup belongs to the terminal order-release
      // lifecycle and must never be hidden inside open().
      return {
        browser,
        context,
        profileRef: logicalProfileRef,
        bitbrowserProfileId: ref,
        bitbrowserHttp: openedData.http,
        opened: true,
      };
    } catch (error) {
      if (browser) await browser.close().catch(() => undefined);
      if (opened) await this.request('/browser/close', { id: ref }).catch(() => undefined);
      throw error;
    }
  }

  async close(runtime) {
    if (!runtime?.context || !runtime?.profileRef || !runtime?.bitbrowserProfileId) {
      throw new TypeError('BitBrowser runtime handle is required');
    }
    if (this.residentProfile) return this.detach(runtime);
    await runtime.context.close().catch(() => undefined);
    if (runtime.browser) await runtime.browser.close().catch(() => undefined);
    await this.request('/browser/close', { id: runtime.bitbrowserProfileId }).catch(() => undefined);
  }

  /**
   * Relinquish automation ownership without closing the persistent Profile.
   * The one-shot Worker exits immediately after this call, which drops the CDP
   * transport while leaving the visible BitBrowser window for the operator.
   */
  async detach(runtime) {
    if (!runtime?.context || !runtime?.profileRef || !runtime?.bitbrowserProfileId) {
      throw new TypeError('BitBrowser runtime handle is required');
    }
    // connectOverCDP() gives this Browser object its own Playwright transport.
    // Closing that client disconnects CDP but does not call BitBrowser's
    // /browser/close endpoint and therefore does not terminate the Profile.
    if (runtime.browser) await runtime.browser.close().catch(() => undefined);
    runtime.detached = true;
  }
}

export { DEFAULT_API_BASE_URL };
