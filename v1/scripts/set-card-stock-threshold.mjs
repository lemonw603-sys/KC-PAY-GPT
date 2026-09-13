// 改「可用卡库存偏低」的告警阈值（app_settings.card_stock_low_threshold）。
//
// 为什么需要这个脚本：后台只读不写这个设置，而 prod-query.sh 是只读工具、不得用于写库。
// 这里走正式连接池 + 事务 + admin_setting_events 审计，与后台改其他开关同一套语义。
//
//   node v1/scripts/set-card-stock-threshold.mjs 1            # 预览，不写
//   node v1/scripts/set-card-stock-threshold.mjs 1 --apply    # 真写
//
// 语义（workflow-repository.js 分卡后检查）：可直接分配卡数 <= 阈值 且未开自动开卡时，
// 发 CARD_STOCK_LOW 告警。阈值 0 等于"一张都不剩才报"，那时客户已经在等卡了。
import mysql from 'mysql2/promise';
// 资格口径只用生产那一份，脚本里不抄第二份（D-191：抄的那刻就开始漂移）。
import { eligibleInventoryCardSql } from '../src/services/card-inventory-eligibility.js';

const KEY = 'card_stock_low_threshold';
const apply = process.argv.includes('--apply');
const raw = process.argv.find((a) => /^\d+$/.test(a));

if (raw === undefined) { console.error('用法: set-card-stock-threshold.mjs <0-50> [--apply]'); process.exit(2); }
const value = Number(raw);
if (!Number.isInteger(value) || value < 0 || value > 50) {
  console.error(`阈值必须是 0~50 的整数，收到 ${raw}`); process.exit(2);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1 FOR UPDATE', [KEY]);
    const previous = rows.length ? String(rows[0].setting_value) : null;
    console.log(`当前值: ${previous ?? '(未设置)'}  →  目标值: ${value}`);

    // 顺带把当前库存报出来，让人一眼看出这个阈值会不会立刻触发。
    // 用的是分卡时真正执行的那份资格 SQL，与告警里 remaining 的口径完全一致。
    const [[minRow]] = await connection.query(
      `SELECT setting_value FROM app_settings WHERE setting_key='default_minimum_required_card_balance'`);
    const minBalance = String(minRow?.setting_value ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(minBalance)) throw new Error(`卡余额门槛取不到数字: ${minBalance}`);
    const [[stock]] = await connection.query(
      `SELECT COUNT(*) AS n FROM cards c WHERE ${eligibleInventoryCardSql('c', minBalance)}`);
    console.log(`当前可分配卡（正式资格 SQL）: ${stock.n} 张 —— 阈值 ${value} 时${stock.n <= value ? '会' : '不会'}立刻触发告警`);

    if (!apply) { await connection.rollback(); console.log('\n预览模式，未写入。加 --apply 才真写。'); }
    else if (String(previous ?? '') === String(value)) { await connection.rollback(); console.log('\n值没有变化，不写。'); }
    else {
      await connection.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [KEY, String(value)]);
      await connection.query(
        `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [KEY, previous, String(value), 'set-card-stock-threshold.mjs',
          '阈值 0 等于一张卡都不剩才报警，客户那时已在等卡；改成剩最后 N 张就提醒']);
      await connection.commit();
      console.log('\n已写入并记审计。');
    }
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
} finally { await pool.end(); }
