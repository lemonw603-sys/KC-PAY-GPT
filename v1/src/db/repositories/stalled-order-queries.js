// 巡检（scripts/operator-watch.mjs）用的「卡住」判断 SQL（D-390，欠账 17）。
import { needsPersonOrderSql } from '../../services/admin-read-service.js';
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

/**
 * 第四种卡住（D-414 补记十一，Lemon 2026-10-02 同意「API 单一直处理中要推手机」）：API 单停在
 * 「提交中 / 充值处理中」太久。上面三种只看走 Browser 的单（有派发任务）；API 单此前没有任何巡检——
 * 直充平台一直回 pending 时，查询任务问满 720 次（每 5 秒，约 1 小时）就放弃，订单停在 RECHARGE_PROCESSING，
 * 客户页一直「处理中」，没人收到推送（2026-10-01 复核第一批时查出）。
 * 已有「付款不明待核实」「API 充值失败」告警在管的单不重复报。参数：分钟数。
 */
export const API_PROCESSING_STUCK_SQL = `SELECT o.id, o.public_no, o.status, o.recharge_order_no,
       TIMESTAMPDIFF(MINUTE, o.updated_at, CURRENT_TIMESTAMP(3)) AS waited,
       EXISTS (SELECT 1 FROM tasks t WHERE t.order_id = o.id AND t.task_type = 'POLL_RECHARGE'
                AND t.status IN ('PENDING', 'RUNNING')) AS still_checking
  FROM orders o
  INNER JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
 WHERE fr.executor_kind = 'API'
   AND o.status IN ('SUBMITTING', 'RECHARGE_PROCESSING')
   AND o.updated_at < CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE
   AND NOT EXISTS (SELECT 1 FROM operator_alerts covered
     WHERE covered.order_id = o.id AND covered.status <> 'RESOLVED'
       AND covered.alert_type IN ('ORDER_PAYMENT_UNKNOWN_REVIEW', 'API_ORDER_FAILED'))`;

/** API 单离开「提交中 / 充值处理中」（结束、或转进付款不明等别的流程），它的「处理太久」就收掉。 */
export const RESOLVE_API_STALLED_SQL = `UPDATE operator_alerts oa
   INNER JOIN orders o ON o.id = oa.order_id
   SET oa.status = 'RESOLVED', oa.acknowledged_at = COALESCE(oa.acknowledged_at, CURRENT_TIMESTAMP(3))
 WHERE oa.alert_type = 'API_ORDER_STALLED' AND oa.status = 'OPEN'
   AND o.status NOT IN ('SUBMITTING', 'RECHARGE_PROCESSING')`;

export function apiStuckAlert(row) {
  const platform = row.recharge_order_no ? `直充平台单号 ${row.recharge_order_no}。` : '还没拿到直充平台单号（可能卡在提交那一步）。';
  const checking = Number(row.still_checking)
    ? '系统还在每 5 秒问一次平台。'
    : '系统已经停止询问平台（查满 1 小时自动放弃）。';
  return {
    type: 'API_ORDER_STALLED',
    orderId: row.id,
    title: 'API 单处理太久，客户还在等',
    message: `已 ${row.waited} 分钟没有结果（停在${row.status === 'SUBMITTING' ? '提交中' : '充值处理中'}）。${platform}${checking}`
      + '系统不会重付、不会换卡。请到直充平台后台看这单的结果。',
  };
}

/**
 * 订单结束了、这单也不再需要人（与后台「需要我处理」同一谓词），它的「浏览器单失败 / 要人工」提醒就收掉
 * （D-405，2026-09-27 Lemon 同意；此前生产 33 条自用期的这类提醒一直 OPEN）。
 * 失败提醒是订单失败那一刻开的，而提醒一关、未发出的推送会被取消——所以必须等推送发完：
 * 这条提醒当前事件版本没有 PENDING / RETRY / SENDING 的推送，并且至少挂了 10 分钟。
 */
export function resolveFinishedOrderAlertsSql() {
  return `UPDATE operator_alerts oa
   INNER JOIN orders o ON o.id = oa.order_id
   SET oa.status = 'RESOLVED', oa.acknowledged_at = COALESCE(oa.acknowledged_at, CURRENT_TIMESTAMP(3))
 WHERE oa.alert_type IN ('BROWSER_ORDER_FAILED', 'BROWSER_HUMAN_REQUIRED') AND oa.status = 'OPEN'
   AND o.status IN ('RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED', 'CARD_FAILED')
   AND NOT ${needsPersonOrderSql()}
   AND oa.updated_at < CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE
   AND NOT EXISTS (SELECT 1 FROM alert_notifications fin_an
     WHERE fin_an.alert_id = oa.id AND fin_an.incident_version = oa.incident_version
       AND fin_an.status IN ('PENDING', 'RETRY', 'SENDING'))`;
}

export function preStuckAlert(row) {
  return {
    type: 'BROWSER_ORDER_STALLED',
    orderId: row.id,
    title: '客户卡住了，停在付款前没人处理',
    message: `已 ${row.waited} 分钟没有程序在处理这一单，客户页仍显示「处理中」。还没点付款，钱没动。`
      + '先看本机付款池在不在跑；池子正常却一直没人接手，在后台打开这一单点「放弃并放卡」，卡密会退回、客户可以重新兑换（RUNBOOK §3）。',
  };
}
