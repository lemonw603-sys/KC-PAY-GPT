import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';

export class SessionIdentityProbeError extends ContractError {
  constructor(message, code) {
    super(message);
    this.name = 'SessionIdentityProbeError';
    this.code = code;
  }
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeDigest(value, name) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized && !/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ContractError(`${name} must be a SHA-256 digest`);
  }
  return normalized;
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new ContractError('expected session identity is required');
  }
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
  const accountId = typeof identity.accountId === 'string' ? identity.accountId.trim() : '';
  const userId = typeof identity.userId === 'string' ? identity.userId.trim() : '';
  const emailDigest = normalizeDigest(identity.emailDigest, 'expected emailDigest') || (email ? digest(email) : '');
  const accountIdDigest = normalizeDigest(identity.accountIdDigest, 'expected accountIdDigest')
    || (accountId ? digest(accountId) : '');
  const userIdDigest = normalizeDigest(identity.userIdDigest, 'expected userIdDigest') || (userId ? digest(userId) : '');
  if (!emailDigest && !accountIdDigest && !userIdDigest) {
    throw new ContractError('expected session identity is empty');
  }
  return { emailDigest, accountIdDigest, userIdDigest };
}

function assertSameOriginPath(path, name, { optional = false } = {}) {
  if (optional && path == null) return null;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new ContractError(`${name} must be a same-origin absolute path`);
  }
  return path;
}

/** Probe the real /api/auth/session endpoint without exposing its raw body. */
export async function probeSessionIdentity(page, expectedIdentity, {
  path = '/api/auth/session',
  accountCheckPath = null,
} = {}) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('page.evaluate is required');
  const expected = normalizeIdentity(expectedIdentity);
  const checkedSessionPath = assertSameOriginPath(path, 'session path');
  const checkedAccountPath = assertSameOriginPath(accountCheckPath, 'accountCheckPath', { optional: true });
  const observed = await page.evaluate(async ({ sessionPath, subscriptionPath }) => {
    const response = await fetch(sessionPath, { credentials: 'include' });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    const user = body?.user || {};
    let subscription = null;
    if (subscriptionPath && response.ok) {
      const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
      if (!accessToken) {
        subscription = { ok: false, status: null, state: 'UNKNOWN' };
      } else {
        const accountResponse = await fetch(subscriptionPath, {
          credentials: 'include',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        });
        let accountBody = null;
        try { accountBody = await accountResponse.json(); } catch { accountBody = null; }
        const entitlement = accountBody?.accounts?.default?.entitlement || {};
        const hasActive = entitlement.has_active_subscription;
        const plan = typeof entitlement.subscription_plan === 'string'
          ? entitlement.subscription_plan.trim().toLowerCase() : '';
        let state = 'UNKNOWN';
        if (hasActive === true && plan.includes('plus')) state = 'PLUS';
        else if (hasActive === true) state = 'PAID_OTHER';
        else if (hasActive === false && (!plan || plan.includes('free'))) state = 'FREE';
        subscription = { ok: accountResponse.ok, status: accountResponse.status, state };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      email: typeof user.email === 'string' ? user.email.trim().toLowerCase() : '',
      userId: typeof user.id === 'string' ? user.id.trim() : '',
      accountId: typeof body?.account?.id === 'string' ? body.account.id.trim() : '',
      subscription,
    };
  }, { sessionPath: checkedSessionPath, subscriptionPath: checkedAccountPath });
  if (!observed?.ok) {
    throw new SessionIdentityProbeError(
      `session identity probe returned HTTP ${observed?.status ?? 'unknown'}`,
      'SESSION_INVALID',
    );
  }
  const observedDigests = {
    emailDigest: observed.email ? digest(observed.email) : '',
    accountIdDigest: observed.accountId ? digest(observed.accountId) : '',
    userIdDigest: observed.userId ? digest(observed.userId) : '',
  };
  const expectedEntries = Object.entries(expected).filter(([, value]) => value);
  if (!expectedEntries.every(([key, value]) => observedDigests[key] === value)) {
    throw new SessionIdentityProbeError('session identity mismatch', 'SESSION_IDENTITY_MISMATCH');
  }
  if (checkedAccountPath && (!observed.subscription?.ok || observed.subscription.state === 'UNKNOWN')) {
    throw new SessionIdentityProbeError(
      `subscription probe returned HTTP ${observed.subscription?.status ?? 'unknown'} or an unknown account state`,
      'ACCOUNT_STATUS_UNKNOWN',
    );
  }
  return {
    verified: true,
    loggedIn: true,
    identityMatched: true,
    observedEmailDigest: observedDigests.emailDigest || null,
    observedAccountIdDigest: observedDigests.accountIdDigest || null,
    observedUserIdDigest: observedDigests.userIdDigest || null,
    httpStatus: observed.status,
    ...(checkedAccountPath ? {
      subscriptionStatus: observed.subscription.state,
      alreadyPlus: observed.subscription.state !== 'FREE',
      subscriptionHttpStatus: observed.subscription.status,
    } : {}),
  };
}
