import { createHash, randomUUID } from 'node:crypto';

import { SessionProviderPort } from './ports.js';
import { assertRef, assertSessionLease, ContractError } from './contracts.js';
import { listSessionCookies, clearSessionCookies, clearStaleLoginCookies } from './session-bootstrap.js';
import { extensionIdFromPath } from './extension-session-runtime.js';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

// The session-loader extension ("上号器") is loaded into every BitBrowser
// identity via --load-extension at this fixed path (see docs/HANDOFF_LOG.md
// 2026-09-07 "上号器装入全部 BitBrowser 身份"); Chromium derives the unpacked
// extension's id deterministically from this absolute path.
const DEFAULT_EXTENSION_PATH = '/Users/lemon/Library/Application Support/BitBrowser/BitExtensions/384ef55b-0fc0-4462-84a7-7a0162c5e115';

/**
 * SessionProviderPort implementation that drives the already-installed
 * "上号器" (session-loader) browser extension's popup instead of writing
 * cookies directly. Same external contract as CookieSessionBootstrapAdapter
 * (open/bootstrap/clearSession/close return the same shapes) so the executor
 * needs no changes to use either provider.
 *
 * This is a comparison adapter, not a presumed fix. The bundled extension
 * clears login cookies and closes/reopens ChatGPT tabs; its manifest and code
 * do not establish localStorage, IndexedDB or service-worker cleanup.
 * Existing sessions are preserved unless replacement is explicitly requested.
 * Selecting EXTENSION therefore does not prove the popup ran: inspect the
 * bootstrap result (viaExtension / existingSessionPreserved) for that attempt.
 */
export class ExtensionSessionBootstrapAdapter extends SessionProviderPort {
  constructor({ source, extensionPath = DEFAULT_EXTENSION_PATH, clock = () => Date.now(), timeoutMs = 15_000 } = {}) {
    super();
    if (!source || typeof source.load !== 'function') throw new TypeError('session source.load is required');
    if (typeof extensionPath !== 'string' || extensionPath.length === 0) throw new TypeError('extensionPath is required');
    this.source = source;
    this.extensionPath = extensionPath;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.leases = new Map();
  }

  async open(sessionRef, { purpose = 'browser-observe', ttlMs = 60_000 } = {}) {
    assertRef(sessionRef, 'sessionRef');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new TypeError('ttlMs must be at least 1000ms');
    const material = await this.source.load(sessionRef);
    const raw = typeof material === 'string' ? material : JSON.stringify(material ?? null);
    if (!raw || raw === '{}' || raw === 'null' || raw === '""') {
      throw new ContractError('session source did not provide session material');
    }
    const lease = {
      leaseId: `session-lease:${randomUUID()}`,
      sessionDigest: digest(raw),
      expiresAt: this.clock() + ttlMs,
      purpose,
    };
    assertSessionLease(lease);
    this.leases.set(lease.leaseId, { expiresAt: lease.expiresAt, raw });
    return lease;
  }

  async bootstrap(sessionLease, context, { replaceExisting = false } = {}) {
    assertSessionLease(sessionLease);
    if (!context || typeof context.newPage !== 'function'
      || typeof context.cookies !== 'function' || typeof context.clearCookies !== 'function') {
      throw new TypeError('BrowserContext page/cookie methods are required');
    }
    const entry = this.leases.get(sessionLease.leaseId);
    if (!entry || entry.expiresAt <= this.clock()) throw new ContractError('session lease is expired or unknown');
    const staleSessionCookies = await listSessionCookies(context);
    // Same non-destructive default as CookieSessionBootstrapAdapter: never
    // replay a submitted session over an already-authenticated Profile unless
    // the caller has confirmed (via identity probe) that it belongs to someone
    // else or is dead.
    if (staleSessionCookies.length > 0 && !replaceExisting) {
      return {
        cookieCount: staleSessionCookies.length,
        replacedCookieCount: 0,
        existingSessionPreserved: true,
        sessionDigest: sessionLease.sessionDigest,
      };
    }
    const extensionId = extensionIdFromPath(this.extensionPath);
    const popup = await context.newPage();
    let chatPage = null;
    try {
      await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      const tokenField = popup.locator('#sessionToken');
      const loginButton = popup.locator('#loginButton');
      if (await tokenField.count() !== 1 || await loginButton.count() !== 1) {
        throw new ContractError('extension popup controls were not found (extension not loaded or a different version)');
      }
      await tokenField.fill(entry.raw);
      const waitForChatGpt = context.waitForEvent('page', { timeout: this.timeoutMs }).catch(() => null);
      await loginButton.click();
      const status = popup.locator('#statusMessage');
      await status.waitFor({ state: 'visible', timeout: this.timeoutMs }).catch(() => undefined);
      // On success the popup calls window.close() itself; on failure it stays
      // open with #statusMessage[data-tone="error"] (extensions/nuohuisheng-
      // session-loader/popup.js). Only read the tone while it is still open.
      if (!popup.isClosed()) {
        const tone = await status.getAttribute('data-tone').catch(() => null);
        if (tone === 'error') {
          const text = await status.textContent().catch(() => '');
          throw new ContractError(`extension session bootstrap failed: ${(text || '').trim()}`);
        }
      }
      chatPage = await waitForChatGpt;
      if (!chatPage) throw new ContractError('extension did not open ChatGPT after writing the session');
    } finally {
      if (!popup.isClosed()) await popup.close().catch(() => undefined);
    }
    const finalCookies = await listSessionCookies(context);
    return {
      cookieCount: finalCookies.length,
      replacedCookieCount: staleSessionCookies.length,
      clearedLoginCookieCount: staleSessionCookies.length,
      existingSessionPreserved: false,
      sessionDigest: sessionLease.sessionDigest,
      viaExtension: true,
    };
  }

  /** Terminal release of an identity: same as CookieSessionBootstrapAdapter — drop
   * the ChatGPT session and login-state cookies; device/network cookies stay.
   * Teardown does not need the extension: it only ever adds a session, it does
   * not need to be involved in removing one. */
  async clearSession(context) {
    if (!context || typeof context.cookies !== 'function' || typeof context.clearCookies !== 'function') {
      throw new TypeError('BrowserContext cookie read/write methods are required');
    }
    const stale = await listSessionCookies(context);
    if (stale.length > 0) await clearSessionCookies(context);
    const clearedLoginCookieCount = await clearStaleLoginCookies(context);
    return { clearedCookieCount: stale.length, clearedLoginCookieCount };
  }

  async close(sessionLease) {
    assertSessionLease(sessionLease);
    this.leases.delete(sessionLease.leaseId);
  }
}

export { DEFAULT_EXTENSION_PATH };
