#!/usr/bin/env node
// highvcc token 对照检查（D-414 补记十，Lemon 2026-10-01 选「乙」）：在 Lemon 电脑上每小时用一份**单独的** token
// 查一次 highvcc 钱包，只记「几点、能不能用」，和服务器那份 token 对比谁先失效：
//   两份同时失效 → 卡台那边统一作废；只有服务器那份失效 → 卡台只作废服务器在用的这份（风控 / 出口地址）。
//
// 判断复用生产同一份调用代码（v1/src/providers/highvcc-card.js），「失效」的认法和服务器一致，不另抄规则。
// token 从本机文件读（目录 700、文件 600，不进 git、不打印、不上传）；日志只有时间、结果码、token 文件保存时间。
//
//   node scripts/highvcc-token-probe.mjs            # 查一次，结果追加到日志并打印同一行
//   文件：~/Library/Application Support/pojia-highvcc-probe/token   （Lemon 用 pbpaste 写入，见 RUNBOOK）
//   日志：~/Library/Application Support/pojia-highvcc-probe/probe.log
import { readFile, stat, appendFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(os.homedir(), 'Library/Application Support/pojia-highvcc-probe');
const TOKEN_FILE = path.join(DIR, 'token');
const LOG_FILE = path.join(DIR, 'probe.log');
const { createHighvccCardProvider } = await import(path.join(ROOT, 'v1/src/providers/highvcc-card.js'));

await mkdir(DIR, { recursive: true, mode: 0o700 });
let savedAt = 'unknown';
try { savedAt = (await stat(TOKEN_FILE)).mtime.toISOString(); } catch { /* 没有文件：下面报 HIGHVCC_TOKEN_MISSING */ }
const provider = createHighvccCardProvider({
  getAccessToken: async () => (await readFile(TOKEN_FILE, 'utf8').catch(() => '')).trim() || null,
  defaultTimeoutMs: 15_000
});
let result;
try {
  await provider.wallet();
  result = 'OK';
} catch (error) {
  result = String(error?.code || error?.name || 'ERROR');
}
const line = `${new Date().toISOString()} ${result} tokenSavedAt=${savedAt}`;
await appendFile(LOG_FILE, `${line}\n`, { mode: 0o600 });
console.log(line);
