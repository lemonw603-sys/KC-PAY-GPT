import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANE_BLOCKING_RUNS_SQL, POOL_CONFIRMATION_PREFIX, loadProductionLivePoolConfig, parsePoolLanes, parseProductionLivePoolArgs, runLaneLoop,
  shouldRefreshCardBalances, withLaneGuard,
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

test('pool config stops Pro orders on the upgrade dialog by default and refuses the unimplemented PAY stage', () => {
  assert.equal(loadProductionLivePoolConfig(env()).upgradeStage, 'STOP_BEFORE_PAY');
  assert.equal(loadProductionLivePoolConfig(env({ BROWSER_UPGRADE_STAGE: 'stop_before_pay' })).upgradeStage, 'STOP_BEFORE_PAY');
  assert.throws(() => loadProductionLivePoolConfig(env({ BROWSER_UPGRADE_STAGE: 'PAY' })), /PAY is not implemented/);
});

test('付款前中止不去打卡台，动过钱的才回填余额（D-195）', () => {
  // highvcc 的卡不在 pojia-card-read-sync 范围内（那个 runner 用 HnskjCardProvider，
  // 且 manual_excel 账号 supports_api_sync=0），付款确认后余额只能等小时级快照回填，
  // 这段时间卡不可分配——2026-09-13 第一个真实客户单跑完后系统整整一小时接不了下一单。
  // 所以跑完一单立刻触发一次既有的正式快照同步。但要分清哪些单值得去问卡台：
  assert.equal(shouldRefreshCardBalances('SAFE_ABORTED'), false, '付款前中止时钱没动，问了也是白问');
  assert.equal(shouldRefreshCardBalances('IDLE'), false, '压根没跑活');
  for (const status of ['PROCESSED', 'UNKNOWN', 'CONFIRMED', 'PRE_SUBMIT_STOPPED']) {
    assert.equal(shouldRefreshCardBalances(status), true, status);
  }
});

test('没配 PAN HMAC key 时回填静默关闭，不影响付款（D-195）', () => {
  const withKey = loadProductionLivePoolConfig(env({ CARD_INTAKE_PAN_HMAC_KEY_BASE64: Buffer.alloc(32, 9).toString('base64') }));
  assert.ok(Buffer.isBuffer(withKey.cardIntakePanHmacKey));
  // 缺这把 key 只是退回小时级 timer，绝不能让执行器起不来——付款比回填重要。
  assert.equal(loadProductionLivePoolConfig(env()).cardIntakePanHmacKey, null);
});


test('D-352 块3①: lane guard blocks on RUNNING/RECONCILE_ONLY payments only; HUMAN_REQUIRED no longer parks the lane', async () => {
  // The SQL is the rule. Read it as a contract: HUMAN_REQUIRED must be absent, the two
  // window-holding statuses and the three in-flight payment states must be present.
  assert.doesNotMatch(LANE_BLOCKING_RUNS_SQL, /HUMAN_REQUIRED/);
  assert.match(LANE_BLOCKING_RUNS_SQL, /status IN \('RUNNING','RECONCILE_ONLY'\)/);
  assert.match(LANE_BLOCKING_RUNS_SQL, /'PAYMENT_SUBMITTING','PAYMENT_UNKNOWN','PAYMENT_CONFIRMED'/);
  assert.match(LANE_BLOCKING_RUNS_SQL, /worker_id=\?/);

  const seen = [];
  const make = (count) => withLaneGuard({ workerId: 'pool:lane-1', query: async (sql, params) => { seen.push({ sql, params }); return [[{ count }]]; } });
  let ran = 0;
  const step = async () => { ran += 1; return { status: 'COMPLETED' }; };
  assert.deepEqual(await make(1)(step)(), { status: 'IDLE' }, '本 lane 有付款在途的 run → 不接新单');
  assert.equal(ran, 0);
  assert.deepEqual(await make(0)(step)(), { status: 'COMPLETED' }, '没有 → 照常跑');
  assert.equal(ran, 1);
  assert.deepEqual(seen[0].params, ['pool:lane-1'], '只看本 lane 自己的 run');
  assert.throws(() => withLaneGuard({ workerId: '', query: async () => [[{ count: 0 }]] }), TypeError);
});
