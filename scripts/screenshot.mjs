#!/usr/bin/env node
// 给页面拍一张**全分辨率** PNG，用来给 Lemon 看效果。
//
// 为什么要它（2026-09-20）：对话里的截图会被缩到 800×500 ＝真实分辨率的 55%，
// 细节根本看不清；Lemon 又常换设备，localhost 的链接在别的机器上打不开。
// 拍成文件就能直接发过去，他在哪台机器都能看清。
//
// 用法：
//   PARITY_ADMIN_PASSWORD=... node scripts/screenshot.mjs <url> <输出.png> [选项]
//     --width=1440 --height=900   视口（默认 1440×900）
//     --full                      整页长图（默认只拍视口内）
//     --clip=<选择器>             只拍这个元素
//     --wait=<选择器>             先等这个元素出现（异步渲染的页面用）
//     --login                     先登录后台（读 PARITY_ADMIN_PASSWORD）
//
// 复用 visual-parity.mjs 里的 CDP 客户端，不另写一份。

import { writeFile } from 'node:fs/promises';
import { Cdp, launchChrome, openPage } from './visual-parity.mjs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const [url, out] = args.filter((a) => !a.startsWith('--'));

if (!url || !out) {
  console.error('用法: node scripts/screenshot.mjs <url> <输出.png> [--width= --height= --full --clip=选择器 --wait=选择器 --login]');
  process.exit(2);
}

const width = Number(flags.width || 1440);
const height = Number(flags.height || 900);

const chrome = await launchChrome();
const cdp = await Cdp.connect(chrome.wsUrl);
try {
  const sessionId = await openPage(cdp, url, {
    width, height,
    login: flags.login ? { password: process.env.PARITY_ADMIN_PASSWORD } : null
  });

  if (flags.wait) {
    const ok = await cdp.send('Runtime.evaluate', {
      expression: `new Promise((r) => { const d = Date.now() + 15000; const t = () =>
        document.querySelector(${JSON.stringify(flags.wait)}) ? r(true) : (Date.now() > d ? r(false) : setTimeout(t, 100)); t(); })`,
      awaitPromise: true, returnByValue: true
    }, sessionId);
    if (!ok.result.value) throw new Error(`等不到 ${flags.wait} 出现 —— 拍下来也是半截页面`);
  }

  // 量之前先确认视口真的生效；emulation 被清掉过不止一次
  const { result: vw } = await cdp.send('Runtime.evaluate',
    { expression: 'innerWidth', returnByValue: true }, sessionId);
  if (vw.value !== width) throw new Error(`视口没生效：期望 ${width}，实际 ${vw.value}`);

  const shot = { format: 'png', captureBeyondViewport: !!flags.full };

  if (flags.clip) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const e = document.querySelector(${JSON.stringify(flags.clip)});
        if (!e) return null; const b = e.getBoundingClientRect();
        return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`,
      returnByValue: true
    }, sessionId);
    if (!result.value) throw new Error(`找不到 ${flags.clip}`);
    shot.clip = { ...result.value, scale: 2 };   // 2 倍图，细节看得清
    shot.captureBeyondViewport = true;
  } else if (flags.full) {
    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
    shot.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
  }

  const { data } = await cdp.send('Page.captureScreenshot', shot, sessionId);
  await writeFile(out, Buffer.from(data, 'base64'));
  const kb = (Buffer.from(data, 'base64').length / 1024).toFixed(0);
  console.log(`已拍 → ${out}  (${kb} KB, 视口 ${width}×${height}${flags.clip ? `, 裁 ${flags.clip} @2x` : flags.full ? ', 整页' : ''})`);
} finally {
  cdp.close();
  await chrome.kill();
}
