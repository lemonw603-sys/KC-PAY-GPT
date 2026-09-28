import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBitBrowserRecovery, createTunnelRecovery, isBitBrowserUnreachable, isDatabaseUnreachable,
} from '../src/local-dependency-recovery.js';

// D-407（Lemon 2026-09-28）：比特浏览器 / 隧道有问题先拉起再试一遍，不直接判失败。

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

test('哪些算「比特浏览器没应答」：09-28 的两句原话算；应答了但说失败不算', () => {
  assert.equal(isBitBrowserUnreachable(new Error('BitBrowser /health timed out')), true);
  assert.equal(isBitBrowserUnreachable(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })), true);
  assert.equal(isBitBrowserUnreachable(new Error('BitBrowser /health failed')), false, '应答了：拉起解决不了');
  assert.equal(isBitBrowserUnreachable(new Error('BitBrowser Profile is not in the approved profile list')), false);
  assert.equal(isBitBrowserUnreachable(new Error('BitBrowser /browser/open timed out')), false, '只认第一问 /health');
});

test('哪些算「库连不上」：池子日志里隧道断时的几种；SQL 报错不算', () => {
  for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'DB_QUERY_TIMEOUT']) {
    assert.equal(isDatabaseUnreachable(Object.assign(new Error('x'), { code })), true, code);
  }
  assert.equal(isDatabaseUnreachable(new Error("Can't add new command when connection is in closed state")), true);
  assert.equal(isDatabaseUnreachable(Object.assign(new Error('x'), { code: 'ER_BAD_FIELD_ERROR' })), false);
});

test('比特浏览器好着：不拉起', async () => {
  let launches = 0;
  const recover = createBitBrowserRecovery({ healthy: async () => true, launch: async () => { launches += 1; } });
  assert.deepEqual(await recover(), { recovered: true, launched: false });
  assert.equal(launches, 0);
});

test('没开：拉起一次，等到应答就算救回来', async () => {
  const c = clock(); let launches = 0; let up = false;
  const recover = createBitBrowserRecovery({
    healthy: async () => up, launch: async () => { launches += 1; setTimeout(() => { up = true; }, 0); },
    sleep: async (ms) => { c.advance(ms); await new Promise((r) => setImmediate(r)); }, now: c.now,
  });
  const outcome = await recover();
  assert.equal(outcome.recovered, true);
  assert.equal(outcome.launched, true);
  assert.equal(launches, 1);
});

test('拉起后 90 秒仍不应答：交还上层；冷却期内不再拉，过了冷却再拉', async () => {
  const c = clock(); let launches = 0;
  const recover = createBitBrowserRecovery({ healthy: async () => false, launch: async () => { launches += 1; }, sleep: c.sleep, now: c.now });
  assert.deepEqual(await recover(), { recovered: false, launched: true, reason: 'STILL_DOWN' });
  assert.deepEqual(await recover(), { recovered: false, launched: false, reason: 'COOLDOWN' });
  assert.equal(launches, 1, '不在冷却期里反复叫它（它可能停在登录页，要人）');
  c.advance(180_000);
  await recover();
  assert.equal(launches, 2);
});

test('几条车道同时发现：只拉一次', async () => {
  let launches = 0; let up = false;
  const recover = createBitBrowserRecovery({
    healthy: async () => up, launch: async () => { launches += 1; up = true; }, sleep: async () => undefined,
  });
  const [a, b] = await Promise.all([recover(), recover()]);
  assert.equal(launches, 1);
  assert.equal(a.recovered && b.recovered, true);
});

test('拉起命令本身失败：不算救回来', async () => {
  const recover = createBitBrowserRecovery({ healthy: async () => false, launch: async () => { throw new Error('no app'); } });
  assert.deepEqual(await recover(), { recovered: false, launched: false, reason: 'LAUNCH_FAILED' });
});

test('隧道：连续 3 次连不上且跨度 ≥ 15 秒才重启；连上一次就清零；两次重启至少隔 2 分钟', async () => {
  const c = clock(); let kicks = 0;
  const tunnel = createTunnelRecovery({ kickstart: async () => { kicks += 1; }, now: c.now });
  const down = Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
  assert.equal((await tunnel.noteFailure(down)).kicked, false);
  c.advance(5_000); assert.equal((await tunnel.noteFailure(down)).kicked, false);
  c.advance(5_000); assert.equal((await tunnel.noteFailure(down)).kicked, false, '3 次但只跨 10 秒：可能只是一下抖动');
  c.advance(6_000); assert.equal((await tunnel.noteFailure(down)).kicked, true);
  assert.equal(kicks, 1);
  for (let i = 0; i < 4; i += 1) { c.advance(6_000); await tunnel.noteFailure(down); }
  assert.equal(kicks, 1, '冷却期内不再重启');
  tunnel.noteSuccess();
  c.advance(200_000);
  assert.equal((await tunnel.noteFailure(down)).kicked, false, '清零后重新数');
  assert.equal((await tunnel.noteFailure(Object.assign(new Error('x'), { code: 'ER_PARSE_ERROR' }))).kicked, false);
});
