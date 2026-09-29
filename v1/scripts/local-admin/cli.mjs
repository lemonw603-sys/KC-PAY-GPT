#!/usr/bin/env node
// scripts/local-admin.sh 的 Node 一侧：造数、比对、口令哈希、状态。库地址与密钥都从环境变量读（local-admin.sh 注入）。
//   node scripts/local-admin/cli.mjs seed      按 shape.json 造数并比对（不一致退出码 3）
//   node scripts/local-admin/cli.mjs verify    只比对
//   node scripts/local-admin/cli.mjs hash      从 stdin 读口令，打印 scrypt 哈希（口令本身不打印）
//   node scripts/local-admin/cli.mjs summary   打印快照摘要
//   node scripts/local-admin/cli.mjs counts    打印本机库各主要表行数（status 用）
import mysql from 'mysql2/promise';
import { hashAdminPassword } from '../../src/security/admin-session.js';
import { readShape } from './shape.mjs';
import { seedLocalAdmin } from './seed.mjs';
import { summarizeShape } from './summary.mjs';
import { formatVerifyReport, verifyAgainstShape } from './verify.mjs';

const command = process.argv[2];

function assertLocalDatabase(url) {
  const parsed = new URL(url);
  const db = parsed.pathname.replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^pojia_local_admin(_[a-z0-9]+)?$/.test(db)) {
    throw new Error(`只写本机 pojia_local_admin* 库，拒绝：${parsed.hostname}/${db}`);
  }
  return db;
}

function keysFromEnv(env = process.env) {
  const key = (name) => (env[name] ? Buffer.from(env[name], 'base64') : null);
  return {
    sessionEncryptionKey: key('SESSION_ENCRYPTION_KEY_BASE64'),
    cdkHashKey: key('CDK_HASH_KEY_V1_BASE64'),
    cdkRecoveryKey: key('CDK_RECOVERY_KEY_BASE64'),
    cardIntakePanHmacKey: key('CARD_INTAKE_PAN_HMAC_KEY_BASE64')
  };
}

async function withPool(run) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 未设置');
  assertLocalDatabase(url);
  const pool = mysql.createPool({ uri: url, timezone: 'Z', decimalNumbers: false, connectionLimit: 4 });
  try { return await run(pool); } finally { await pool.end(); }
}

if (command === 'hash') {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (password.length < 12) throw new Error('口令太短');
  console.log(await hashAdminPassword(password));
} else if (command === 'summary') {
  console.log(summarizeShape(readShape()));
} else if (command === 'seed') {
  const shape = readShape();
  const keys = keysFromEnv();
  if (!keys.sessionEncryptionKey || !keys.cdkHashKey || !keys.cdkRecoveryKey) throw new Error('缺少本机密钥（先 up）');
  const code = await withPool(async (pool) => {
    const stats = await seedLocalAdmin({ pool, shape, keys });
    console.log(`造数完成：${Object.entries(stats).map(([t, n]) => `${t} ${n}`).join('，')}`);
    const report = await verifyAgainstShape(pool, shape);
    console.log(formatVerifyReport(report));
    return report.ok ? 0 : 3;
  });
  process.exitCode = code;
} else if (command === 'verify') {
  const shape = readShape();
  process.exitCode = await withPool(async (pool) => {
    const report = await verifyAgainstShape(pool, shape);
    console.log(formatVerifyReport(report));
    return report.ok ? 0 : 3;
  });
} else if (command === 'counts') {
  await withPool(async (pool) => {
    const tables = ['orders', 'cards', 'cdks', 'cdk_batches', 'operator_alerts', 'card_consumption_ledger', 'card_transactions', 'browser_runs'];
    const parts = [];
    for (const table of tables) {
      const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      parts.push(`${table} ${row.n}`);
    }
    console.log(parts.join('，'));
  });
} else {
  console.error('用法：cli.mjs seed|verify|hash|summary|counts');
  process.exitCode = 2;
}
