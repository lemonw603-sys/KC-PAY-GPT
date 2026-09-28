import { rehearsalOrderSql } from './rehearsal-order-sql.js';
import { productShortLabel } from '../../domain/product-labels.js';

/**
 * 「充值成功」推送（D-409，Lemon 2026-09-29 选乙：每单只在结束时推一条）。
 *
 * 两条路线共用：巡检（operator-watch，每分钟一轮）找刚成功的单，每单开一条 ORDER_RECHARGE_SUCCEEDED
 * （dedupe `order-succeeded:<订单 id>`，一单只会有一条），手机上显示「充值成功 / 邮箱 · 产品 · 用时」。
 * 不在付款链路里产生：成功由 API worker、Browser 执行器、人工收口等多处写出，挂在其中任何一处都会漏另一处；
 * 巡检按订单最终状态统一捡，最多晚一分钟。失败照旧由各路线自己的失败告警推。
 *
 * 只捡 30 分钟内结束的：上线第一轮不会把历史成功单全推一遍。演练单不推（与近7天成功率同一份判定）。
 */
export const ORDER_SUCCEEDED_ALERT_TYPE = 'ORDER_RECHARGE_SUCCEEDED';
export const SUCCESS_PUSH_LOOKBACK_MINUTES = 30;

export const orderSucceededAlertKey = (orderId) => `order-succeeded:${orderId}`;

export function newlySucceededOrdersSql() {
  return `SELECT o.id, p.legacy_plan_type AS plan_type,
          GREATEST(0, TIMESTAMPDIFF(SECOND, o.created_at, o.finished_at)) AS seconds
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
    WHERE o.status = 'RECHARGE_SUCCESS'
      AND o.finished_at >= CURRENT_TIMESTAMP(3) - INTERVAL ${SUCCESS_PUSH_LOOKBACK_MINUTES} MINUTE
      AND NOT ${rehearsalOrderSql('o')}
      AND NOT EXISTS (SELECT 1 FROM operator_alerts succ_oa
        WHERE succ_oa.dedupe_key = CONCAT('order-succeeded:', o.id))`;
}

/** 用时：45 秒 / 1 分 50 秒 / 2 小时 3 分。 */
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} 小时${m ? ` ${m} 分` : ''}`;
  if (m > 0) return `${m} 分${s ? ` ${s} 秒` : ''}`;
  return `${s} 秒`;
}

export function succeededAlert(row) {
  const product = productShortLabel(row.plan_type) || 'Plus';
  return {
    type: ORDER_SUCCEEDED_ALERT_TYPE,
    dedupeKey: orderSucceededAlertKey(row.id),
    orderId: row.id,
    severity: 'info',
    title: '充值成功',
    message: `${product} · 用时 ${formatDuration(row.seconds)}`
  };
}

/** 开成功推送；返回这一轮开了几条。INSERT IGNORE：并发两轮巡检也只会有一条。 */
export async function recordSucceededOrders(connection) {
  const [rows] = await connection.query(newlySucceededOrdersSql());
  for (const row of rows) {
    const alert = succeededAlert(row);
    await connection.query(
      `INSERT IGNORE INTO operator_alerts (id, alert_type, dedupe_key, order_id, severity, title, message, status)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [alert.type, alert.dedupeKey, alert.orderId, alert.severity, alert.title, alert.message]
    );
  }
  return rows.length;
}

/**
 * 推完的成功提醒收掉：它只是通知，没有要人做的事，不该堆在后台。
 * 推送已发出（SENT）或发不出去放弃（DEAD）就收；万一推送一直没轮到，一天后也收。
 */
export function resolveDeliveredSuccessAlertsSql() {
  return `UPDATE operator_alerts succ_oa
      SET succ_oa.status = 'RESOLVED', succ_oa.acknowledged_at = COALESCE(succ_oa.acknowledged_at, CURRENT_TIMESTAMP(3))
    WHERE succ_oa.alert_type = '${ORDER_SUCCEEDED_ALERT_TYPE}' AND succ_oa.status = 'OPEN'
      AND (succ_oa.created_at < CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY
        OR EXISTS (SELECT 1 FROM alert_notifications succ_an
          WHERE succ_an.alert_id = succ_oa.id AND succ_an.incident_version = succ_oa.incident_version
            AND succ_an.status IN ('SENT', 'DEAD')))`;
}
