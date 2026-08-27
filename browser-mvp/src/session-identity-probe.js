import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new ContractError('expected session identity is required');
  }
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
  const accountId = typeof identity.accountId === 'string' ? identity.accountId.trim() : '';
  const userId = typeof identity.userId === 'string' ? identity.userId.trim() : '';
  if (!email && !accountId && !userId) throw new ContractError('expected session identity is empty');
  return { email, accountId, userId };
}

/** Probe the real /api/auth/session endpoint without exposing its raw body. */
export async function probeSessionIdentity(page, expectedIdentity, { path = '/api/auth/session' } = {}) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('page.evaluate is required');
  const expected = normalizeIdentity(expectedIdentity);
  const observed = await page.evaluate(async (sessionPath) => {
    const response = await fetch(sessionPath, { credentials: 'include' });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    const user = body?.user || {};
    return {
      ok: response.ok,
      status: response.status,
      email: typeof user.email === 'string' ? user.email.trim().toLowerCase() : '',
      userId: typeof user.id === 'string' ? user.id.trim() : '',
      accountId: typeof body?.account?.id === 'string' ? body.account.id.trim() : '',
    };
  }, path);
  if (!observed?.ok) throw new ContractError(`session identity probe returned HTTP ${observed?.status ?? 'unknown'}`);
  const matches = (expected.email && observed.email === expected.email)
    || (expected.accountId && observed.accountId === expected.accountId)
    || (expected.userId && observed.userId === expected.userId);
  if (!matches) throw new ContractError('session identity mismatch');
  return {
    verified: true,
    observedEmailDigest: observed.email ? digest(observed.email) : null,
    observedAccountIdDigest: observed.accountId ? digest(observed.accountId) : null,
    observedUserIdDigest: observed.userId ? digest(observed.userId) : null,
    httpStatus: observed.status,
  };
}
