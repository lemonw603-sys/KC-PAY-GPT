// 改「某产品的最低所需卡余额」（app_settings.minimum_required_card_balance:<product>）。
//
// 为什么需要这个脚本：这个值目前唯一的后台入口在卡片页块 2 里，而那块按 V2 §3.3 / D-284 ①
// 要撤（供给参数归设置页）；设置页 D-290 那张大表又漏做了「最低余额」这一项。
// 在它搬进设置页之前，改这个值只能走脚本 —— prod-query.sh 是只读工具、不得用于写库。
// 这里走正式连接池 + 事务 + admin_setting_events 审计，与后台改其他设置同一套语义。
//
//   node v1/scripts/set-minimum-card-balance.mjs pro_5x 95           # 预览，不写
//   node v1/scripts/set-minimum-card-balance.mjs pro_5x 95 --apply   # 真写
//
// 语义（order-intake-repository.minimumRequiredCardBalanceForPlan）：建单时按 CDK 所带产品
// 取这个值，取不到才回落全局 default。余额低于此值的卡不参与该产品的分配。

import mysql from 'mysql2/promise';
// 资格口径只用生产那一份，脚本里不抄第二份（D-191：抄的那刻就开始漂移）。
import { eligibleInventoryCardSql, minimumBalanceSql } from '../src/services/card-inventory-eligibility.js';

const PRODUCTS = new Set(['plus', 'pro_5x', 'pro_20x']);
const apply = process.argv.includes('--apply');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [product, raw] = args;

if (!PRODUCTS.has(String(product))) {
  console.error(`用法: set-minimum-card-balance.mjs <${[...PRODUCTS].join('|')}> <金额> [--apply]`);
  process.exit(2);
}
if (!/^\d+(\.\d{1,2})?$/.test(String(raw))) {
  console.error(`金额必须是数字（最多两位小数），收到 ${raw}`);
  process.exit(2);
}
const value = Number(raw);
if (!(value >= 0 && value <= 1000)) { console.error('金额必须在 0~1000 之间'); process.exit(2); }
// plus 没有专属键，它用的就是全局 default（与 minimumRequiredCardBalanceForPlan 的回落一致）
const KEY = product === 'plus' ? 'default_minimum_required_card_balance' : `minimum_required_card_balance:${product}`;
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1 FOR UPDATE', [KEY]);
    const previous = rows.length ? String(rows[0].setting_value) : null;
    console.log(`产品 ${product}  键 ${KEY}`);
    console.log(`当前值: ${previous ?? '(未设置，回落 default)'}  →  目标值: ${value.toFixed(2)}`);

    // 改前/改后该产品的可分配卡数 —— 用分卡时真正执行的那份资格 SQL，口径与建单一致。
    // 让人一眼看出这次改动会不会把某个产品的库存直接清零。
    const countWith = async (minSql) => {
      const [[row]] = await connection.query(
        `SELECT COUNT(*) AS n FROM cards c WHERE ${eligibleInventoryCardSql('c', minSql, { productCode: product })}`);
      return Number(row.n || 0);
    };
    const before = await countWith(minimumBalanceSql(product));
    const after = await countWith(String(value));
    console.log(`该产品可分配卡：${before} 张  →  ${after} 张${after < before ? '（会减少）' : after > before ? '（会增加）' : '（不变）'}`);

    if (!apply) {
      await connection.rollback();
      console.log('\n预览模式，未写入。加 --apply 才真写。');
    } else if (String(previous ?? '') === value.toFixed(2)) {
      await connection.rollback();
      console.log('\n值没有变化，不写。');
    } else {
      await connection.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [KEY, value.toFixed(2)]);
      await connection.query(
        `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [KEY, previous, value.toFixed(2), 'set-minimum-card-balance.mjs',
          `${product} 的最低所需卡余额按 Lemon 确认值设定；低于此值的卡不参与该产品分配`]);
      await connection.commit();
      console.log('\n已写入并记审计。请用新连接独立复核。');
    }
  } finally {
    connection.release();
  }
} finally {
  await pool.end();
}
