import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderError } from '../src/providers/http-client.js';
import {
  createZzshuPointsMonitor, ZZSHU_ALERT_KEYS, ZZSHU_AUTO_SWITCHED_SETTING, ZZSHU_POINTS_ACTOR,
  ZZSHU_POINTS_OBSERVED_SETTING, ZZSHU_POINTS_SETTING
} from '../src/services/zzshu-points-monitor.js';

const NOW = new Date('2026-09-27T03:00:00.000Z');

function fakePool({ executor = 'API', autoSwitchedAt = '' } = {}) {
  const alerts = []; const resolved = []; const settings = []; const queries = [];
  async function query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    queries.push({ text, params });
    if (text.startsWith('SELECT fr.executor_kind')) return [executor ? [{ executor_kind: executor }] : []];
    if (text.startsWith('SELECT setting_value FROM app_settings')) return [autoSwitchedAt ? [{ setting_value: autoSwitchedAt }] : []];
    if (text.startsWith('INSERT INTO app_settings')) {
      for (let i = 0; i < params.length; i += 2) settings.push([params[i], params[i + 1]]);
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO operator_alerts')) {
      alerts.push({ type: params[0], key: params[1], severity: params[3], title: params[4], message: params[5] });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('UPDATE operator_alerts')) { resolved.push(params[0]); return [{ affectedRows: 0 }]; }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }
  return { alerts, resolved, settings, queries, query };
}

function monitor(pool, { points = 15, readError = null, switchResult = { changed: true }, switchError = null } = {}) {
  const switchCalls = [];
  const routeAdmin = {
    async setDefaultRechargeMethod(input) {
      switchCalls.push(input);
      if (switchError) throw switchError;
      return switchResult;
    }
  };
  const provider = { async readPoints() { if (readError) throw readError; return { points }; } };
  return { switchCalls, run: () => createZzshuPointsMonitor({ pool, provider, routeAdmin, now: () => NOW }).check() };
}

test('healthy points: recorded with the observation time; low / empty / key alerts closed; no route change', async () => {
  const pool = fakePool({ executor: 'API' });
  const m = monitor(pool, { points: 15 });
  const result = await m.run();
  assert.deepEqual(result, { ok: true, points: 15, executor: 'API', autoSwitched: false, switchRejected: null });
  assert.deepEqual(pool.settings, [[ZZSHU_POINTS_SETTING, '15'], [ZZSHU_POINTS_OBSERVED_SETTING, NOW.toISOString()]]);
  assert.deepEqual(pool.alerts, []);
  for (const key of [ZZSHU_ALERT_KEYS.KEY_REJECTED, ZZSHU_ALERT_KEYS.LOW, ZZSHU_ALERT_KEYS.EMPTY, ZZSHU_ALERT_KEYS.RESTORED]) {
    assert.ok(pool.resolved.includes(key), `${key} closed`);
  }
  assert.equal(m.switchCalls.length, 0);
});

test('at the threshold (5) the low alert opens; above it (6) it stays closed', async () => {
  const at = fakePool();
  await monitor(at, { points: 5 }).run();
  const low = at.alerts.find((a) => a.type === 'ZZSHU_POINTS_LOW');
  assert.equal(low.key, ZZSHU_ALERT_KEYS.LOW);
  assert.equal(low.severity, 'warning');
  assert.match(low.message, /剩 5 点（提醒线 5）/);
  assert.ok(at.resolved.includes(ZZSHU_ALERT_KEYS.EMPTY));
  const above = fakePool();
  await monitor(above, { points: 6 }).run();
  assert.equal(above.alerts.some((a) => a.type === 'ZZSHU_POINTS_LOW'), false);
  assert.ok(above.resolved.includes(ZZSHU_ALERT_KEYS.LOW));
});

test('zero points while Plus runs on API: switch to Browser through the formal service, remember it, and say so', async () => {
  const pool = fakePool({ executor: 'API' });
  const m = monitor(pool, { points: 0, switchResult: { changed: true, method: 'BROWSER' } });
  const result = await m.run();
  assert.equal(result.autoSwitched, true);
  assert.deepEqual(m.switchCalls, [{
    method: 'BROWSER', actorId: ZZSHU_POINTS_ACTOR,
    confirmation: '切换默认充值方式为 BROWSER', expectedCurrentMethod: 'API'
  }]);
  assert.deepEqual(pool.settings.at(-1), [ZZSHU_AUTO_SWITCHED_SETTING, NOW.toISOString()]);
  const empty = pool.alerts.find((a) => a.type === 'ZZSHU_POINTS_EMPTY');
  assert.equal(empty.severity, 'critical');
  assert.match(empty.message, /点数为 0。Plus 新单已自动改走 Browser/);
  assert.ok(pool.alerts.some((a) => a.type === 'ZZSHU_POINTS_LOW'), 'zero is also below the low line');
});

test('zero points but the switch is refused: no memory of a switch, and the alert says intake for API is paused with the reasons', async () => {
  const pool = fakePool({ executor: 'API' });
  const refusal = Object.assign(new Error('Browser recharge is not ready'), {
    code: 'DEFAULT_RECHARGE_METHOD_REJECTED',
    checks: [{ code: 'TARGET_POOL_AVAILABLE', ok: false, detail: '目标卡台按 plus 门槛可分配 0 张' }, { code: 'ROUTE_UNIQUE', ok: true }]
  });
  const m = monitor(pool, { points: 0, switchError: refusal });
  const result = await m.run();
  assert.equal(result.autoSwitched, false);
  assert.equal(result.switchRejected, 'DEFAULT_RECHARGE_METHOD_REJECTED');
  assert.equal(pool.settings.some(([key]) => key === ZZSHU_AUTO_SWITCHED_SETTING), false);
  const empty = pool.alerts.find((a) => a.type === 'ZZSHU_POINTS_EMPTY');
  assert.match(empty.message, /没能自动切到 Browser（目标卡台按 plus 门槛可分配 0 张），API 路线的新单已暂停接单/);
});

test('zero points while Plus already runs on Browser: no switch attempt, alert says Browser is unaffected', async () => {
  const pool = fakePool({ executor: 'BROWSER' });
  const m = monitor(pool, { points: 0 });
  await m.run();
  assert.equal(m.switchCalls.length, 0);
  assert.match(pool.alerts.find((a) => a.type === 'ZZSHU_POINTS_EMPTY').message, /Plus 目前走 Browser，不受影响/);
});

test('points come back after an automatic switch: remind once to switch back (never switch back automatically), clear the memory', async () => {
  const pool = fakePool({ executor: 'BROWSER', autoSwitchedAt: '2026-09-27T02:00:00.000Z' });
  const m = monitor(pool, { points: 10 });
  await m.run();
  assert.equal(m.switchCalls.length, 0, 'never switches back by itself');
  const restored = pool.alerts.find((a) => a.type === 'ZZSHU_POINTS_RESTORED');
  assert.equal(restored.key, ZZSHU_ALERT_KEYS.RESTORED);
  assert.match(restored.message, /恢复到 10。Plus 目前走 Browser（点数用完时自动切的）；要切回 API 请到工作台切换/);
  assert.deepEqual(pool.settings.at(-1), [ZZSHU_AUTO_SWITCHED_SETTING, '']);
  assert.ok(pool.resolved.includes(ZZSHU_ALERT_KEYS.EMPTY));
});

test('a rejected key (401 / 40107) raises the key alert and writes no points', async () => {
  const pool = fakePool();
  const error = new ProviderError('Zzshu points read error: 卡密无效或不存在', { provider: 'zzshu', status: 401, businessCode: '40107', retryable: false, uncertain: false });
  const result = await monitor(pool, { readError: error }).run();
  assert.deepEqual(result, { ok: false, reason: 'KEY_REJECTED', status: 401, businessCode: '40107' });
  const alert = pool.alerts.find((a) => a.type === 'ZZSHU_KEY_REJECTED');
  assert.equal(alert.severity, 'critical');
  assert.match(alert.message, /HTTP 401 \/ 40107/);
  assert.deepEqual(pool.settings, []);
});

test('a transient read failure changes nothing and pushes nothing', async () => {
  const pool = fakePool();
  const error = new ProviderError('timeout', { provider: 'zzshu', kind: 'timeout', retryable: true, uncertain: false });
  const result = await monitor(pool, { readError: error }).run();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'READ_FAILED');
  assert.deepEqual(pool.alerts, []);
  assert.deepEqual(pool.resolved, []);
  assert.deepEqual(pool.settings, []);
});
