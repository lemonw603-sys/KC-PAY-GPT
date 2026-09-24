// 开/关供卡调度器的总闸（app_settings.card_auto_replenishment_enabled）。
//
// 为什么要单独一个脚本：后台没有这个总闸的控件（D-306/D-309），停自动开卡的日常做法是设置页把水位设 0；
// 真要关总闸走这里。（补余额整条线已随 D-367 删除，`card_balance_recharge_enabled` 不再存在。）
// prod-query.sh 是只读工具、不得用于写库。
// 这里走正式连接池 + 事务 + admin_setting_events 审计，与后台改其他开关同一套语义。
//
//   node v1/scripts/set-supply-scheduler-flag.mjs on            # 预览，不写
//   node v1/scripts/set-supply-scheduler-flag.mjs on --apply    # 真写
//   node v1/scripts/set-supply-scheduler-flag.mjs off --apply   # 关回去
//
// 打开后：pojia-card-stock-runner 每轮（timer 60s）按「卡台 × 产品」水位算缺口，
// 缺口 > 0 且日限内、钱包预检过，就建一张卡的 job 并当轮开出来——**会花钱**。
// 预览段把每台每产品的水位、库存口径可用数、缺口、今日已开列出来，先看清楚再 --apply。
import mysql from 'mysql2/promise';
// 库存口径与水位统计只用生产那一份，脚本里不抄第二份（D-191 / D-259）。
import { countEligibleCards } from '../src/services/card-source-selection-service.js';
import { countTodayOpenings } from '../src/services/card-stock-job-service.js';

const KEY = 'card_auto_replenishment_enabled';
const apply = process.argv.includes('--apply');
const mode = process.argv.find((a) => a === 'on' || a === 'off');
const actor = process.env.SETTING_ACTOR_ID || 'lemon-via-fable';

if (!mode) { console.error('用法: set-supply-scheduler-flag.mjs <on|off> [--apply]'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const value = mode === 'on' ? 'true' : 'false';

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  // 先把「开了会发生什么」算出来：每台每产品的水位 vs 库存口径可用数。
  const [policies] = await pool.query(
    `SELECT p.provider_account_id, pa.display_name, pa.supply_fault_state, pa.wallet_floor,
            p.product_code, p.target_available, p.open_card_amount, p.daily_open_limit
       FROM card_supply_policies p
       INNER JOIN provider_accounts pa ON pa.id = p.provider_account_id
      ORDER BY pa.display_name, p.product_code`
  );
  const preview = [];
  for (const row of policies) {
    const available = await countEligibleCards(pool, {
      providerAccountId: row.provider_account_id, productCode: row.product_code
    });
    const usedToday = await countTodayOpenings(pool, { providerAccountId: row.provider_account_id });
    preview.push({
      卡台: row.display_name, 产品: row.product_code,
      水位: Number(row.target_available), 库存口径可用: available,
      缺口: Math.max(0, Number(row.target_available) - available),
      开卡金额: String(row.open_card_amount), 今日已开: usedToday, 日限: Number(row.daily_open_limit),
      钱包底线: row.wallet_floor == null ? null : String(row.wallet_floor),
      卡台故障态: row.supply_fault_state
    });
  }
  console.table(preview);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1 FOR UPDATE', [KEY]);
    const previous = rows.length ? String(rows[0].setting_value) : null;
    console.log(JSON.stringify({
      key: KEY, previous: previous ?? '(未设置)', target: value, mode: apply ? 'apply' : 'dry-run'
    }, null, 2));
    if (!apply) {
      await connection.rollback();
      console.log('未写入（加 --apply 才写）。');
    } else if (previous === value) {
      await connection.rollback();
      console.log('已经是目标值，未写入、未记审计。');
    } else {
      await connection.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [KEY, value]
      );
      await connection.query(
        `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
        [KEY, previous, value, actor,
          `V2 落实第③步 C：${mode === 'on' ? '启用' : '停用'}供卡调度器总闸（只动这一个键，不碰补余额开关）`]
      );
      await connection.commit();
      console.log('已写入并记审计。');
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
