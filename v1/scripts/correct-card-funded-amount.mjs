// 把一张卡记错的注资（funded_amount）改成正确值，留审计（card_state_events: CARD_FUNDED_CORRECTED）。
//
//   node scripts/correct-card-funded-amount.mjs --account <卡台账户 id> --last4 <尾号> --from <现值> --to <正确值> --reason "<为什么>"          # 预览
//   node scripts/correct-card-funded-amount.mjs ... --apply                                                                                # 真写
//   Needs DATABASE_URL（生产主机 source /etc/pojia/runtime.env）。
//
// 为什么要有：注资只会被「快照看到余额上涨」往上记（D-354），提回 / 退款不会往下减。2026-09-29 那次
// 「补 $1 再提回」实测让 8499 从 16 记成了 17（CARD_TOPUP_OBSERVED 00:24:07 UTC，+1.000000），钱早已提回。
// 分卡看「余额」与「注资 − 账本」的较小者，注资多记会让账本那一侧虚高。
//
// 硬校验：卡台账户 + 尾号只命中一张未退役的卡；--from 必须等于库里现值（防止拿过期的数改）；
// 两个数都是合法金额；写的时候 WHERE funded_amount = 现值，同一事务记审计。
import mysql from 'mysql2/promise';
import { toCents, fromCents } from '../src/domain/card-issue-fee.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] || '').trim() : ''; };
const accountId = value('--account');
const last4 = value('--last4');
const fromCentsArg = toCents(value('--from'));
const toCentsArg = toCents(value('--to'));
const reason = value('--reason');
const actorId = value('--actor') || 'operator';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!accountId || !/^\d{4}$/.test(last4) || !Number.isInteger(fromCentsArg) || !Number.isInteger(toCentsArg) || toCentsArg < 0 || !reason) {
  console.error('usage: --account <id> --last4 <4 digits> --from <current funded> --to <correct funded> --reason "<text>" [--apply] [--actor <name>]');
  process.exit(2);
}

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [cards] = await connection.query(
    `SELECT id, last4, inventory_status, funded_amount, current_balance FROM cards
      WHERE provider_account_id = ? AND last4 = ? AND inventory_status <> 'RETIRED' FOR UPDATE`, [accountId, last4]);
  const card = cards[0];
  const currentCents = card ? toCents(String(card.funded_amount ?? '')) : null;
  const checks = {
    exactlyOneCard: cards.length === 1,
    fromMatchesDatabase: cards.length === 1 && currentCents === fromCentsArg,
    changes: fromCentsArg !== toCentsArg,
  };
  const summary = { mode: apply ? 'apply' : 'dry-run', last4, matched: cards.length,
    card: card ? { inventoryStatus: card.inventory_status, fundedAmount: String(card.funded_amount), currentBalance: card.current_balance == null ? null : String(card.current_balance) } : null,
    to: fromCents(toCentsArg), reason, checks };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    await connection.rollback();
    console.log(JSON.stringify({ ...summary, refused: failed }, null, 2));
    process.exitCode = 1;
  } else if (!apply) {
    await connection.rollback();
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const [updated] = await connection.query(
      `UPDATE cards SET funded_amount = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND funded_amount = ?`,
      [fromCents(toCentsArg), card.id, String(card.funded_amount)]);
    if (Number(updated.affectedRows) !== 1) throw new Error('card changed concurrently; nothing written');
    await connection.query(
      `INSERT INTO card_state_events (card_id, event_type, source, previous_json, current_json)
       VALUES (?, 'CARD_FUNDED_CORRECTED', ?, ?, ?)`,
      [card.id, `operator:${actorId}`.slice(0, 64),
        JSON.stringify({ fundedAmount: String(card.funded_amount) }),
        JSON.stringify({ fundedAmount: fromCents(toCentsArg), reason })]);
    await connection.commit();
    console.log(JSON.stringify({ ...summary, written: true }, null, 2));
  }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
