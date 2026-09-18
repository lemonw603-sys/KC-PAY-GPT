// 日对账执行器：每天由 pojia-daily-reconciliation.timer 跑一次（第⑤步，面四③ / D-249）。
//
//   ① 跑两种对账（次数 / 金额），判据在 domain/card-transaction-audit.js。
//   ② 写心跳 `daily_reconciliation_heartbeat_at`，让后台能看出它到底有没有在跑。
//   ③ 推**一条**汇总（`DAILY_RECONCILIATION_SUMMARY`，含待销到期数 —— Lemon 定不单推）。
//   ④ 差异前期只进看板；**连续两次还在**的差异才升成 critical（D-249：怕误判和延迟误推）。
//
// 只读：除了心跳、上次指纹、和那条汇总告警，不动任何业务表。
//   node v1/scripts/daily-reconciliation-runner.js            # 跑一次、写心跳、按需推
//   node v1/scripts/daily-reconciliation-runner.js --dry-run  # 只打报告，什么都不写
import { loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { createDailyReconciliationService, reconciliationAlertPlan } from '../src/services/daily-reconciliation-service.js';
import { upsertSupplyAlert, resolveSupplyAlert, resolveSupplyAlertsByPrefix } from '../src/services/card-supply-scheduler-service.js';

const dryRun = process.argv.includes('--dry-run');
const HEARTBEAT_SETTING = 'daily_reconciliation_heartbeat_at';
const SUMMARY_TYPE = 'DAILY_RECONCILIATION_SUMMARY';

const pool = createDatabasePool(loadRuntimeDatabaseConfig());
try {
  const service = createDailyReconciliationService({ pool });
  const report = await service.run({ persist: !dryRun });
  // 报告里逐卡带 last4 与金额，没有卡号/CVV/token；直接打进 journal 是安全的。
  console.log(JSON.stringify({ dryRun, ...report }));

  if (!dryRun) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [HEARTBEAT_SETTING, report.generatedAt]
    );
    // 日报按天 key（F-56：升 critical 是新行、能重推）。每次先收掉「除今天外的历史日报」——昨天、
    // 更早、上线前遗留的旧固定/旧日期 key（F-54/F-59），保证当前只有今天这一条 OPEN。
    const plan = reconciliationAlertPlan(report);
    await resolveSupplyAlertsByPrefix(pool, plan.historyLike, plan.key);
    if (plan.action === 'upsert') {
      await upsertSupplyAlert(pool, {
        type: SUMMARY_TYPE, key: plan.key,
        severity: plan.severity, title: plan.title, message: plan.message
      });
    } else {
      await resolveSupplyAlert(pool, plan.key);
    }
  }
  if (report.persistentCount > 0) process.exitCode = 0; // 差异不是执行失败，不用非零退出吓人
} catch (error) {
  console.error(JSON.stringify({
    dryRun, failed: true, code: error?.code || 'DAILY_RECONCILIATION_FAILED'
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
