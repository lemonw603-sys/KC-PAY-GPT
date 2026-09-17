// Sync 备用卡台 A (highvcc.com) into `cards` the only sanctioned way: pull every card through
// the platform API, render the "导入备用卡" workbook, run it through the manual import
// service (full-snapshot semantics, audit batch row). Default is preview (read-only against
// the database); --commit applies it. Output never contains PAN, CVC or the token.
//
//   node v1/scripts/sync-highvcc-snapshot.mjs            # preview: what would change
//   node v1/scripts/sync-highvcc-snapshot.mjs --commit   # apply the snapshot
//
// --commit 这一趟同时把授权流水写进 card_transactions、钱包余额写进
// provider_balance_snapshots（D-249 面四② T1，与「每日时段」模式同一趟）。
//
// 这两件**不能**挂在快照内部：prepare() 有个 NO_CHANGE 短路，卡片数据没变就整个
// collect() 都不跑（生产实见 2026-09-17 14:52:22 就是 skipped:NO_CHANGE）。挂进去等于
// 大部分时间不同步流水。所以放在这里，与快照结果无关地各跑一次。
// 三段互相独立：一段失败不挡另两段，但只要有一段失败整趟就是失败（exit 1），
// token 失效会让三段一起失败，正是「该时段任务失败、叫一次」要的效果。
//
// Needs DATABASE_URL, SESSION_ENCRYPTION_KEY_BASE64, CARD_INTAKE_PAN_HMAC_KEY_BASE64
// (on the host: source /etc/pojia/runtime.env; from the Mac: pull them the way
// browser-mvp/scripts/run-live-pool.sh does and point DATABASE_URL at the 13306 tunnel).
import mysql from 'mysql2/promise';
import { createHighvccSnapshotSyncService } from '../src/services/highvcc-snapshot-sync-service.js';

const commit = process.argv.includes('--commit');
for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY_BASE64', 'CARD_INTAKE_PAN_HMAC_KEY_BASE64']) {
  if (!process.env[name]) { console.error(`${name} is required`); process.exit(2); }
}

// D-169: a run that found nothing changed did no work at all — say so plainly instead
// of printing a shape full of zeros and empty arrays that reads like a failure.
const summarize = (p) => (p.skipped ? { skipped: true, reason: p.reason, cardCount: p.cardCount } : {
  sourceName: p.sourceName, filename: p.filename, rowCount: p.rowCount,
  insertCount: p.insertCount, updateCount: p.updateCount, unavailableCount: p.unavailableCount,
  missingCount: p.missingCount, activeRiskCount: p.activeRiskCount,
  conflictCount: p.conflictCount, rejectedCount: p.rejectedCount, commitAllowed: p.commitAllowed,
  // publicRow from the import service: last4 / status / balance / errors / warnings — no PAN.
  rows: (p.rows || []).map((r) => ({ last4: r.last4, status: r.status, balance: r.balance, state: r.state, errors: r.errors, warnings: r.warnings })),
  platform: p.platformCards,
});

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const service = createHighvccSnapshotSyncService({
    pool,
    encryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
    panHmacKey: Buffer.from(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64, 'base64'),
  });
  if (!commit) {
    const preview = await service.preview();
    console.log(JSON.stringify({ mode: 'preview', ...summarize(preview) }, null, 2));
  } else {
    const out = { mode: 'commit' };
    const failures = [];
    const step = async (name, run) => {
      try { out[name] = await run(); }
      catch (error) {
        out[name] = { failed: true, code: error.code || error.constructor.name, message: error.message };
        failures.push(name);
      }
    };
    await step('snapshot', async () => {
      const result = await service.commit({ requestedBy: 'sync-highvcc-snapshot.mjs' });
      return { preview: summarize(result.preview), committed: result.committed };
    });
    await step('wallet', () => service.syncWallet());
    await step('transactions', () => service.syncTransactions());
    console.log(JSON.stringify(out, null, 2));
    if (failures.length) {
      console.error('failed steps:', failures.join(','));
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  if (error.preview) console.error(JSON.stringify(summarize(error.preview), null, 2));
  if (error.detail) console.error('detail:', error.detail);
  process.exitCode = 1;
} finally {
  await pool.end();
}
