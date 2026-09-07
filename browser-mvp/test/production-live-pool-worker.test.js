import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POOL_CONFIRMATION_PREFIX, loadProductionLivePoolConfig, parsePoolLanes, parseProductionLivePoolArgs, runLaneLoop,
} from '../src/production-live-pool-worker.js';

const key = (byte) => Buffer.alloc(32, byte).toString('base64');
const profile = (byte) => byte.toString(16).repeat(32).slice(0, 32);
function env(overrides = {}) {
  return {
    BROWSER_WORKER_MODE: 'PRODUCTION_LIVE_POOL',
    BROWSER_POOL_CONFIRMATION: `${POOL_CONFIRMATION_PREFIX}REHEARSAL`,
    BROWSER_LIVE_STOP_BEFORE: 'SUBMIT',
    BROWSER_POOL_LANES: `lane-3=${profile(0xa)},lane-2=${profile(0xb)}`,
    BROWSER_PAYMENT_WRITES_ENABLED: 'false', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false', BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE',
    PROVIDER_WRITES_ENABLED: 'false', PROVIDER_CARD_WRITES_ENABLED: 'false', PROVIDER_RECHARGE_WRITES_ENABLED: 'false', CARD_FUNDING_WRITES_ENABLED: 'false',
    PROVIDER_READS_ENABLED: 'false',
    DATABASE_URL: 'mysql://fixture', DATABASE_TLS: 'false',
    BROWSER_EXECUTOR_PROFILE_ID: 'profile-1', BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345',
    BROWSER_BILLING_ADDRESS_NAME: 'Browser Billing', BROWSER_POOL_STATE_DIR: '/tmp/browser-pool-fixture',
    BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1), BROWSER_ARTIFACT_KEY_BASE64: key(2), BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3), SESSION_ENCRYPTION_KEY_BASE64: key(4),
    ...overrides,
  };
}

test('pool lanes are parsed as unique laneId=profileId pairs, one to six', () => {
  assert.deepEqual(parsePoolLanes(`a=${profile(1)}, b=${profile(2)}`), [{ laneId: 'a', bitbrowserProfileId: profile(1) }, { laneId: 'b', bitbrowserProfileId: profile(2) }]);
  assert.throws(() => parsePoolLanes(''), /required/);
  assert.throws(() => parsePoolLanes('a=short'), /invalid/);
  assert.throws(() => parsePoolLanes(`a=${profile(1)},a=${profile(2)}`), /unique/);
  assert.throws(() => parsePoolLanes(`a=${profile(1)},b=${profile(1)}`), /unique/);
  assert.throws(() => parsePoolLanes([1, 2, 3, 4, 5, 6, 7].map((n) => `l${n}=${profile(n)}`).join(',')), /1 to 6/);
});

test('REHEARSAL pool is non-paying and PAY pool requires both process gates and no stop flag', () => {
  const rehearsal = loadProductionLivePoolConfig(env());
  assert.equal(rehearsal.mode, 'REHEARSAL'); assert.equal(rehearsal.paying, false); assert.equal(rehearsal.stopBeforeSubmit, true);
  assert.equal(rehearsal.lanes.length, 2); assert.equal(rehearsal.workerIdPrefix, 'pool');
  assert.throws(() => loadProductionLivePoolConfig(env({ BROWSER_LIVE_STOP_BEFORE: '' })), /REHEARSAL pool requires/);
  assert.throws(() => loadProductionLivePoolConfig(env({ BROWSER_PAYMENT_WRITES_ENABLED: 'true' })), /must be exactly false/);
  const payEnv = env({ BROWSER_POOL_CONFIRMATION: `${POOL_CONFIRMATION_PREFIX}PAY`, BROWSER_LIVE_STOP_BEFORE: '', BROWSER_PAYMENT_WRITES_ENABLED: 'true', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true' });
  const pay = loadProductionLivePoolConfig(payEnv);
  assert.equal(pay.mode, 'PAY'); assert.equal(pay.paying, true); assert.equal(pay.stopBeforeSubmit, false);
  assert.throws(() => loadProductionLivePoolConfig({ ...payEnv, BROWSER_LIVE_STOP_BEFORE: 'SUBMIT' }), /PAY pool must not set/);
  assert.throws(() => loadProductionLivePoolConfig({ ...payEnv, BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false' }), /must be exactly true/);
  // --check never needs the paying gates on, even in PAY mode.
  assert.equal(loadProductionLivePoolConfig({ ...payEnv, BROWSER_WORKER_CHECK_ONLY: 'true', BROWSER_PAYMENT_WRITES_ENABLED: 'false', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false' }).paying, false);
  assert.throws(() => loadProductionLivePoolConfig(env({ BROWSER_POOL_CONFIRMATION: 'I-CONFIRM-ONE-LIVE-BROWSER-PAYMENT:x' })), /pool mode/);
  assert.throws(() => loadProductionLivePoolConfig(env({ CARD_NUMBER: '4111' })), /must be absent/);
  assert.deepEqual(parseProductionLivePoolArgs(['--check']), { checkOnly: true });
  assert.throws(() => parseProductionLivePoolArgs(['--once']));
});

test('lane loop runs verification, preflight and live in order, restarts after work and sleeps when idle', async () => {
  const controller = new AbortController();
  const calls = []; const results = []; const sleeps = [];
  let tick = 0;
  const steps = [
    { name: 'verify', run: async () => { calls.push('verify'); return { status: 'IDLE' }; } },
    { name: 'preflight', run: async () => { calls.push('preflight'); tick += 1; return tick === 1 ? { status: 'COMPLETED', taskId: 't1' } : { status: 'IDLE' }; } },
    { name: 'live', run: async () => { calls.push('live'); if (tick === 2) return { status: 'PRE_SUBMIT_STOPPED', orderId: 'o1' }; if (tick === 3) throw Object.assign(new Error('boom'), { code: 'LANE_BOOM' }); return { status: 'IDLE' }; } },
  ];
  const errors = [];
  const summary = await runLaneLoop({
    laneId: 'lane-3', steps, pollIntervalMs: 100, signal: controller.signal,
    onResult: async (r) => { results.push(`${r.step}:${r.result.status}`); },
    onError: async ({ error }) => { errors.push(error.code); },
    sleepImpl: async (ms) => { sleeps.push(ms); if (sleeps.length >= 2) controller.abort(); },
  });
  // tick1: preflight works (no sleep, restart); tick2: live works (no sleep); tick3: live throws (backoff sleep 500);
  // tick4: all idle (poll sleep 100) -> abort.
  assert.deepEqual(results, ['preflight:COMPLETED', 'live:PRE_SUBMIT_STOPPED']);
  assert.deepEqual(errors, ['LANE_BOOM']);
  assert.deepEqual(sleeps, [500, 100]);
  assert.deepEqual(calls, ['verify', 'preflight', 'verify', 'preflight', 'live', 'verify', 'preflight', 'live', 'verify', 'preflight', 'live']);
  assert.deepEqual(summary, { laneId: 'lane-3', ticks: 4, results: 2, errors: 1 });
});
