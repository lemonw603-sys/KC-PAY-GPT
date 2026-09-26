import { closedLastStatusSql } from '../db/repositories/order-status-query-repository.js';
import { PublicApiError } from '../domain/public-api-error.js';

/**
 * 诊断页「失败原因统计」（D-393，Lemon 定：诊断页新增一张表、默认近 7 天、排除演练单）。
 * 只读：不写任何表。按提交时间（orders.created_at）取范围，与订单页默认的时间口径一致。
 */

/**
 * 演练单：有运行记录，但没有一条是「正式」的。正式运行（出现任意一条就是真实单）：
 *   - 常驻付款池跑的（worker_id 'pool:%'），但常驻池演练模式停在点击前的 BROWSER_REHEARSAL_STOPPED 不算；
 *   - worker_id 为空的——已退役的一次性付款脚本（go-live.sh，D-385）不写程序名，生产 09-06～09-13 共 6 次、5 次点过付款；
 *   - 付款状态越过了点击的——演练按设计永远不点付款，点过的一定是真单，不管程序叫什么。
 * 演练单由单次演练程序（程序名取服务器配置，现为 production-readonly-1）或下单预检（local-readonly-*）跑。
 * 没有运行记录的单（下单环节就停了、走 API 路线的）算真实单。
 * 按运行方而不是按收单代码判断：真实客户单被人按 RUNBOOK §3 用收单脚本收掉时，收单代码与演练收口一样，
 * 但它是常驻池跑的，不会被误排除。
 */
export function rehearsalOrderSql(alias = 'o') {
  return `(EXISTS (SELECT 1 FROM browser_runs rr INNER JOIN recharge_attempts rra ON rra.id = rr.recharge_attempt_id
              WHERE rra.order_id = ${alias}.id)
      AND NOT EXISTS (SELECT 1 FROM browser_runs rr INNER JOIN recharge_attempts rra ON rra.id = rr.recharge_attempt_id
              WHERE rra.order_id = ${alias}.id
                AND ((rr.worker_id LIKE 'pool:%' AND COALESCE(rr.last_error_code, '') <> 'BROWSER_REHEARSAL_STOPPED')
                  OR rr.worker_id IS NULL
                  OR COALESCE(rr.payment_state, 'NOT_STARTED') NOT IN ('NOT_STARTED', 'PAYMENT_ARMED'))))`;
}

/** 最终结局：成功（含成功后才关单的）/ 未成功 / 还没结束。关单规则与客户页同一份（closedLastStatusSql）。 */
export function orderOutcomeSql(alias = 'o') {
  return `CASE
      WHEN ${alias}.status = 'RECHARGE_SUCCESS' THEN 'SUCCESS'
      WHEN ${alias}.status = 'CLOSED' AND ${closedLastStatusSql(alias)} = 'RECHARGE_SUCCESS' THEN 'SUCCESS'
      WHEN ${alias}.status IN ('RECHARGE_FAILED', 'CARD_FAILED', 'CLOSED') THEN 'FAILED'
      ELSE 'OTHER' END`;
}

const RANGE_SQL = '(? IS NULL OR o.created_at >= ?) AND (? IS NULL OR o.created_at <= ?)';

export const FAILURE_STATS_TOTALS_SQL = `SELECT x.outcome, x.rehearsal, COUNT(*) AS n
  FROM (SELECT ${orderOutcomeSql('o')} AS outcome, ${rehearsalOrderSql('o')} AS rehearsal
          FROM orders o WHERE ${RANGE_SQL}) x
 GROUP BY x.outcome, x.rehearsal`;

// 未成功、非演练的单，最近的在前。每种原因展开时最多看 20 张，封顶 500 行防「全部」范围太大。
export const FAILURE_STATS_ORDERS_SQL = `SELECT o.id, o.public_no, o.plan_type, o.failure_code, o.failure_reason, o.created_at
  FROM orders o
 WHERE ${RANGE_SQL}
   AND (${orderOutcomeSql('o')}) = 'FAILED'
   AND NOT ${rehearsalOrderSql('o')}
 ORDER BY o.created_at DESC, o.id DESC
 LIMIT 500`;

// 每种原因的单数与最近一单，不受上面 500 行封顶影响。
export const FAILURE_STATS_REASONS_SQL = `SELECT COALESCE(NULLIF(o.failure_code, ''), '') AS code, COUNT(*) AS n, MAX(o.created_at) AS last_at
  FROM orders o
 WHERE ${RANGE_SQL}
   AND (${orderOutcomeSql('o')}) = 'FAILED'
   AND NOT ${rehearsalOrderSql('o')}
 GROUP BY COALESCE(NULLIF(o.failure_code, ''), '')`;

// 具体原话：导航失败自 09-25 起在 fail-closed 摘要里（navigationError / evidenceRef），付款段自 09-16 起在
// payment-outcome-diagnostic（diagnostic）。按订单 id 字面量取，不与 orders 关联（两表 id 列排序规则不同）。
export const FAILURE_STATS_DETAILS_SQL = `SELECT order_id, action, created_at, sequence_no,
       JSON_UNQUOTE(JSON_EXTRACT(summary_json, '$.navigationError')) AS navigation_error,
       JSON_UNQUOTE(JSON_EXTRACT(summary_json, '$.diagnostic')) AS diagnostic,
       JSON_UNQUOTE(JSON_EXTRACT(summary_json, '$.evidenceRef')) AS evidence_ref
  FROM browser_run_events
 WHERE order_id IN (?) AND action IN ('fail-closed', 'payment-outcome-diagnostic')
 ORDER BY created_at DESC, sequence_no DESC`;

const ORDERS_PER_REASON = 20;
const text = (value) => {
  const s = value == null ? '' : String(value).trim();
  return s && s !== 'null' ? s : null;
};
// 原话里不该有卡号；万一有，连续 8 位以上数字一律遮掉再给页面。
const clean = (value) => {
  const s = text(value);
  return s ? s.replace(/\d[\d\s-]{6,}\d/g, '[数字已隐藏]').replace(/\s+/g, ' ').slice(0, 300) : null;
};
const iso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

function parseBoundary(value, name) {
  if (value == null || value === '') return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new PublicApiError(`Invalid ${name}`, { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  return new Date(timestamp);
}

export function createFailureStatsService({ pool }) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool is required');
  return async function getFailureStats(input = {}) {
    const from = parseBoundary(input.from, 'from');
    const to = parseBoundary(input.to, 'to');
    if (from && to && from > to) throw new PublicApiError('Invalid time range', { code: 'INVALID_ADMIN_QUERY', status: 400 });
    const range = [from, from, to, to];

    const [totalRows] = await pool.query(FAILURE_STATS_TOTALS_SQL, range);
    const totals = { orders: 0, succeeded: 0, failed: 0, other: 0, rehearsalExcluded: 0 };
    for (const row of totalRows) {
      const n = Number(row.n) || 0;
      if (Number(row.rehearsal) === 1) { totals.rehearsalExcluded += n; continue; }
      totals.orders += n;
      if (row.outcome === 'SUCCESS') totals.succeeded += n;
      else if (row.outcome === 'FAILED') totals.failed += n;
      else totals.other += n;
    }

    const [reasonRows] = await pool.query(FAILURE_STATS_REASONS_SQL, range);
    const [orderRows] = await pool.query(FAILURE_STATS_ORDERS_SQL, range);
    const details = new Map();
    if (orderRows.length) {
      const [eventRows] = await pool.query(FAILURE_STATS_DETAILS_SQL, [orderRows.map((row) => row.id)]);
      for (const row of eventRows) {
        if (details.has(row.order_id)) continue; // 已按时间倒序，第一条有原话的就是最近一条
        const detail = clean(row.navigation_error) || clean(row.diagnostic);
        if (detail) details.set(row.order_id, { detail, evidenceRef: text(row.evidence_ref) });
      }
    }

    const byCode = new Map();
    for (const row of orderRows) {
      const code = text(row.failure_code) || '';
      if (!byCode.has(code)) byCode.set(code, []);
      const list = byCode.get(code);
      if (list.length >= ORDERS_PER_REASON) continue;
      const recorded = details.get(row.id);
      const fallback = clean(row.failure_reason);
      list.push({
        publicNo: row.public_no,
        planType: row.plan_type || null,
        createdAt: iso(row.created_at),
        // 先用执行时记下的原话；没有就用订单上写的说明（人工收单写的原因、卡台返回，或系统的笼统一句）。
        detail: recorded?.detail || fallback,
        detailSource: recorded ? 'EXECUTION' : (fallback ? 'ORDER' : null),
        evidenceRef: recorded?.evidenceRef || null,
      });
    }

    const reasons = reasonRows.map((row) => {
      const code = text(row.code) || '';
      const orders = byCode.get(code) || [];
      const latest = orders[0] || null;
      return {
        code,
        count: Number(row.n) || 0,
        share: totals.failed ? Math.round((Number(row.n) / totals.failed) * 1000) / 10 : 0,
        lastAt: iso(row.last_at),
        lastDetail: latest?.detail || null,
        lastDetailSource: latest?.detailSource || null,
        orders,
      };
    }).sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)));

    return { from: iso(from), to: iso(to), totals, reasons, ordersTruncated: orderRows.length >= 500 };
  };
}
