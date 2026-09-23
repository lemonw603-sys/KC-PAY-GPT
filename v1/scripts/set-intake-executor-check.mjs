// 开/关「下单时检查执行器心跳」（app_settings.intake_executor_heartbeat_check，D-352 块 3 ②）。
//
// 默认（键缺失或 'true'）= 检查：所选路线的执行器心跳超过 120s 没更新就拒单
// （EXECUTOR_UNAVAILABLE，客户看到「系统维护，暂时无法接单」，CDK 不消耗）。
// 只有运维演练需要关它：演练流程是「停常驻池 → 关付款开关 → 建演练单 → 单单演练」，
// 建单那一步池是停着的，不关检查就建不了单。演练完记得开回去（wrapup 会看这个键）。
//
//   node v1/scripts/set-intake-executor-check.mjs off            # 预览，不写
//   node v1/scripts/set-intake-executor-check.mjs off --apply    # 真写（演练前）
//   node v1/scripts/set-intake-executor-check.mjs on --apply     # 演练后开回
//
// 走正式连接池 + 事务 + admin_setting_events 审计；prod-query.sh 是只读工具、不得用于写库。
import mysql from 'mysql2/promise';
import { EXECUTOR_HEARTBEAT_CHECK_SETTING, EXECUTOR_HEARTBEAT_SETTING } from '../src/db/repositories/order-intake-repository.js';

const KEY = EXECUTOR_HEARTBEAT_CHECK_SETTING;
const apply = process.argv.includes('--apply');
const mode = process.argv.find((a) => a === 'on' || a === 'off');
const actor = process.env.SETTING_ACTOR_ID || 'lemon-via-fable';

if (!mode) { console.error('用法: set-intake-executor-check.mjs <on|off> [--apply]'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const value = mode === 'on' ? 'true' : 'false';

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1 FOR UPDATE', [KEY]);
    const previous = rows.length ? String(rows[0].setting_value) : null;
    const [heartbeats] = await connection.query(
      'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)',
      [EXECUTOR_HEARTBEAT_SETTING.BROWSER, EXECUTOR_HEARTBEAT_SETTING.API]);
    console.log(JSON.stringify({
      key: KEY, previous: previous ?? '(未设置 = 检查)', target: value, mode: apply ? 'apply' : 'dry-run',
      heartbeats: Object.fromEntries(heartbeats.map((r) => [r.setting_key, r.setting_value]))
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
        [KEY, value]);
      await connection.query(
        `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
        [KEY, previous, value, actor, `D-352 块3②：${mode === 'on' ? '恢复' : '暂停'}下单时的执行器心跳检查（${mode === 'off' ? '演练窗口' : '演练结束'}）`]);
      await connection.commit();
      console.log('已写入并记审计。');
    }
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
