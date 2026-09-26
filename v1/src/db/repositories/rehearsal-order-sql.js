/**
 * 「演练单」只有这一份判定（D-395，2026-09-26 Lemon 定统一）：首页近 7 天成功率（D-339）与诊断页失败原因统计
 * （D-393）都用它。按运行方判定，不看收单代码、文案或事件标记：
 *
 * 演练单＝有运行记录，但没有一条是「正式运行」。出现任意一条正式运行就是真实单：
 *   - 常驻付款池跑的（worker_id 'pool:%'），但常驻池演练模式停在点击前的 BROWSER_REHEARSAL_STOPPED 不算；
 *   - worker_id 为空的——已退役的一次性付款脚本（go-live.sh，D-385）不写程序名，生产 09-06～09-13 共 6 次、5 次点过付款；
 *   - 付款状态越过了点击的——演练按设计永远不点付款，点过的一定是真单，不管程序叫什么。
 * 演练单由单次演练程序（程序名取服务器配置，现为 production-readonly-1）或下单预检（local-readonly-*）跑。
 * 没有运行记录的单（下单环节就停了、走 API 路线的）算真实单。
 *
 * 原 D-339 只认收单脚本在事件里打的 closeRehearsalOrder 标记：没用脚本收口的演练单（如 09-25 误跑预检的 pcNK）
 * 漏排；真实客户单若被人用脚本收掉又会被误排。按运行方判定两头都对。标记仍会写，只作审计信息。
 */
export function rehearsalOrderSql(alias = 'o') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid order SQL alias');
  return `(EXISTS (SELECT 1 FROM browser_runs rehearsal_run
              INNER JOIN recharge_attempts rehearsal_attempt ON rehearsal_attempt.id = rehearsal_run.recharge_attempt_id
              WHERE rehearsal_attempt.order_id = ${alias}.id)
      AND NOT EXISTS (SELECT 1 FROM browser_runs formal_run
              INNER JOIN recharge_attempts formal_attempt ON formal_attempt.id = formal_run.recharge_attempt_id
              WHERE formal_attempt.order_id = ${alias}.id
                AND ((formal_run.worker_id LIKE 'pool:%' AND COALESCE(formal_run.last_error_code, '') <> 'BROWSER_REHEARSAL_STOPPED')
                  OR formal_run.worker_id IS NULL
                  OR COALESCE(formal_run.payment_state, 'NOT_STARTED') NOT IN ('NOT_STARTED', 'PAYMENT_ARMED'))))`;
}
