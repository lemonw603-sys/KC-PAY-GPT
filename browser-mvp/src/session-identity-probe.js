import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';

export class SessionIdentityProbeError extends ContractError {
  constructor(message, code, details = null) {
    super(message);
    this.name = 'SessionIdentityProbeError';
    this.code = code;
    this.details = details && typeof details === 'object' ? Object.freeze({ ...details }) : null;
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
  onVerifiedEmail = null,
  stabilizationTimeoutMs = 0,
  stabilizationPollMs = 250,
} = {}) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('page.evaluate is required');
  if (onVerifiedEmail != null && typeof onVerifiedEmail !== 'function') throw new TypeError('onVerifiedEmail must be a function');
  if (!Number.isInteger(stabilizationTimeoutMs) || stabilizationTimeoutMs < 0 || stabilizationTimeoutMs > 30_000) {
    throw new TypeError('stabilizationTimeoutMs must be between 0 and 30000');
  }
  if (!Number.isInteger(stabilizationPollMs) || stabilizationPollMs < 50 || stabilizationPollMs > 2_000) {
    throw new TypeError('stabilizationPollMs must be between 50 and 2000');
  }
  const expected = normalizeIdentity(expectedIdentity);
  const checkedSessionPath = assertSameOriginPath(path, 'session path');
  const checkedAccountPath = assertSameOriginPath(accountCheckPath, 'accountCheckPath', { optional: true });
  const deadline = Date.now() + stabilizationTimeoutMs;
  let observed;
  do {
    observed = await page.evaluate(async ({ sessionPath, subscriptionPath }) => {
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
          else if (hasActive === false) state = 'FREE';
          subscription = { ok: accountResponse.ok, status: accountResponse.status, state };
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        // NextAuth reports a dead refresh chain (e.g. RefreshAccessTokenError)
        // inside a 200 body while still echoing the cached user: the web app
        // then renders logged out and every purchase control is gone.
        sessionError: typeof body?.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 64) : null,
        contentType: response.headers.get('content-type') || '',
        server: response.headers.get('server') || '',
        hasCfRay: Boolean(response.headers.get('cf-ray')),
        email: typeof user.email === 'string' ? user.email.trim().toLowerCase() : '',
        userId: typeof user.id === 'string' ? user.id.trim() : '',
        accountId: typeof body?.account?.id === 'string' ? body.account.id.trim() : '',
        subscription,
      };
    }, { sessionPath: checkedSessionPath, subscriptionPath: checkedAccountPath });
    const identityStillLoading = observed?.ok && !observed.email && !observed.userId && !observed.accountId;
    if (!identityStillLoading || Date.now() >= deadline) break;
    await page.waitForTimeout(stabilizationPollMs);
  } while (true);
  if (!observed?.ok) {
    const accessBlocked = Number(observed?.status) === 429
      || (Number(observed?.status) === 403 && (
        String(observed?.contentType || '').toLowerCase().includes('text/html')
        || String(observed?.server || '').toLowerCase().includes('cloudflare')
        || observed?.hasCfRay === true
      ));
    if (accessBlocked) {
      throw new SessionIdentityProbeError(
        'ChatGPT access was blocked before Session identity could be verified',
        'CHATGPT_ACCESS_BLOCKED',
        { stage: 'session-endpoint', httpStatus: Number(observed?.status) || null, contentType: String(observed?.contentType || '').slice(0, 80), server: String(observed?.server || '').slice(0, 80), hasCfRay: observed?.hasCfRay === true },
      );
    }
    if (Number(observed?.status) >= 500) {
      throw new SessionIdentityProbeError(
        `session identity service returned HTTP ${observed.status}`,
        'ACCOUNT_STATUS_UNKNOWN',
        { stage: 'session-endpoint', httpStatus: Number(observed?.status) || null, contentType: String(observed?.contentType || '').slice(0, 80), server: String(observed?.server || '').slice(0, 80), hasCfRay: observed?.hasCfRay === true },
      );
    }
    throw new SessionIdentityProbeError(
      `session identity probe returned HTTP ${observed?.status ?? 'unknown'}`,
      'SESSION_INVALID',
      { stage: 'session-endpoint', httpStatus: Number(observed?.status) || null, contentType: String(observed?.contentType || '').slice(0, 80), server: String(observed?.server || '').slice(0, 80), hasCfRay: observed?.hasCfRay === true },
    );
  }
  if (observed.sessionError) {
    throw new SessionIdentityProbeError(
      `session is no longer refreshable (${observed.sessionError})`,
      'SESSION_INVALID',
      { stage: 'session-error', httpStatus: observed.status, sessionError: observed.sessionError },
    );
  }
  // The web app carries its own client login state in the server-rendered
  // payload. With a session cookie but a dead client auth, it renders the
  // logged-out shell (no upgrade entry, "Welcome back" account chooser) even
  // though the session endpoint still answers 200. Verified 2026-09-07.
  const clientAuth = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map((script) => script.textContent || '').join('\n');
    const match = scripts.match(/"authStatus":"([a-z_]+)"/);
    return { authStatus: match ? match[1] : null };
  }).catch(() => ({ authStatus: null }));
  if (clientAuth.authStatus && clientAuth.authStatus !== 'logged_in') {
    throw new SessionIdentityProbeError(
      `web client auth status is ${clientAuth.authStatus}`,
      'SESSION_INVALID',
      { stage: 'client-auth', httpStatus: observed.status, authStatus: clientAuth.authStatus },
    );
  }
  const observedDigests = {
    emailDigest: observed.email ? digest(observed.email) : '',
    accountIdDigest: observed.accountId ? digest(observed.accountId) : '',
    userIdDigest: observed.userId ? digest(observed.userId) : '',
  };
  const expectedEntries = Object.entries(expected).filter(([, value]) => value);
  if (!expectedEntries.every(([key, value]) => observedDigests[key] === value)) {
    throw new SessionIdentityProbeError('session identity mismatch', 'SESSION_IDENTITY_MISMATCH', { stage: 'identity-compare', httpStatus: observed.status });
  }
  if (checkedAccountPath && (!observed.subscription?.ok || observed.subscription.state === 'UNKNOWN')) {
    throw new SessionIdentityProbeError(
      `subscription probe returned HTTP ${observed.subscription?.status ?? 'unknown'} or an unknown account state`,
      'ACCOUNT_STATUS_UNKNOWN',
    );
  }
  // Optional transient handoff for the current task only. The email is never
  // included in the returned shared result or persisted by this module.
  if (onVerifiedEmail && observed.email) await onVerifiedEmail(observed.email);
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
