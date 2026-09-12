// 把 highvcc access token 存进后台（app_settings，加密），走与后台「卡片」页同一个 service，
// 不绕过任何校验。token 只从 stdin 读——不进命令行参数（进程列表可见）、不落盘、不打印。
//
//   echo -n "<token>" | node v1/scripts/set-highvcc-token.mjs [--by 同步脚本]
//
// 需要 DATABASE_URL 与 SESSION_ENCRYPTION_KEY_BASE64（主机上 source /etc/pojia/runtime.env）。
// 配套的本机取 token 脚本：browser-mvp/scripts/sync-highvcc-token.mjs
import mysql from 'mysql2/promise';
import { createHighvccCardService } from '../src/services/highvcc-card-service.js';

const args = process.argv.slice(2);
const by = (() => { const i = args.indexOf('--by'); return i >= 0 ? String(args[i + 1] || 'cli') : 'cli'; })();

const token = await new Promise((resolve, reject) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { buf += chunk; if (buf.length > 8192) reject(new Error('token 过长')); });
  process.stdin.on('end', () => resolve(buf.trim()));
  process.stdin.on('error', reject);
});
if (!token) { console.error('没有从 stdin 读到 token'); process.exit(2); }

const databaseUrl = process.env.DATABASE_URL;
const keyBase64 = process.env.SESSION_ENCRYPTION_KEY_BASE64;
if (!databaseUrl || !keyBase64) { console.error('需要 DATABASE_URL 与 SESSION_ENCRYPTION_KEY_BASE64'); process.exit(2); }

const pool = mysql.createPool(databaseUrl);
try {
  const service = createHighvccCardService({ pool, encryptionKey: Buffer.from(keyBase64, 'base64') });
  await service.setToken({ token, requestedBy: by });
  // 存完立刻用它打一次只读接口，确认这份 token 真的能用——存进去但是废的没有意义。
  let usable = null;
  try { await service.walletStatus(); usable = true; } catch (error) { usable = false; var why = String(error?.code || error?.message || '').slice(0, 80); }
  console.log(JSON.stringify({ saved: true, usable, ...(usable ? {} : { why }) }));
  process.exitCode = usable ? 0 : 1;
} catch (error) {
  console.error(String(error?.code || error?.message || error).slice(0, 200));
  process.exitCode = 1;
} finally {
  await pool.end();
}
