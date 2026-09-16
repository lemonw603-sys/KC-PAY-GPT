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
async function probeSessionIdentityOnce(page, expectedIdentity, {
  path = '/api/auth/session',
  accountCheckPath = null,
  onVerifiedEmail = null,
  onVerifiedSubscription = null,
  stabilizationTimeoutMs = 0,
  stabilizationPollMs = 250,
  requestTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
  assertContinue = async () => {},
} = {}) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('page.evaluate is required');
  if (onVerifiedEmail != null && typeof onVerifiedEmail !== 'function') throw new TypeError('onVerifiedEmail must be a function');
  if (onVerifiedSubscription != null && typeof onVerifiedSubscription !== 'function') throw new TypeError('onVerifiedSubscription must be a function');
  if (!Number.isInteger(stabilizationTimeoutMs) || stabilizationTimeoutMs < 0 || stabilizationTimeoutMs > 30_000) {
    throw new TypeError('stabilizationTimeoutMs must be between 0 and 30000');
  }
  if (!Number.isInteger(stabilizationPollMs) || stabilizationPollMs < 50 || stabilizationPollMs > 2_000) {
    throw new TypeError('stabilizationPollMs must be between 50 and 2000');
  }
  const expected = normalizeIdentity(expectedIdentity);
  const checkedSessionPath = assertSameOriginPath(path, 'session path');
  const checkedAccountPath = assertSameOriginPath(accountCheckPath, 'accountCheckPath', { optional: true });
  const deadline = Math.min(deadlineAt, Date.now() + stabilizationTimeoutMs);
  let observed;
  do {
    await assertContinue();
    observed = await page.evaluate(async ({ sessionPath, subscriptionPath, requestTimeoutMs, deadlineAt }) => {
      const get = async (path, options) => {
        try { return await fetch(path, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadlineAt - Date.now()))) }); }
        catch { return { ok: false, status: 0, json: async () => null, headers: { get: () => null } }; }
      };
      const response = await get(sessionPath, { credentials: 'include' });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      const user = body?.user || {};
      let subscription = null;
      if (subscriptionPath && response.ok) {
        const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
        if (!accessToken) {
          subscription = { ok: false, status: null, state: 'UNKNOWN' };
        } else {
          const accountResponse = await get(subscriptionPath, {
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
          const account = accountBody?.accounts?.default || {};
          const last = account.last_active_subscription || {};
          subscription = { ok: accountResponse.ok, status: accountResponse.status, state,
            retryAfter: accountResponse.headers.get('retry-after'),
            stage: 'account', hasActive: hasActive === true, plan,
            accountId: typeof account.account?.account_id === 'string' ? account.account.account_id.trim()
              : (typeof body?.account?.id === 'string' ? body.account.id.trim() : ''),
            willRenew: typeof last.will_renew === 'boolean' ? last.will_renew : null,
            purchaseOrigin: typeof last.purchase_origin_platform === 'string' ? last.purchase_origin_platform.trim().toLowerCase() : '',
          };
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
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
    }, { sessionPath: checkedSessionPath, subscriptionPath: checkedAccountPath, requestTimeoutMs, deadlineAt });
    const identityStillLoading = observed?.ok && !observed.email && !observed.userId && !observed.accountId;
    if (!identityStillLoading || Date.now() >= deadline) break;
    await page.waitForTimeout(stabilizationPollMs);
  } while (true);
  if (!observed?.ok) {
    if (Number(observed?.status) === 0) {
      throw new SessionIdentityProbeError('Session read timed out or failed', 'ACCOUNT_STATUS_UNKNOWN',
        { stage: 'session-endpoint', httpStatus: 0 });
    }
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
        { stage: 'session-endpoint', retryAfter: observed.retryAfter, httpStatus: Number(observed?.status) || null, contentType: String(observed?.contentType || '').slice(0, 80), server: String(observed?.server || '').slice(0, 80), hasCfRay: observed?.hasCfRay === true },
      );
    }
    if (Number(observed?.status) >= 500) {
      throw new SessionIdentityProbeError(
        `session identity service returned HTTP ${observed.status}`,
        'ACCOUNT_STATUS_UNKNOWN',
        { stage: 'session-endpoint', retryAfter: observed.retryAfter, httpStatus: Number(observed?.status) || null, contentType: String(observed?.contentType || '').slice(0, 80), server: String(observed?.server || '').slice(0, 80), hasCfRay: observed?.hasCfRay === true },
      );
    }
    throw new SessionIdentityProbeError(
      `session identity probe returned HTTP ${observed?.status ?? 'unknown'}`,
      'SESSION_INVALID',
      { stage: 'session-endpoint', retryAfter: observed.retryAfter, httpStatus: Number(observed?.status) || null, contentType: String(observed?.contentType || '').slice(0, 80), server: String(observed?.server || '').slice(0, 80), hasCfRay: observed?.hasCfRay === true },
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
  // `error`（典型是 RefreshAccessTokenError）意味着刷新链已断。它是致命的——
  // 但致命点不在这里。2026-09-12 两次真单把这件事查清楚了（D-190）：
  //   · 原注释说「web app 会渲染成登出、购买控件全部消失」——这个前提是错的。
  //     实测同一时刻 authStatus=logged_in，页面上 3 个升级入口都在。
  //   · 据此放宽后重跑，主站、身份、卡料全过，却在进结账时被甩到
  //     /auth/login?next=/checkout/...：ChatGPT 在结账流程要求重新认证，
  //     而刷新链断了就换不来新的授权。CHECKOUT_NAVIGATION_FAILED。
  // 结论：这种会话确实不能用，所以判断恢复；理由换成真实的那个。放在这里停，
  // 是为了不白白创建一个用不上的 Stripe 结账会话（那次留下了 cs_live_…）。
  // 根因是刷新令牌只能用一次：同一份 Session 跑过一次之后就带上 error，
  // 必须让客户重新导出，不能重复使用。
  if (observed.sessionError) {
    throw new SessionIdentityProbeError(
      `session is no longer refreshable (${observed.sessionError})`,
      'SESSION_INVALID',
      {
        stage: 'session-error', httpStatus: observed.status,
        sessionError: observed.sessionError, authStatus: clientAuth.authStatus,
      },
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
      { stage: 'account-endpoint', httpStatus: observed.subscription?.status ?? null, retryAfter: observed.subscription?.retryAfter },
    );
  }
  if (expected.accountIdDigest && observed.subscription?.accountId
    && digest(observed.subscription.accountId) !== expected.accountIdDigest) {
    throw new SessionIdentityProbeError('subscription account identity mismatch', 'SESSION_IDENTITY_MISMATCH',
      { stage: 'identity-compare', httpStatus: observed.subscription.status });
  }
  // Optional transient handoff for the current task only. The email is never
  // included in the returned shared result or persisted by this module.
  if (onVerifiedSubscription && observed.subscription) await onVerifiedSubscription(observed.subscription);
  if (onVerifiedEmail && observed.email) await onVerifiedEmail(observed.email);
  return {
    // 刷新链断了但仍放行时，把它带出去——这一单是在降级状态下跑的，证据要留下。
    sessionError: observed.sessionError || null,
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

/** Bounded reads only. Never reinjects a Session, opens Checkout or submits payment. */
export async function probeSessionIdentity(page, expectedIdentity, options = {}) {
  const { retryDelaysMs = [2000, 5000], retryBudgetMs = 30_000,
    assertContinue = async () => {}, ...probeOptions } = options;
  if (!Array.isArray(retryDelaysMs) || retryDelaysMs.length > 2
    || retryDelaysMs.some(ms => !Number.isInteger(ms) || ms < 0 || ms > 10_000)
    || !Number.isInteger(retryBudgetMs) || retryBudgetMs < 1 || retryBudgetMs > 30_000) {
    throw new TypeError('invalid readonly retry budget');
  }
  const started = Date.now();
  const deadline = started + retryBudgetMs;
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    await assertContinue();
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const result = await probeSessionIdentityOnce(page, expectedIdentity, { ...probeOptions,
        deadlineAt: deadline, assertContinue,
        // Each probe has at most two serial fetches; leave both within the deadline.
        requestTimeoutMs: Math.max(1, Math.min(10_000, Math.floor(remaining / 2))),
        stabilizationTimeoutMs: Math.min(probeOptions.stabilizationTimeoutMs || 0, remaining),
      });
      return { ...result, probeAttempts: attempt + 1, probeElapsedMs: Date.now() - started };
    } catch (error) {
      lastError = error;
      const status = Number(error.details?.httpStatus);
      const transient = error instanceof SessionIdentityProbeError
        && ['CHATGPT_ACCESS_BLOCKED', 'ACCOUNT_STATUS_UNKNOWN'].includes(error.code)
        && (status === 0 || status === 403 || status === 429 || status >= 500);
      error.details = Object.freeze({ ...error.details, probeAttempts: attempt + 1,
        probeElapsedMs: Date.now() - started });
      if (!transient || attempt === retryDelaysMs.length) throw error;
      const raw = error.details.retryAfter;
      const seconds = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : null;
      const retryAfterMs = seconds !== null ? seconds * 1000
        : (raw && Number.isFinite(Date.parse(raw)) ? Math.max(0, Date.parse(raw) - Date.now()) : 0);
      const delay = Math.max(retryDelaysMs[attempt], retryAfterMs);
      if (Date.now() + delay >= deadline) throw error; // never violate server backoff
      // Short waits let a lease loss/shutdown stop the read-only retry promptly.
      let left = delay;
      while (left > 0) {
        await assertContinue();
        const chunk = Math.min(250, left);
        await page.waitForTimeout(chunk);
        left -= chunk;
      }
    }
  }
  throw lastError || new SessionIdentityProbeError('read budget exhausted', 'ACCOUNT_STATUS_UNKNOWN');
}
