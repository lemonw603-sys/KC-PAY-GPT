// D-354 一次性回填：把「补钱前」入库的卡的 funded_amount 抬到 = 当前同步余额 + 账本已花。
//
// 为什么需要：分卡资格取 LEAST(同步余额, funded_amount − 账本消费)。修好同步路径之后，
// **以后**的补款会自动记进 funded_amount（card-top-up.js），但已经补过钱的卡（2026-09-23 实例：
// 0601 余额 31.99 / funded 3.27）不会再有余额变化，永远不合格。这个脚本只对「账本推算余额
// 明显低于同步余额」的卡做一次抬平；不动余额、不动状态、不放松其它条件。
//
//   node v1/scripts/backfill-card-funded-amount.mjs            # 预览，不写
//   node v1/scripts/backfill-card-funded-amount.mjs --apply    # 真写（每张卡记 card_state_events）
//
// 口径复用生产那一份 ledgerSpendSql，不抄第二份（D-191）。
import mysql from 'mysql2/promise';
import { ledgerSpendSql } from '../src/services/card-inventory-eligibility.js';

const apply = process.argv.includes('--apply');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT c.id, c.last4, c.sync_tier, c.inventory_status, c.current_balance, c.funded_amount,
              ${ledgerSpendSql('c')} AS ledger_spent,
              pa.provider_code
         FROM cards c INNER JOIN provider_accounts pa ON pa.id = c.provider_account_id
        WHERE c.inventory_status <> 'RETIRED' AND COALESCE(c.source_present, 1) = 1
          AND c.current_balance IS NOT NULL
        ORDER BY pa.provider_code, c.last4 FOR UPDATE`);
    const targets = rows.map((row) => {
      const balance = Number(row.current_balance); const spent = Number(row.ledger_spent) || 0;
      const funded = row.funded_amount == null ? null : Number(row.funded_amount);
      const target = Math.round((balance + spent) * 1_000_000) / 1_000_000;
      const gap = funded == null ? target : Math.round((target - funded) * 1_000_000) / 1_000_000;
      return { ...row, balance, spent, funded, target, gap };
    }).filter((row) => row.gap >= 0.01);
    console.table(targets.map((r) => ({ 卡台: r.provider_code, 卡尾: r.last4, 层: r.sync_tier, 状态: r.inventory_status,
      同步余额: r.balance.toFixed(2), 账本已花: r.spent.toFixed(2), 现funded: r.funded == null ? '(空)' : r.funded.toFixed(2), 目标funded: r.target.toFixed(2), 抬升: r.gap.toFixed(2) })));
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates: targets.length }));
    if (!apply || !targets.length) { await connection.rollback(); console.log(apply ? '没有需要回填的卡。' : '未写入（加 --apply 才写）。'); }
    else {
      for (const row of targets) {
        await connection.query('UPDATE cards SET funded_amount = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND funded_amount <=> ?',
          [row.target.toFixed(6), row.id, row.funded_amount]);
        await connection.query(
          `INSERT INTO card_state_events (card_id, event_type, source, previous_json, current_json) VALUES (?, 'CARD_TOPUP_OBSERVED', 'backfill-D354', ?, ?)`,
          [row.id, JSON.stringify({ currentBalance: row.balance.toFixed(6), fundedAmount: row.funded == null ? null : row.funded.toFixed(6), ledgerSpent: row.spent.toFixed(6) }),
            JSON.stringify({ currentBalance: row.balance.toFixed(6), fundedAmount: row.target.toFixed(6), topUp: row.gap.toFixed(6), actor: process.env.SETTING_ACTOR_ID || 'lemon-via-fable' })]);
      }
      await connection.commit();
      console.log(`已回填 ${targets.length} 张卡并记事件。`);
    }
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
