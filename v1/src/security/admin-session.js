import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'pojia_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
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
  now = () => Date.now()
}) {
  const parsedHash = parsePasswordHash(passwordHash);
  if (!parsedHash) throw new Error('Invalid ADMIN_PASSWORD_HASH');
  if (!Buffer.isBuffer(sessionSecret) || sessionSecret.length !== 32) {
    throw new Error('ADMIN_SESSION_SECRET_BASE64 must decode to exactly 32 bytes');
  }

  function signature(payload) {
    return createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  }

  function issueSession() {
    const payload = encode(JSON.stringify({ version: 1, expiresAt: now() + SESSION_TTL_MS }));
    return `${payload}.${signature(payload)}`;
  }

  function verifySession(token) {
    if (typeof token !== 'string') return false;
    const [payload, receivedSignature, extra] = token.split('.');
    if (!payload || !receivedSignature || extra) return false;
    const expected = Buffer.from(signature(payload));
    const received = Buffer.from(receivedSignature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const data = JSON.parse(decode(payload).toString('utf8'));
      return data.version === 1 && Number.isFinite(data.expiresAt) && data.expiresAt > now();
    } catch {
      return false;
    }
  }

  async function verifyPassword(password) {
    if (typeof password !== 'string' || password.length > 256) return false;
    const received = await scrypt(password, parsedHash.salt, parsedHash.digest.length);
    return timingSafeEqual(received, parsedHash.digest);
  }

  function authenticateRequest(req) {
    return verifySession(parseCookies(req.headers.cookie).get(COOKIE_NAME));
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

  function clearSessionCookie(res) {
    const parts = [
      `${COOKIE_NAME}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (secureCookies) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  return {
    authenticateRequest,
    clearSessionCookie,
    issueSession,
    setSessionCookie,
    verifyPassword
  };
}
