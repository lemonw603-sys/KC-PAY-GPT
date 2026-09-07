// After a subscription payment ChatGPT can bounce the page to /auth/login even
// though the customer never logged out (observed by hand on 2026-09-07/08).
// The system holds a session token, never a password, so the only acceptable
// recoveries are the ones that need no human: keep the token, drop the page's
// own login-state cookies and reload; then re-inject the original session
// material. Anything else stays for a person. Nothing here clicks a payment.
import { clearStaleLoginCookies } from './session-bootstrap.js';

const DEFAULT_HOME_URL = 'https://chatgpt.com/';

export async function checkSessionHealth(page, { sessionPath = '/api/auth/session' } = {}) {
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('page.evaluate is required');
  const url = typeof page.url === 'function' ? String(page.url() || '') : '';
  const onLoginPage = /\/auth\//.test(url) || /\/log-?in\b/.test(url);
  const observed = await page.evaluate(async ({ path }) => {
    const response = await fetch(path, { credentials: 'include' });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return {
      status: response.status,
      hasAccessToken: typeof body?.accessToken === 'string' && body.accessToken.length > 0,
      errorCode: typeof body?.error === 'string' ? body.error.slice(0, 64) : null,
    };
  }, { path: sessionPath });
  return {
    ok: observed.status >= 200 && observed.status < 300 && observed.hasAccessToken && !observed.errorCode && !onLoginPage,
    status: observed.status,
    hasAccessToken: observed.hasAccessToken,
    errorCode: observed.errorCode,
    onLoginPage,
  };
}

/**
 * Session recovery ladder. Returns { recovered, recoveryUsed, recoveryStep, steps }.
 * `reinjectSession(context)` is supplied by the composition and must put the
 * original session cookies back (replaceExisting); it is optional.
 */
export async function recoverSessionAfterPayment(page, {
  homeUrl = DEFAULT_HOME_URL,
  navigationTimeoutMs = 30_000,
  reinjectSession = null,
  forceLadder = false,
  onStep = async () => undefined,
} = {}) {
  if (!page || typeof page.goto !== 'function' || typeof page.context !== 'function') throw new TypeError('page is required');
  if (reinjectSession != null && typeof reinjectSession !== 'function') throw new TypeError('reinjectSession must be a function');
  const steps = [];
  const record = async (step, data) => { const entry = { step, ...data }; steps.push(entry); await onStep(entry); return entry; };
  let health = await checkSessionHealth(page);
  await record('probe', health);
  if (health.ok && !forceLadder) return { recovered: true, recoveryUsed: false, recoveryStep: null, steps };

  const context = page.context();
  const clearedLoginCookieCount = await clearStaleLoginCookies(context);
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
  health = await checkSessionHealth(page);
  await record('clear-login-cookies', { clearedLoginCookieCount, ...health });
  if (health.ok) return { recovered: true, recoveryUsed: true, recoveryStep: 'clear-login-cookies', steps };

  if (reinjectSession) {
    const reinjected = await reinjectSession(context);
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    health = await checkSessionHealth(page);
    await record('reinject-session', { ...(reinjected && typeof reinjected === 'object' ? reinjected : {}), ...health });
    if (health.ok) return { recovered: true, recoveryUsed: true, recoveryStep: 'reinject-session', steps };
  }
  return { recovered: false, recoveryUsed: true, recoveryStep: null, steps };
}
