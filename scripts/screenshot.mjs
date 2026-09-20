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
//     --clip=<名字>:<选择器>      多块：可重复传，输出目录下按名字存（一个 Chrome 拍完所有）
//     --wait=<选择器>             先等这个元素出现（异步渲染的页面用）
//     --login                     先登录后台（读 PARITY_ADMIN_PASSWORD）
//
// 复用 visual-parity.mjs 里的 CDP 客户端，不另写一份。

import { writeFile } from 'node:fs/promises';
import { Cdp, launchChrome, openPage } from './visual-parity.mjs';

const args = process.argv.slice(2);
// --clip 可重复传，其余标志取最后一个
const clips = args.filter((a) => a.startsWith('--clip=')).map((a) => a.slice(7));
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--') && !a.startsWith('--clip='))
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

  const capture = async (clipSel, dest, label) => {
    const shot = { format: 'png', captureBeyondViewport: !!flags.full };
    if (clipSel) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const e = document.querySelector(${JSON.stringify(clipSel)});
          if (!e) return null; const b = e.getBoundingClientRect();
          return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`,
        returnByValue: true
      }, sessionId);
      if (!result.value) throw new Error(`找不到 ${clipSel}`);
      shot.clip = { ...result.value, scale: 2 };   // 2 倍图，细节看得清
      shot.captureBeyondViewport = true;
    } else if (flags.full) {
      const { cssContentSize } = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
      shot.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
    }
    const { data } = await cdp.send('Page.captureScreenshot', shot, sessionId);
    const buf = Buffer.from(data, 'base64');
    await writeFile(dest, buf);
    console.log(`已拍 → ${dest}  (${(buf.length / 1024).toFixed(0)} KB${label ? `, ${label} @2x` : flags.full ? ', 整页' : ''})`);
  };

  // 「名字:选择器」的名字必须长得像名字 —— CSS 伪类自带冒号（:last-child、::before），
  // 只看「有没有冒号」会把整个选择器当成名字，然后拿它去建目录（2026-09-20 真踩到）。
  const splitClip = (spec) => {
    const idx = spec.indexOf(':');
    if (idx === -1) return [null, spec];
    const name = spec.slice(0, idx);
    return /^[\w\u4e00-\u9fff-]+$/.test(name) ? [name, spec.slice(idx + 1)] : [null, spec];
  };

  if (clips.length > 1 || (clips.length === 1 && splitClip(clips[0])[0])) {
    // 多块模式：out 当目录用。一个 Chrome 实例拍完所有 —— 每块都重启一次浏览器，
    // 七块就要两分多钟，纯属浪费（2026-09-20 真的这么跑过一次，超时了）。
    const { mkdir } = await import('node:fs/promises');
    await mkdir(out, { recursive: true });
    for (const spec of clips) {
      const [parsed, sel] = splitClip(spec);
      const name = parsed || sel.replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 60);
      await capture(sel, `${out}/${name}.png`, sel);
    }
  } else {
    await capture(clips[0] || null, out, clips[0] || '');
  }
} finally {
  cdp.close();
  await chrome.kill();
}
