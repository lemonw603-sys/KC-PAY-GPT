// 本机「不登录渲染」服务（2026-09-30）：页面文件原样取自 v1/public（一个字节不改），
// 页面读的 /api/v1/admin/* 从 snapshot-admin-api.mjs 生成的 JSON 里答（只答 GET；没截到的接口回 404，页面按读取失败显示）。
// 用途：演示后台登录不了时（例如这一会话的安全检查不让填密码），照样用真页面、真数据给 Lemon 看改动。
// 只读、只在本机：不连数据库、不碰生产、不写任何东西。
//   node scripts/local-admin/render-server.mjs [端口，默认 8811] [页面目录，默认 v1/public]
//   第二个参数用来拿旧版页面（git archive 导出）在同一份数据上对比，分清差异是不是这次改出来的。
//   数据文件：~/Library/Application Support/pojia-local-admin/render-api.json
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public'));
const DATA = path.join(os.homedir(), 'Library/Application Support/pojia-local-admin/render-api.json');
const PORT = Number(process.argv[2] || 8811);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    const map = JSON.parse(await readFile(DATA, 'utf8').catch(() => '{}'));
    const body = req.method === 'GET' ? map[pathname] : undefined;
    res.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(body === undefined ? { error: 'not_in_render_snapshot' } : body));
  }
  // 字体照真后台的映射（create-app.js：/admin/assets/fonts → public/assets/fonts）。漏了这条字体会静默回退，
  // 截图和量宽度就不是线上的样子（2026-10-01 查出：此前的演示截图都是替代字体）。
  const file = pathname === '/admin' || pathname === '/admin/' ? '/admin/index.html'
    : pathname.startsWith('/admin/assets/fonts/') ? pathname.replace('/admin/assets/fonts/', '/assets/fonts/') : pathname;
  const target = path.join(PUBLIC, path.normalize(file));
  if (!target.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1', () => console.log(`render server http://localhost:${PORT}/admin`));
