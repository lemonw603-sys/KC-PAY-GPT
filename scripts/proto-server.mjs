#!/usr/bin/env node
// 原型预览服务：把 docs/design/prototypes/ 下的原型，放到**和真实后台同源**的地方看。
//
// 为什么要这么做（2026-09-20）：上一轮原型自己另写了一套 CSS，原型里 28px 的按钮搬进
// 实现变成 34px，只能回头一个个对。根治办法是让原型直接 <link> 真实的 workbench.css、
// 直接用真实 class —— 但那样原型必须和后台同源，否则 @font-face 会被 CORS 挡掉，
// 字体悄悄回退，原型看着就不是那一版了。
// 所以这里把 /admin/assets/* 和 /assets/* 反代到真实后台，其余路径当静态原型目录。
//
// 用法：
//   PROTO_UPSTREAM=http://localhost:8803 node scripts/proto-server.mjs [端口]
// 然后开 http://localhost:8899/step6-opsbar-v5.html
//
// 只读、零依赖、不碰生产目录。用完 Ctrl-C 或 pkill -f proto-server.mjs。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_DIR = path.join(ROOT, 'docs/design/prototypes');
const UPSTREAM = (process.env.PROTO_UPSTREAM || 'http://localhost:8803').replace(/\/+$/, '');
const PORT = Number(process.argv[2] || process.env.PROTO_PORT || 8899);
const PROXY_PREFIXES = ['/admin/assets/', '/assets/'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  // 1) 真实后台的样式与字体：原样转发，让原型拿到和实现**同一份**文件
  if (PROXY_PREFIXES.some((p) => pathname.startsWith(p))) {
    try {
      const upstream = await fetch(UPSTREAM + req.url);
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`上游 ${UPSTREAM} 取不到 ${pathname}：${err.message}\n`
        + '后台没起就先起后台 —— 原型缺了真实 CSS 就不是那一版了，不要凑合看。\n');
    }
    return;
  }

  // 2) 原型文件本身。限定在 PROTO_DIR 内，挡掉 ../ 穿越
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PROTO_DIR, rel);
  if (!file.startsWith(PROTO_DIR + path.sep)) {
    res.writeHead(403).end('403'); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`原型目录里没有 ${rel}\n`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`原型预览 http://localhost:${PORT}/  （样式与字体反代自 ${UPSTREAM}）`);
});
