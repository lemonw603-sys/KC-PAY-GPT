import { execFile } from 'node:child_process';

/**
 * 本机两样依赖出问题时先自己拉起、再试一遍（D-407，Lemon 2026-09-28：「比特浏览器或隧道有问题可以重新拉起后
 * 试一遍，而不是直接判失败」）。起因：09-28 03:27 / 03:29 两单，比特浏览器没开，池子照样领单，开窗口第一步
 * `BitBrowser /health timed out` / `fetch failed` → 当场判失败、退卡密。
 *
 * 只做「拉起」，不做「杀掉重开」：比特浏览器在跑却不应答时，`open -a` 只是把它叫到前台，不会关掉任何窗口
 * （关掉会连带正在付款的那个窗口）。拉不起来就交还给上层：池子不领新单、不写心跳，下单入口 120 秒后按
 * 「执行器停了」拒单（客户看到暂停接单、卡密不消耗），巡检推「执行器离线」叫人。
 */
export const BITBROWSER_APP_PATH = '/Applications/比特浏览器.app';
export const TUNNEL_LAUNCH_AGENT = 'com.pojia.ssh-tunnel-13306';

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15_000 }, (error) => (error ? reject(error) : resolve()));
  });
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 比特浏览器本机接口「没在应答」：连不上、超时。接口应答了但返回失败（如 profile 不在列表）不算——
 * 那不是拉起能解决的，照旧失败。
 */
export function isBitBrowserUnreachable(error) {
  const text = String(error?.message || '');
  const code = String(error?.code || error?.cause?.code || '');
  return /^BitBrowser \/health timed out$/.test(text)
    || text === 'fetch failed'
    || ['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
}

/** 生产库连不上（隧道断了或卡住）。库应答了但 SQL 报错不算。 */
export function isDatabaseUnreachable(error) {
  const code = String(error?.code || '');
  return ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'DB_QUERY_TIMEOUT', 'EPIPE'].includes(code)
    || /connection is in closed state/i.test(String(error?.message || ''));
}

/** 比特浏览器本机接口 /health，短超时（领单前的门口检查用，不用开窗口那 20 秒）。 */
export async function bitBrowserHealthy({ apiBaseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${String(apiBaseUrl).replace(/\/$/, '')}/health`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return response.ok && body?.success === true;
  } catch {
    return false;
  } finally { clearTimeout(timer); }
}

/**
 * 拉起比特浏览器并等它的接口应答。同一时刻只跑一次（几条车道同时发现也只拉一次）；
 * 两次「真去拉起」之间至少隔 `relaunchCooldownMs`，冷却期内只看一眼健康、不再拉。
 */
export function createBitBrowserRecovery({
  healthy, launch = () => run('/usr/bin/open', ['-a', BITBROWSER_APP_PATH]),
  waitMs = 90_000, pollMs = 3_000, relaunchCooldownMs = 180_000,
  sleep = defaultSleep, now = () => Date.now(), log = () => undefined,
} = {}) {
  if (typeof healthy !== 'function') throw new TypeError('healthy is required');
  let inflight = null;
  let lastLaunchAt = -Infinity;
  async function attempt() {
    if (await healthy()) return { recovered: true, launched: false };
    if (now() - lastLaunchAt < relaunchCooldownMs) return { recovered: false, launched: false, reason: 'COOLDOWN' };
    lastLaunchAt = now();
    log('bitbrowser-relaunch', { app: BITBROWSER_APP_PATH });
    try { await launch(); } catch (error) {
      log('bitbrowser-relaunch-failed', { code: String(error?.code || error?.message || '').slice(0, 120) });
      return { recovered: false, launched: false, reason: 'LAUNCH_FAILED' };
    }
    const started = now();
    while (now() - started < waitMs) {
      await sleep(pollMs);
      if (await healthy()) {
        log('bitbrowser-recovered', { waitedMs: now() - started });
        return { recovered: true, launched: true, waitedMs: now() - started };
      }
    }
    log('bitbrowser-still-down', { waitedMs: now() - started });
    return { recovered: false, launched: true, reason: 'STILL_DOWN' };
  }
  return function recover() {
    if (!inflight) inflight = attempt().finally(() => { inflight = null; });
    return inflight;
  };
}

/**
 * 隧道：库连续连不上（≥ `failures` 次、跨度 ≥ `minSpanMs`）就重启隧道的 LaunchAgent（`kickstart -k`），
 * 不等 ssh 自己 90 秒心跳超时再退出。两次重启之间至少隔 `cooldownMs`。库一连上就清零。
 */
export function createTunnelRecovery({
  kickstart = () => run('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${TUNNEL_LAUNCH_AGENT}`]),
  failures = 3, minSpanMs = 15_000, cooldownMs = 120_000, now = () => Date.now(), log = () => undefined,
} = {}) {
  let streak = 0; let streakStartedAt = 0; let lastKickAt = -Infinity;
  return {
    noteSuccess() { streak = 0; },
    async noteFailure(error) {
      if (!isDatabaseUnreachable(error)) return { kicked: false };
      if (streak === 0) streakStartedAt = now();
      streak += 1;
      if (streak < failures || now() - streakStartedAt < minSpanMs || now() - lastKickAt < cooldownMs) return { kicked: false };
      lastKickAt = now();
      log('tunnel-restart', { agent: TUNNEL_LAUNCH_AGENT, failures: streak });
      try { await kickstart(); } catch (error2) {
        log('tunnel-restart-failed', { code: String(error2?.code || error2?.message || '').slice(0, 120) });
        return { kicked: false };
      }
      streak = 0;
      return { kicked: true };
    },
  };
}
