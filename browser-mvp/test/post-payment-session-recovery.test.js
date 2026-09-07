import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSessionHealth, recoverSessionAfterPayment } from '../src/post-payment-session-recovery.js';

function fakePage({ sessionResults, urls = ['https://chatgpt.com/'], cookies = [] }) {
  const gotos = []; const cleared = [];
  let sessionIndex = 0; let urlIndex = 0;
  const context = {
    async cookies() { return cookies; },
    async clearCookies({ name }) { cleared.push(name); },
  };
  return {
    gotos, cleared,
    url() { return urls[Math.min(urlIndex, urls.length - 1)]; },
    async goto(url) { gotos.push(url); urlIndex += 1; },
    context() { return context; },
    async evaluate() { return sessionResults[Math.min(sessionIndex++, sessionResults.length - 1)]; },
  };
}

const healthy = { status: 200, hasAccessToken: true, errorCode: null };
const expired = { status: 200, hasAccessToken: false, errorCode: 'RefreshAccessTokenError' };

test('a healthy session needs no recovery and nothing is touched', async () => {
  const page = fakePage({ sessionResults: [healthy] });
  const result = await recoverSessionAfterPayment(page);
  assert.deepEqual([result.recovered, result.recoveryUsed, result.recoveryStep, page.gotos.length, page.cleared.length], [true, false, null, 0, 0]);
});

test('a login-page bounce is repaired by dropping the page login cookies and reloading, keeping session and device cookies', async () => {
  const page = fakePage({
    sessionResults: [expired, healthy],
    urls: ['https://chatgpt.com/auth/login', 'https://chatgpt.com/'],
    cookies: [
      { name: '__Secure-next-auth.session-token', value: 'x' }, { name: 'oai-client-auth-info', value: 'y' },
      { name: 'oai-client-session-epoch', value: '3' }, { name: 'cf_clearance', value: 'z' }, { name: 'oai-did', value: 'd' },
    ],
  });
  const seen = [];
  const result = await recoverSessionAfterPayment(page, { onStep: async (step) => seen.push(step.step) });
  assert.equal(result.recovered, true);
  assert.equal(result.recoveryStep, 'clear-login-cookies');
  assert.deepEqual(page.cleared.sort(), ['oai-client-auth-info', 'oai-client-session-epoch']);
  assert.deepEqual(page.gotos, ['https://chatgpt.com/']);
  assert.deepEqual(seen, ['probe', 'clear-login-cookies']);
  assert.equal(result.steps[0].onLoginPage, true);
});

test('when clearing does not help the original session is re-injected once, then it gives up without any payment action', async () => {
  const page = fakePage({ sessionResults: [expired, expired, healthy], cookies: [] });
  let reinjected = 0;
  const result = await recoverSessionAfterPayment(page, { reinjectSession: async () => { reinjected += 1; return { replacedCookieCount: 2 }; } });
  assert.deepEqual([result.recovered, result.recoveryStep, reinjected, page.gotos.length], [true, 'reinject-session', 1, 2]);
  assert.equal(result.steps[2].replacedCookieCount, 2);
  const stuck = fakePage({ sessionResults: [expired], cookies: [] });
  const failed = await recoverSessionAfterPayment(stuck, { reinjectSession: async () => ({}) });
  assert.deepEqual([failed.recovered, failed.recoveryUsed, failed.recoveryStep, failed.steps.length], [false, true, null, 3]);
});

test('checkSessionHealth reports the login page even when the session endpoint answers 200', async () => {
  const page = fakePage({ sessionResults: [healthy], urls: ['https://chatgpt.com/auth/login?next=%2F'] });
  const health = await checkSessionHealth(page);
  assert.deepEqual([health.ok, health.onLoginPage, health.status], [false, true, 200]);
});
