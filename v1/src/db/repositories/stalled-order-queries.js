// 巡检（scripts/operator-watch.mjs）用的「卡住」判断 SQL（D-390，欠账 17）。
// 放在这里而不是写死在脚本里：脚本、测试、customer-sql-probe 对生产实跑用的是同一份。

/**
 * 第三种卡住：订单停在付款前，却没有任何程序在处理它——客户页照样显示「处理中」，
 * 而既有告警一条都不响（D-386 盘点 P1 #4：执行器已放弃、订单仍 RECHARGE_PROCESSING）。
 *
 * 「有人在处理 / 已有别的告警管」的一律排除，剩下的就是真没人管：
 *   - 派发任务 QUEUED：第一种（排队太久）管；
 *   - 派发任务 CLAIMED 且租约未过期（或刚过期不到 N 分钟——常驻池每秒都在找过期任务重新领）：有人在处理；
 *   - run RUNNING 且租约未过期（同上留 N 分钟）：在跑，含 D-210 付款前失败等运营接手的 90 秒；
 *   - run HUMAN_REQUIRED：BROWSER_HUMAN_REQUIRED 管；
 *   - run 的付款状态已越过 NOT_STARTED / PAYMENT_ARMED：付款阶段，第二种（付款结果不落定）或核实通道管。
 * 只看走 Browser 的单（有派发任务）；API 路线另有 v1 任务与告警。
 * 三个参数都是分钟数 N（巡检的 --minutes，默认 3）。
 */
export const PRE_PAYMENT_STUCK_SQL = `SELECT o.id, o.public_no,
       TIMESTAMPDIFF(MINUTE, o.updated_at, CURRENT_TIMESTAMP(3)) AS waited
  FROM orders o
 WHERE o.status = 'RECHARGE_PROCESSING'
   AND o.updated_at < CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE
   AND EXISTS (SELECT 1 FROM browser_dispatch_jobs d WHERE d.order_id = o.id)
   AND NOT EXISTS (
     SELECT 1 FROM browser_dispatch_jobs d
      WHERE d.order_id = o.id
        AND (d.status = 'QUEUED'
          OR (d.status = 'CLAIMED' AND d.lease_until >= CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE)))
   AND NOT EXISTS (
     SELECT 1 FROM browser_runs r
      INNER JOIN recharge_attempts ra ON ra.id = r.recharge_attempt_id
      WHERE ra.order_id = o.id
        AND ((r.status = 'RUNNING' AND r.worker_lease_until >= CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE)
          OR r.status = 'HUMAN_REQUIRED'
          OR COALESCE(r.payment_state, 'NOT_STARTED') NOT IN ('NOT_STARTED', 'PAYMENT_ARMED')))`;

/**
 * 订单结束了，它的「客户卡住了」告警就收掉。以前这类告警从来不自动解除（生产 09-12～09-18 的
 * 3 条一直 OPEN，对应订单早已 CLOSED），后台越积越多；同一单再卡住时也因为还 OPEN 而不再推。
 * 只收已结束的单：还在进行的单可能正卡在另一种情况里，不能替它判断。收掉不推手机
 * （alert-notification-repository 只为 OPEN 入队、非 OPEN 的待发通知会被取消）。
 */
export const RESOLVE_FINISHED_STALLED_SQL = `UPDATE operator_alerts oa
   INNER JOIN orders o ON o.id = oa.order_id
   SET oa.status = 'RESOLVED', oa.acknowledged_at = COALESCE(oa.acknowledged_at, CURRENT_TIMESTAMP(3))
 WHERE oa.alert_type = 'BROWSER_ORDER_STALLED' AND oa.status = 'OPEN'
   AND o.status IN ('RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED', 'CARD_FAILED')`;

export function preStuckAlert(row) {
  return {
    type: 'BROWSER_ORDER_STALLED',
    orderId: row.id,
    title: '客户卡住了，停在付款前没人处理',
    message: `已 ${row.waited} 分钟没有程序在处理这一单，客户页仍显示「处理中」。还没点付款，钱没动。`
      + '先看本机付款池在不在跑（ready-check.sh）；池子正常却一直没人接手，按 RUNBOOK §3「付款前挂住」收单，客户卡密会退回、可重新兑换。',
  };
}
