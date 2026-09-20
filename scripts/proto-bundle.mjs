#!/usr/bin/env node
// 把 docs/design/prototypes/ 下的原型打成**自包含单文件 HTML**，便于发到别的设备上看。
//
// 起因（2026-09-20）：原型靠 scripts/proto-server.mjs 起在 localhost，Lemon 换台设备就打不开。
// 但原型的价值在于它用的是**真实的 workbench.css 和真实字体** —— 为了能远程看就改用别的样式，
// 等于把原型变成另一个东西。所以这里把真实 CSS 和 woff2 字体全部内联进去，一个文件带走，
// 渲染结果和本地后台逐像素相同。
//
// 用法：
//   node scripts/proto-bundle.mjs step6-opsbar-v5.html [输出路径]
//
// 输出的是 Artifact 能直接发布的片段：不带 doctype/html/head/body（发布时会包），
// <title> 与 <style> 在最前。只读源文件，不改原型。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_DIR = path.join(ROOT, 'docs/design/prototypes');
const PUBLIC_DIR = path.join(ROOT, 'v1/public');

const name = process.argv[2];
if (!name) {
  console.error('用法: node scripts/proto-bundle.mjs <原型文件名> [输出路径]');
  process.exit(2);
}
const outPath = process.argv[3] || path.join(ROOT, 'docs/design/prototypes/.bundled', name);

/** 把 CSS 里的 url(/assets/…) 换成 data: URI，字体也一起带走 */
async function inlineAssets(css, cssOrigin) {
  const refs = [...css.matchAll(/url\((['"]?)(\/[^)'"]+)\1\)/g)];
  let out = css;
  for (const [whole, , href] of refs) {
    const file = path.join(PUBLIC_DIR, href.replace(/^\//, ''));
    try {
      const buf = await readFile(file);
      const ext = path.extname(file).toLowerCase();
      const mime = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
      out = out.replaceAll(whole, `url(data:${mime};base64,${buf.toString('base64')})`);
    } catch {
      console.warn(`  ! ${cssOrigin} 引用的 ${href} 读不到，保持原样（远程看会缺这个资源）`);
    }
  }
  return out;
}

const src = await readFile(path.join(PROTO_DIR, name), 'utf8');

// 1) 原型自己 <link> 的样式表，逐个内联
const links = [...src.matchAll(/<link[^>]+href="(\/[^"]+\.css)"[^>]*>/g)];
let externalCss = '';
for (const [, href] of links) {
  const file = path.join(PUBLIC_DIR, href.replace(/^\//, ''));
  const css = await readFile(file, 'utf8');
  externalCss += `\n/* ===== 内联自 ${href}（真实后台样式，未改一行）===== */\n`
    + await inlineAssets(css, href);
}

// 2) 原型页自己的 <style> 与 <body> 内容
const ownStyle = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/);
if (!bodyMatch) { console.error('源文件里找不到 <body>'); process.exit(2); }
const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [, name])[1].trim();

await writeFile(outPath, JSON.stringify({ title, externalCss, ownStyle, body: bodyMatch[1] }), 'utf8');
console.log(`已提取 → ${outPath}`);
console.log(`  标题: ${title}`);
console.log(`  内联样式表: ${links.length} 份，共 ${(externalCss.length / 1024).toFixed(1)} KB（含字体 base64）`);
console.log(`  原型自带样式: ${(ownStyle.length / 1024).toFixed(1)} KB`);
console.log(`  正文: ${(bodyMatch[1].length / 1024).toFixed(1)} KB`);
