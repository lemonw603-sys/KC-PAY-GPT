import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'pojia_admin_session';
const STEP_UP_COOKIE_NAME = 'pojia_admin_step_up';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STEP_UP_TTL_MS = 5 * 60 * 1000;
const HASH_PREFIX = 'scrypt-v1';

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url');
}

function parseCookies(header = '') {
  const cookies = new Map();
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies.set(key, value);
  }
  return cookies;
}

function parsePasswordHash(value) {
  const [prefix, saltValue, digestValue] = String(value || '').split('$');
  if (prefix !== HASH_PREFIX || !saltValue || !digestValue) return null;
  try {
    const salt = decode(saltValue);
    const digest = decode(digestValue);
    if (salt.length !== 16 || digest.length !== 64) return null;
    return { salt, digest };
  } catch {
    return null;
  }
}

export async function hashAdminPassword(password, { salt = randomBytes(16) } = {}) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Admin password must contain 12 to 256 characters');
  }
  const digest = await scrypt(password, salt, 64);
  return `${HASH_PREFIX}$${encode(salt)}$${encode(digest)}`;
}

export function createAdminSessionAuth({
  passwordHash,
  sessionSecret,
  secureCookies = false,
  pool = null,
  sessionVersionStore = null,
  now = () => Date.now()
}) {
  const parsedHash = parsePasswordHash(passwordHash);
  if (!parsedHash) throw new Error('Invalid ADMIN_PASSWORD_HASH');
  if (!Buffer.isBuffer(sessionSecret) || sessionSecret.length !== 32) {
    throw new Error('ADMIN_SESSION_SECRET_BASE64 must decode to exactly 32 bytes');
  }

  const versionStore = sessionVersionStore || {
    async get() {
      if (!pool) return 1;
      const [rows] = await pool.query(
        `SELECT setting_value FROM app_settings
         WHERE setting_key = 'admin_session_version' LIMIT 1`
      );
      const version = Number(rows[0]?.setting_value);
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid admin session version');
      return version;
    },
    async revokeAll() {
      if (!pool) return 2;
      await pool.query(
        `UPDATE app_settings
         SET setting_value = CAST(CAST(setting_value AS UNSIGNED) + 1 AS CHAR)
         WHERE setting_key = 'admin_session_version'`
      );
      return this.get();
    }
  };

  function signature(payload) {
    return createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  }

  async function issueSession() {
    const payload = encode(JSON.stringify({
      kind: 'admin',
      sessionId: randomBytes(18).toString('base64url'),
      version: await versionStore.get(),
      expiresAt: now() + SESSION_TTL_MS
    }));
    return `${payload}.${signature(payload)}`;
  }

  function verifySignedToken(token, kind) {
    if (typeof token !== 'string') return false;
    const [payload, receivedSignature, extra] = token.split('.');
    if (!payload || !receivedSignature || extra) return false;
    const expected = Buffer.from(signature(payload));
    const received = Buffer.from(receivedSignature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const data = JSON.parse(decode(payload).toString('utf8'));
      if (data.kind !== kind || typeof data.sessionId !== 'string' || data.sessionId.length < 16) return false;
      if (!Number.isSafeInteger(data.version) || data.version < 1) return false;
      if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now()) return false;
      return data;
    } catch {
      return false;
    }
  }

  async function verifyPassword(password) {
    if (typeof password !== 'string' || password.length > 256) return false;
    const received = await scrypt(password, parsedHash.salt, parsedHash.digest.length);
    return timingSafeEqual(received, parsedHash.digest);
  }

  async function authenticatedPayload(req) {
    const data = verifySignedToken(parseCookies(req.headers.cookie).get(COOKIE_NAME), 'admin');
    if (!data || data.version !== await versionStore.get()) return false;
    return data;
  }

  async function authenticateRequest(req) {
    return Boolean(await authenticatedPayload(req));
  }

  async function issueStepUp(req, password) {
    const session = await authenticatedPayload(req);
    if (!session || !await verifyPassword(password)) return null;
    const payload = encode(JSON.stringify({
      kind: 'step-up',
      sessionId: session.sessionId,
      version: session.version,
      expiresAt: now() + STEP_UP_TTL_MS
    }));
    return `${payload}.${signature(payload)}`;
  }

  async function hasStepUp(req) {
    const session = await authenticatedPayload(req);
    const stepUp = verifySignedToken(parseCookies(req.headers.cookie).get(STEP_UP_COOKIE_NAME), 'step-up');
    return Boolean(session && stepUp
      && stepUp.sessionId === session.sessionId
      && stepUp.version === session.version);
  }

  function setSessionCookie(res, token) {
    const parts = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (secureCookies) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function setStepUpCookie(res, token) {
    const parts = [
      `${STEP_UP_COOKIE_NAME}=${token}`,
      'Path=/api/v1/admin',
      `Max-Age=${Math.floor(STEP_UP_TTL_MS / 1000)}`,
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (secureCookies) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function clearSessionCookie(res) {
    const sessionParts = [
      `${COOKIE_NAME}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Strict'
    ];
    const stepUpParts = [
      `${STEP_UP_COOKIE_NAME}=`,
      'Path=/api/v1/admin',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (secureCookies) {
      sessionParts.push('Secure');
      stepUpParts.push('Secure');
    }
    res.setHeader('Set-Cookie', [sessionParts.join('; '), stepUpParts.join('; ')]);
  }

  return {
    authenticateRequest,
    clearSessionCookie,
    hasStepUp,
    issueSession,
    issueStepUp,
    revokeAllSessions: () => versionStore.revokeAll(),
    setSessionCookie,
    setStepUpCookie,
    verifyPassword
  };
}
