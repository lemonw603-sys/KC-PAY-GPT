// 本机演示后台的预加载（scripts/local-admin.sh serve 用 node --import 挂上；不改 v1/src 一行）。
//
// 1. 断外网：进程里所有 fetch 只放行本机回环地址。卡台（hnskj / highvcc）、直充平台、推送一律不出门——
//    即使有人在本机后台里贴了真 token、点了开卡，请求也发不出去。
// 2. highvcc 只读两个接口本机应答（卡段列表、钱包余额），让卡片页和「刷新余额」能正常显示；
//    余额取形状快照里的量级。报价、开卡、卡列表、流水等其余接口一律回 503「本机演示环境不连卡台」。
// 3. 心跳保持与快照时一样新：本机没有 worker 在跑，但线上抓快照时 worker / 常驻池是在线的，
//    工作台与诊断页的「在线 / 就绪」要和线上一致，就每 15 秒把这几个心跳写回「现在 − 快照时的年龄」。
//    只写本机库（DATABASE_URL 由 local-admin.sh 指向 pojia_local_admin*）。
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const realFetch = globalThis.fetch;
let shape = null;
try { shape = JSON.parse(readFileSync(process.env.LOCAL_ADMIN_SHAPE || new URL('./shape.json', import.meta.url), 'utf8')); }
catch { shape = null; }

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const walletDollars = Number((shape?.providers || []).find((p) => p.providerCode === 'manual_excel')?.walletBalance ?? 0);

function highvcc(url) {
  if (url.pathname === '/api/card/rangeList') {
    return json(200, { code: 200, data: [
      { vid: '708', name: '51000099', newCardMinTopupAmount: { amount: 1000 } },
      { vid: '711', name: '51000088', newCardMinTopupAmount: { amount: 1000 } }
    ] });
  }
  if (url.pathname === '/api/user/wallet') {
    return json(200, { code: 200, data: { usdBalance: Math.round(walletDollars * 100), usdDeposit: 0, usdConsume: 0 } });
  }
  return json(503, { code: 503, msg: '本机演示环境不连卡台' });
}

globalThis.fetch = async function localAdminFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (LOOPBACK.has(url.hostname)) return realFetch(input, init);
  if (url.hostname === 'www.highvcc.com' || url.hostname === 'highvcc.com') return highvcc(url);
  throw new TypeError(`local-admin: outbound network disabled (${url.hostname})`);
};

const ages = shape?.settings?.heartbeatAges || {};
const keep = Object.entries(ages).filter(([, age]) => age != null && Number(age) <= 6 * 3600);
const dbUrl = process.env.DATABASE_URL || '';
if (keep.length && /\/pojia_local_admin(_[a-z0-9]+)?$/.test(dbUrl) && /@(127\.0\.0\.1|localhost):/.test(dbUrl)) {
  const pool = mysql.createPool({ uri: dbUrl, connectionLimit: 1, timezone: 'Z' });
  const tick = async () => {
    for (const [key, age] of keep) {
      await pool.query('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?',
        [new Date(Date.now() - Number(age) * 1000).toISOString(), key]).catch(() => {});
    }
  };
  tick();
  const timer = setInterval(tick, 15_000);
  timer.unref();
  // 服务收到停止信号时把这条连接也关掉，不然它会拖着进程不退。
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => { clearInterval(timer); pool.end().catch(() => {}); });
  }
}
