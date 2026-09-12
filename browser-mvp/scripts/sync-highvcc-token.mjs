// 从 BitBrowser 里那个常驻登录 highvcc 的窗口取 access token，同步进后台。
// 目的：把「每次过期都要人去 F12 复制粘贴」变成一条命令——登录态比 access token 活得久，
// 人只在登录态真失效时登一次（2026-09-12 Lemon 要求，见 UX_PUNCHLIST 第 6 节）。
//
//   node browser-mvp/scripts/sync-highvcc-token.mjs --profile <BitBrowser窗口ID> [--dry-run]
//
// token 全程不落盘、不打印、不进命令行参数：CDP 读出后经 ssh stdin 直接交给主机上的
// v1/scripts/set-highvcc-token.mjs，由它走后台同一个 service 加密入库。
// --dry-run 只报告「读到了没有、长什么量级」，不发送。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const profile = (() => { const i = args.indexOf('--profile'); return i >= 0 ? String(args[i + 1] || '') : ''; })();
const dryRun = args.includes('--dry-run');
const host = process.env.POJIA_HOST || 'root@144.34.180.184';
if (!profile) { console.error('usage: sync-highvcc-token.mjs --profile <BitBrowser窗口ID> [--dry-run]'); process.exit(2); }

const opened = await fetch('http://127.0.0.1:54345/browser/open', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: profile, args: [], loadExtensions: true }),
}).then((r) => r.json());
const ws = opened?.data?.ws || opened?.data?.http;
if (!ws) { console.error('打不开该 BitBrowser 窗口：' + JSON.stringify(opened).slice(0, 160)); process.exit(1); }

const browser = await chromium.connectOverCDP(ws);
try {
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes('highvcc.com'));
  if (!page) {
    // 没有 highvcc 标签页就自己开一个：localStorage 是按源隔离的，必须在该源的页面上读。
    page = await context.newPage();
    await page.goto('https://highvcc.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
  const token = await page.evaluate(() => window.localStorage.getItem('access_token') || '');
  if (!token) {
    console.error('该窗口里没有读到登录信息——多半是这个窗口还没登录 highvcc.com，或登录态已过期。请在这个窗口里登录一次。');
    process.exit(1);
  }
  if (dryRun) { console.log(JSON.stringify({ dryRun: true, found: true, length: token.length })); process.exit(0); }

  const remote = spawn('ssh', [host,
    'cd /opt/pojia/current && set -a && . /etc/pojia/runtime.env && set +a && node v1/scripts/set-highvcc-token.mjs --by sync-highvcc-token',
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  remote.stdin.end(token);
  const code = await new Promise((resolve) => remote.on('close', resolve));
  process.exitCode = code;
} finally {
  await browser.close();
}
