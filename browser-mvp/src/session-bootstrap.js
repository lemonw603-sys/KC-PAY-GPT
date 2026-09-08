import { createHash, randomUUID } from 'node:crypto';

import { SessionProviderPort } from './ports.js';
import { assertRef, assertSessionLease, ContractError } from './contracts.js';

const CHATGPT_URL = 'https://chatgpt.com';
const SESSION_COOKIE_BASE = '__Secure-next-auth.session-token';
const SESSION_COOKIE_CHUNK_SIZE = 3936;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCookieHeader(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return null;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!name || !value) return null;
      return { name, value };
    })
    .filter(Boolean);
}

function normalizeCookies(material) {
  if (typeof material === 'string') return parseCookieHeader(material);
  if (Array.isArray(material?.cookies)) return material.cookies.map((cookie) => ({ ...cookie })).filter((cookie) => cookie?.name && cookie?.value);
  if (typeof material?.cookieHeader === 'string') return parseCookieHeader(material.cookieHeader);
  if (typeof material?.sessionToken === 'string' && material.sessionToken.trim()) {
    const token = material.sessionToken.trim();
    if (token.length <= SESSION_COOKIE_CHUNK_SIZE) return [{ name: SESSION_COOKIE_BASE, value: token }];
    const chunks = [];
    for (let offset = 0, index = 0; offset < token.length; offset += SESSION_COOKIE_CHUNK_SIZE, index += 1) {
      chunks.push({ name: `${SESSION_COOKIE_BASE}.${index}`, value: token.slice(offset, offset + SESSION_COOKIE_CHUNK_SIZE) });
    }
    return chunks;
  }
  throw new ContractError('session source must provide cookieHeader or cookies');
}

const SESSION_COOKIE_NAME_PATTERN = /^__Secure-next-auth\.session-token(\.\d+)?$/;

async function listSessionCookies(context) {
  const cookies = await context.cookies(CHATGPT_URL);
  return cookies.filter((cookie) => SESSION_COOKIE_NAME_PATTERN.test(cookie.name));
}

// Cookies that describe the device / network path rather than the login:
// Cloudflare clearance and bot cookies, load balancer, ChatGPT device id,
// Stripe device id. Everything else on chatgpt.com is login state.
const DEVICE_COOKIE_NAME_PATTERN = /^(cf_clearance|__cf_bm|_cfuvid|__cflb|__oailb|oai-did|__stripe_mid)$/;

async function listStaleLoginCookies(context) {
  const cookies = await context.cookies(CHATGPT_URL);
  return cookies.filter((cookie) => !SESSION_COOKIE_NAME_PATTERN.test(cookie.name) && !DEVICE_COOKIE_NAME_PATTERN.test(cookie.name));
}

async function clearSessionCookies(context) {
  // The session token (and its chunks). Cloudflare/proxy/device cookies stay.
  await context.clearCookies({ name: SESSION_COOKIE_NAME_PATTERN });
}

// A new account's session paired with the previous account's client-auth
// cookies (oai-client-auth-info, oai-client-session-epoch, callback-url, ...)
// makes backend-api reject the access token ("Could not parse your
// authentication token", verified 2026-09-07 on Lane 2). So when one identity
// switches accounts, the whole previous login state goes, never the device.
export async function clearStaleLoginCookies(context) {
  const stale = await listStaleLoginCookies(context);
  for (const name of new Set(stale.map((cookie) => cookie.name))) await context.clearCookies({ name });
  return stale.length;
}

// Cookies the bootstrap is allowed to inject. Two layers matter after a
// subscription payment (D-136): the chatgpt.com APPLICATION session, and the
// auth.openai.com AUTH layer (usc_*, unified_session_manifest, oai-client-auth-*)
// that lets the front-end silently re-issue an application session when payment
// revokes the old one — the layer a bare /api/auth/session JSON export lacks.
const INJECTABLE_COOKIE_PATTERNS = [
  /^__Secure-next-auth\.session-token(\.\d+)?$/, // application session (chatgpt.com)
  /^__Secure-next-auth\.callback-url$/,
  /^__Host-next-auth\.csrf-token$/,
  /^usc_/, // persistent auth session (auth.openai.com)
  /^unified_session_manifest$/, // persistent auth manifest (auth.openai.com)
  /^oai-client-auth-session$/, // auth-layer client session
  /^oai-client-auth-info$/, // auth-layer client info
  /^oai-client-session-epoch$/,
  /^__Secure-oai-is$/,
];

function toPlaywrightCookie(cookie) {
  const name = String(cookie.name).trim();
  const value = String(cookie.value).replace(/[\r\n\0]/g, '').trim();
  if (!name || !value) throw new ContractError('session cookie name/value is required');
  if (!INJECTABLE_COOKIE_PATTERNS.some((pattern) => pattern.test(name))) {
    throw new ContractError(`session bootstrap does not inject cookie ${name}`);
  }
  const sameSite = cookie.sameSite === 'none' || cookie.sameSite === 'None'
    ? 'None'
    : (cookie.sameSite === 'strict' || cookie.sameSite === 'Strict' ? 'Strict' : 'Lax');
  // Playwright accepts {url} OR {domain,path}. A cross-site auth-layer cookie
  // (auth.openai.com) must use domain+path so it lands on the right host; the
  // app-layer cookies without a domain default to chatgpt.com.
  const host = cookie.domain ? String(cookie.domain).replace(/^\./, '') : null;
  const placement = host
    ? { domain: `.${host}`, path: cookie.path || '/' }
    : { url: CHATGPT_URL };
  const out = {
    name,
    value,
    ...placement,
    secure: cookie.secure !== false,
    httpOnly: cookie.httpOnly !== false,
    sameSite,
  };
  if (Number.isFinite(cookie.expires) && cookie.expires > 0) out.expires = cookie.expires;
  return out;
}

/**
 * Minimal Session Bootstrap implementation. Raw cookie material remains in
 * this adapter's private lease map and is never returned in the lease object.
 */
export class CookieSessionBootstrapAdapter extends SessionProviderPort {
  constructor({ source, clock = () => Date.now() } = {}) {
    super();
    if (!source || typeof source.load !== 'function') throw new TypeError('session source.load is required');
    this.source = source;
    this.clock = clock;
    this.leases = new Map();
  }

  async open(sessionRef, { purpose = 'browser-observe', ttlMs = 60_000 } = {}) {
    assertRef(sessionRef, 'sessionRef');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new TypeError('ttlMs must be at least 1000ms');
    const material = await this.source.load(sessionRef);
    const cookies = normalizeCookies(material).filter((cookie) => INJECTABLE_COOKIE_PATTERNS.some((pattern) => pattern.test(cookie.name)));
    if (!cookies.some((cookie) => SESSION_COOKIE_NAME_PATTERN.test(cookie.name))) {
      throw new ContractError('session source did not provide a ChatGPT session token cookie');
    }
    const serialized = JSON.stringify(cookies);
    const lease = {
      leaseId: `session-lease:${randomUUID()}`,
      sessionDigest: digest(serialized),
      expiresAt: this.clock() + ttlMs,
      purpose,
    };
    assertSessionLease(lease);
    this.leases.set(lease.leaseId, { expiresAt: lease.expiresAt, cookies: cookies.map(toPlaywrightCookie) });
    return lease;
  }

  async bootstrap(sessionLease, context, { replaceExisting = false } = {}) {
    assertSessionLease(sessionLease);
    if (!context || typeof context.addCookies !== 'function'
      || typeof context.cookies !== 'function' || typeof context.clearCookies !== 'function') {
      throw new TypeError('BrowserContext cookie read/write methods are required');
    }
    const entry = this.leases.get(sessionLease.leaseId);
    if (!entry || entry.expiresAt <= this.clock()) throw new ContractError('session lease is expired or unknown');
    const staleSessionCookies = await listSessionCookies(context);
    // By default do not overwrite an authenticated Profile: ChatGPT may rotate
    // its Session after login or purchase, so replaying the originally
    // submitted token can destroy a healthy session for the SAME customer.
    // The executor probes identity after bootstrap; only when that probe says
    // the resident session belongs to someone else (or is dead) does it call
    // back with replaceExisting=true, which is how one identity serves
    // customers one after another.
    if (staleSessionCookies.length > 0 && !replaceExisting) {
      return {
        cookieCount: staleSessionCookies.length,
        replacedCookieCount: 0,
        existingSessionPreserved: true,
        sessionDigest: sessionLease.sessionDigest,
      };
    }
    let clearedLoginCookieCount = 0;
    if (staleSessionCookies.length > 0) {
      await clearSessionCookies(context);
      clearedLoginCookieCount = await clearStaleLoginCookies(context);
    }
    await context.addCookies(entry.cookies);
    return {
      cookieCount: entry.cookies.length,
      replacedCookieCount: staleSessionCookies.length,
      clearedLoginCookieCount,
      existingSessionPreserved: false,
      sessionDigest: sessionLease.sessionDigest,
    };
  }

  /** Terminal release of an identity: drop the ChatGPT session and login-state cookies; device/network cookies stay. */
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
