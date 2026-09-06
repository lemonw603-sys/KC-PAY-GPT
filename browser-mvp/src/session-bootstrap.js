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

function toPlaywrightCookie(cookie) {
  const name = String(cookie.name).trim();
  const value = String(cookie.value).replace(/[\r\n\0]/g, '').trim();
  if (!name || !value) throw new ContractError('session cookie name/value is required');
  if (!name.includes('session-token') && !name.startsWith('__Secure-')) {
    throw new ContractError('session bootstrap accepts only secure ChatGPT session cookies');
  }
  return {
    name,
    value,
    url: CHATGPT_URL,
    secure: true,
    httpOnly: cookie.httpOnly !== false,
    sameSite: cookie.sameSite === 'none' ? 'None' : 'Lax',
  };
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
    const cookies = normalizeCookies(material).filter((cookie) => cookie.name === SESSION_COOKIE_BASE || cookie.name.startsWith(`${SESSION_COOKIE_BASE}.`));
    if (cookies.length === 0) {
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

  async bootstrap(sessionLease, context) {
    assertSessionLease(sessionLease);
    if (!context || typeof context.addCookies !== 'function'
      || typeof context.cookies !== 'function' || typeof context.clearCookies !== 'function') {
      throw new TypeError('BrowserContext cookie read/write methods are required');
    }
    const entry = this.leases.get(sessionLease.leaseId);
    if (!entry || entry.expiresAt <= this.clock()) throw new ContractError('session lease is expired or unknown');
    const existingCookies = await context.cookies(CHATGPT_URL);
    const staleSessionCookies = existingCookies.filter((cookie) => (
      cookie.name === SESSION_COOKIE_BASE || cookie.name.startsWith(`${SESSION_COOKIE_BASE}.`)
    ));
    // Do not overwrite an authenticated active-order Profile. ChatGPT may
    // rotate its Session after login or purchase, so replaying the originally
    // submitted token can destroy a healthy session. Identity probing after
    // bootstrap remains authoritative. A different customer is admitted only
    // after terminal lifecycle cleanup removes the previous Session.
    if (staleSessionCookies.length > 0) {
      return {
        cookieCount: staleSessionCookies.length,
        replacedCookieCount: 0,
        existingSessionPreserved: true,
        sessionDigest: sessionLease.sessionDigest,
      };
    }
    await context.addCookies(entry.cookies);
    return {
      cookieCount: entry.cookies.length,
      replacedCookieCount: 0,
      existingSessionPreserved: false,
      sessionDigest: sessionLease.sessionDigest,
    };
  }

  async close(sessionLease) {
    assertSessionLease(sessionLease);
    this.leases.delete(sessionLease.leaseId);
  }
}
