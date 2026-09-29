// D-411 按单补钱：补钱登记表（card_top_ups）的状态迁移与「补钱结果不明」告警。
//
// 状态机：PREPARED（分卡时登记）→ SENDING（发请求前先落库）→ SUBMITTED（卡台受理）→ CONFIRMED（卡详情到账）
//        └→ REJECTED（明确没动钱：卡台拒绝 / 钱包不够 / token 失效 / 流水证实没发出去）
//        └→ UNKNOWN（发了但结果不明：超时、断网、受理后 3 分钟不到账、发送中进程死了）
// 「只发一次」：每一步迁移都带 WHERE status = 旧状态；SENDING 一旦落库，重跑只会走「按不明处理」，绝不再发。
// 订单侧（换卡、进 CARD_READY）在 workflow-repository 里做，这里只管补钱这一行和告警。

import { toCents } from '../../domain/card-issue-fee.js';

export const TopUpStatus = Object.freeze({
  PREPARED: 'PREPARED',
  SENDING: 'SENDING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN'
});

export const TOP_UP_ALERT_TYPE = 'CARD_TOP_UP_UNRESOLVED';
export const topUpAlertKey = (topUpId) => `card-top-up:${topUpId}`;

function text(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/** 卡台原样返回里只留 code / msg / data（补钱返回的 data 是新余额数字），不留别的。 */
export function safeProviderResponse(response) {
  if (!response || typeof response !== 'object') return null;
  return JSON.stringify({ code: response.code ?? null, msg: text(response.msg, 200), data: response.data ?? null });
}

const COLUMNS = `t.id, t.card_id, t.order_id, t.provider_account_id, t.amount, t.currency, t.status,
  t.balance_before, t.balance_after, t.error_code, t.order_detached, t.check_count,
  t.sending_at, t.submitted_at, t.finished_at, t.created_at,
  c.provider_card_id, c.external_card_id, c.last4`;

export async function loadTopUp(queryable, topUpId, { forUpdate = false } = {}) {
  const [rows] = await queryable.query(
    `SELECT ${COLUMNS} FROM card_top_ups t INNER JOIN cards c ON c.id = t.card_id
     WHERE t.id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [topUpId]);
  return rows[0] || null;
}

/** 这一单最近一次、还处在给定状态里的补钱。 */
export async function findTopUpForOrder(queryable, orderId, statuses) {
  const list = [...statuses];
  const [rows] = await queryable.query(
    `SELECT ${COLUMNS} FROM card_top_ups t INNER JOIN cards c ON c.id = t.card_id
     WHERE t.order_id = ? AND t.status IN (${list.map(() => '?').join(',')})
     ORDER BY t.created_at DESC LIMIT 1`, [orderId, ...list]);
  return rows[0] || null;
}

export async function insertPreparedTopUpInTransaction(connection, {
  id, cardId, orderId, providerAccountId, amount, balanceBefore = null
}) {
  await connection.query(
    `INSERT INTO card_top_ups (id, card_id, order_id, provider_account_id, amount, currency, status, balance_before)
     VALUES (?, ?, ?, ?, ?, 'USD', 'PREPARED', ?)`,
    [id, cardId, orderId, providerAccountId, String(amount), balanceBefore == null ? null : String(balanceBefore)]);
  return id;
}

/**
 * PREPARED → SENDING。返回 true 才表示「这次由我来发」；false = 已经有人发过或状态变了，不许发。
 * 同一事务里先排好「查到账」任务：一旦落了 SENDING，这笔补钱就一定有人跟到底——哪怕发完之后、
 * 记 SUBMITTED 之前进程死了，或补钱任务本身死了（对抗审查 2026-09-30 发现的「补钱丢了唯一的看守」）。
 */
export async function markSending(pool, topUpId, { balanceBefore = null, orderId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE card_top_ups SET status = 'SENDING', sending_at = CURRENT_TIMESTAMP(3),
         balance_before = COALESCE(?, balance_before)
       WHERE id = ? AND status = 'PREPARED'`,
      [balanceBefore == null ? null : String(balanceBefore), topUpId]);
    const mine = Number(result.affectedRows) === 1;
    if (mine && orderId) await enqueueTopUpCheck(connection, { orderId, topUpId, delayMs: 5_000 });
    await connection.commit();
    return mine;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function markSubmitted(queryable, topUpId, response) {
  const [result] = await queryable.query(
    `UPDATE card_top_ups SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP(3), provider_response_json = ?
     WHERE id = ? AND status = 'SENDING'`, [safeProviderResponse(response), topUpId]);
  return Number(result.affectedRows) === 1;
}

/** 只从「还没了结」的状态进 UNKNOWN；已到账 / 已拒绝的不动。 */
export async function markUnknown(queryable, topUpId, { code, message = null, response = null }) {
  const [result] = await queryable.query(
    `UPDATE card_top_ups SET status = 'UNKNOWN', error_code = ?, error_message = ?,
       provider_response_json = COALESCE(?, provider_response_json)
     WHERE id = ? AND status IN ('SENDING','SUBMITTED','UNKNOWN')`,
    [text(code, 64), text(message, 255), safeProviderResponse(response), topUpId]);
  return Number(result.affectedRows) === 1;
}

export async function markRejectedInTransaction(connection, topUpId, { code, message = null, response = null,
  allowedFrom = ['PREPARED', 'SENDING', 'UNKNOWN'], resolvedBy = null }) {
  const [result] = await connection.query(
    `UPDATE card_top_ups SET status = 'REJECTED', error_code = ?, error_message = ?,
       provider_response_json = COALESCE(?, provider_response_json), finished_at = CURRENT_TIMESTAMP(3),
       resolved_by = COALESCE(?, resolved_by)
     WHERE id = ? AND status IN (${allowedFrom.map(() => '?').join(',')})`,
    [text(code, 64), text(message, 255), safeProviderResponse(response), text(resolvedBy, 128), topUpId, ...allowedFrom]);
  return Number(result.affectedRows) === 1;
}

export async function markConfirmedInTransaction(connection, topUpId, { balanceAfter, resolvedBy = null }) {
  const [result] = await connection.query(
    `UPDATE card_top_ups SET status = 'CONFIRMED', balance_after = ?, finished_at = CURRENT_TIMESTAMP(3),
       resolved_by = COALESCE(?, resolved_by)
     WHERE id = ? AND status IN ('SUBMITTED','UNKNOWN')`,
    [String(balanceAfter), text(resolvedBy, 128), topUpId]);
  return Number(result.affectedRows) === 1;
}

export async function markOrderDetachedInTransaction(connection, topUpId) {
  await connection.query('UPDATE card_top_ups SET order_detached = 1 WHERE id = ?', [topUpId]);
}

export async function bumpCheckCount(queryable, topUpId) {
  await queryable.query('UPDATE card_top_ups SET check_count = check_count + 1 WHERE id = ?', [topUpId]);
}

/**
 * 「补钱结果不明」叫人（推送白名单 HUMAN）。补钱卡住时客户页 3 分钟后说「已通知运营」——这一条就是那个通知。
 * 同一笔补钱只有一条（dedupe），核对了结时由 resolveTopUpAlert 关掉。
 */
export async function upsertTopUpAlert(queryable, { topUpId, orderId = null, last4, amount, detail, orderWaiting = false }) {
  const title = `补钱结果不明：卡 ${last4 || '?'}`;
  const message = `往卡 ${last4 || '?'} 补 $${String(amount).replace(/(\.\d\d)\d*$/, '$1')} ${detail}。系统不会重补，这张卡先不分配；`
    + (orderWaiting ? '客户这一单还停在「正在准备支付卡」，没有程序在处理它。' : '客户这一单已换卡处理。')
    + '请到卡台看这张卡余额和账户流水，确认钱到了没有，再用 resolve-card-top-up.mjs 了结（RUNBOOK §2.56）。';
  await queryable.query(
    `INSERT INTO operator_alerts (id, alert_type, dedupe_key, order_id, severity, title, message, status)
     VALUES (UUID(), ?, ?, ?, 'critical', ?, ?, 'OPEN')
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title), message = VALUES(message),
       status = IF(status = 'RESOLVED', 'OPEN', status),
       acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
    [TOP_UP_ALERT_TYPE, topUpAlertKey(topUpId), orderId, title.slice(0, 255), message.slice(0, 1000)]);
}

export async function resolveTopUpAlert(queryable, topUpId) {
  await queryable.query(
    `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))
     WHERE dedupe_key = ? AND status = 'OPEN'`, [topUpAlertKey(topUpId)]);
}

/** 同一卡台还没从钱包扣走的补钱（待发 / 发送中），钱包检查要先减掉，免得两单同时补把钱包压破押金。 */
export async function pendingTopUpAmountCents(queryable, { providerAccountId, excludeTopUpId = null }) {
  const [[row]] = await queryable.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM card_top_ups
     WHERE provider_account_id = ? AND status IN ('PREPARED','SENDING') AND (? IS NULL OR id <> ?)`,
    [providerAccountId, excludeTopUpId, excludeTopUpId]);
  const cents = toCents(String(row?.total ?? '0'));
  if (!Number.isInteger(cents)) throw new Error('pending top-up total is not a money amount');
  return cents;
}

/**
 * 同一卡台已排队、还没开出来的卡预计要花的钱（开卡任务 PENDING / RUNNING）。开卡任务先落库、runner 稍后才真开卡扣钱包，
 * 中间可能隔一分钟；补钱发之前不扣掉它，两边各自对着同一个钱包余额判「够」，合起来就可能压破押金底线。
 */
export async function inflightCardOpenCents(queryable, { providerAccountId }) {
  const [[row]] = await queryable.query(
    `SELECT COALESCE(SUM(COALESCE(estimated_total, amount * GREATEST(requested_count - opened_count, 0))), 0) AS total
       FROM card_stock_jobs WHERE provider_account_id = ? AND status IN ('PENDING','RUNNING')`, [providerAccountId]);
  const cents = toCents(String(row?.total ?? '0'));
  if (!Number.isInteger(cents)) throw new Error('in-flight card open total is not a money amount');
  return cents;
}

/**
 * 排（或重排）一次「查到账」任务。去重键按补钱一行，同一笔补钱永远只有一个查询任务；
 * 查询本身靠「可重试、不计次数」往后挪（task-runner 的 refundAttempt），这里只负责第一次排上。
 */
export async function enqueueTopUpCheck(queryable, { orderId, topUpId, delayMs = 3_000 }) {
  // payload 带上补钱 id：查到账按补钱这一行找，不按订单找——订单换卡后可能又有了别的补钱。
  await queryable.query(
    `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts, available_at, payload_json)
     VALUES (?, 'CHECK_TOP_UP', 'PENDING', ?, 100, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND), JSON_OBJECT('topUpId', ?))
     ON DUPLICATE KEY UPDATE status = 'PENDING', attempts = 0, available_at = VALUES(available_at),
       payload_json = VALUES(payload_json),
       leased_by = NULL, leased_until = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP(3)`,
    [orderId, `check-top-up:${topUpId}`, Math.max(0, Math.trunc(delayMs)) * 1000, topUpId]);
}

/** 巡检兜底用：还没了结、已经超过 minutes 分钟、却还没有「补钱结果不明」告警行的补钱。 */
export function stuckTopUpsWithoutAlertSql() {
  return `SELECT t.id, t.order_id, t.status, t.amount, t.order_detached, c.last4,
      TIMESTAMPDIFF(MINUTE, t.created_at, CURRENT_TIMESTAMP(3)) AS waited
    FROM card_top_ups t INNER JOIN cards c ON c.id = t.card_id
    WHERE t.status IN ('PREPARED','SENDING','SUBMITTED','UNKNOWN')
      AND t.created_at < CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE
      AND NOT EXISTS (SELECT 1 FROM operator_alerts a WHERE a.dedupe_key = CONCAT('card-top-up:', t.id))`;
}
