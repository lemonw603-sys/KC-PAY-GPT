import { releaseCardForFailedOrderInTransaction } from '../db/repositories/card-release-repository.js';
import { returnCdkForOrderInTransaction } from '../db/repositories/cdk-return-repository.js';
import { transitionCardConsumptionInTransaction } from './card-consumption-ledger-service.js';

/**
 * 付款前停下、却没人收口的单：放弃并放卡（D-394）。
 *
 * 规则原本只在 scripts/close-rehearsal-order.mjs 里（演练残单收口，RUNBOOK §2 / §3）。后台的「取消并放卡」
 * 对跑过一次的单一律拒（order-cancellation-service 的 SUBMISSION_RISK），于是付款前挂住的客户单只能 SSH 跑脚本，
 * Lemon 一个人处理不了。这里把那套判断和写库原样搬成一份：脚本与后台按钮共用，抽屉摆不摆按钮也问同一份。
 *
 * 守卫不变：任何付款痕迹一律拒；还有 run 在 RUNNING 且租约没过期（付款池可能还在处理）一律拒。
 */

export const PRE_PAYMENT_CLOSABLE_STATUSES = Object.freeze(['CARD_READY', 'RECHARGE_PROCESSING']);

export class PrePaymentCloseoutRefused extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'PrePaymentCloseoutRefused';
    this.code = code;
    this.detail = detail;
    this.status = code === 'ORDER_NOT_FOUND' ? 404 : 409;
  }
}

const EVIDENCE_SQL = `SELECT
       (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id AND ra.funds_risk_state IN ('UNKNOWN','SETTLED')) AS unknown_or_paid_attempts,
       (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id AND ra.funds_risk_state = 'ACTIVE') - ? AS unexpected_active_attempts,
       (SELECT COUNT(*) FROM card_consumption_ledger l WHERE l.order_id = o.id AND l.status IN ('CONSUMED','RECONCILIATION')) AS consumed_ledger,
       (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND br.payment_state <> 'NOT_STARTED') AS runs_past_arming,
       (SELECT COUNT(*) FROM browser_operations bo INNER JOIN browser_runs br ON br.id = bo.browser_run_id
          INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND bo.operation_type = 'PAYMENT_SUBMIT') AS payment_submits,
       (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND br.active_account_key_hmac IS NOT NULL) - ? AS unexpected_open_runs,
       o.recharge_order_no, o.recharge_card_key
     FROM orders o WHERE o.id = ?`;

const noPaymentTrace = (row) => String(row.payment_state) === 'NOT_STARTED'
  && !String(row.last_checkpoint_kind || '').toUpperCase().startsWith('PAYMENT');

/**
 * 处理中的单长什么样才算「付款前停下、可以收」（纯函数，读的是 attempts 与 runs 两张表的行）：
 *   a) worker fail-closed 后退出：那条 PREPARED/ACTIVE attempt 挂着 run RUNNING/NOT_STARTED、租约已过期；
 *   b) worker 自己付款前中止后按设计重排：旧 attempt 已 CLEARED/CLEARED，又有一条新 PREPARED/ACTIVE、还没有 run。
 * 所以不是「只有一条 attempt」，而是「恰好一条还活着、其余都已清、任何 run 都没有付款痕迹」。
 */
export function prePaymentShapeVerdict({ attempts, runs, now = new Date() }) {
  const pending = attempts.filter((row) => row.status === 'PREPARED' && row.funds_risk_state === 'ACTIVE');
  const settled = attempts.filter((row) => !(row.status === 'PREPARED' && row.funds_risk_state === 'ACTIVE'));
  const attempt = pending[0];
  const run = attempt ? runs.find((row) => row.recharge_attempt_id === attempt.id) || null : null;
  const otherRuns = runs.filter((row) => row.id !== run?.id);
  const leaseUntil = run?.worker_lease_until ? new Date(run.worker_lease_until) : null;
  const shape = {
    attempts: attempts.length, pendingAttempts: pending.length,
    settledAttempts: settled.map((row) => `${row.status}/${row.funds_risk_state}`),
    attemptStatus: attempt?.status, fundsRiskState: attempt?.funds_risk_state, executorKind: attempt?.executor_kind,
    runs: runs.length, runStatus: run?.status ?? null, paymentState: run?.payment_state ?? null,
    lastCheckpoint: run?.last_checkpoint_kind ?? null,
    otherRunStates: otherRuns.map((row) => `${row.status}/${row.payment_state}/${row.last_checkpoint_kind || '-'}`),
    leaseUntil: run?.worker_lease_until ?? null,
    leaseExpired: leaseUntil ? leaseUntil.getTime() < now.getTime() : null,
  };
  const structural = pending.length === 1 && attempt.executor_kind === 'BROWSER'
    // 已清掉的 attempt 只能是 CLEARED/CLEARED：FAILED/UNKNOWN/SETTLED 都意味着动过钱。
    && settled.every((row) => row.status === 'CLEARED' && row.funds_risk_state === 'CLEARED')
    // 任何 run 都不许有付款痕迹，包括已经终态的那些。
    && runs.every(noPaymentTrace)
    && (run === null || run.status === 'RUNNING');
  if (!structural) return { eligible: false, reasonCode: 'NOT_PRE_PAYMENT_SHAPE', shape, attempt, run };
  // 形态对，但付款池可能还拿着它：等租约过期再收，别和一个活着的 worker 抢。
  if (run && shape.leaseExpired !== true) return { eligible: false, reasonCode: 'RUN_LEASE_ACTIVE', shape, attempt, run };
  return { eligible: true, reasonCode: null, shape, attempt, run };
}

/** 读当前状态并给出判断。lock=true 用在收口事务里（FOR UPDATE），false 用在后台抽屉决定摆不摆按钮。 */
export async function readPrePaymentCloseoutState(queryable, order, { lock = false, now = new Date() } = {}) {
  if (!PRE_PAYMENT_CLOSABLE_STATUSES.includes(order.status)) {
    return { eligible: false, reasonCode: 'NOT_PRE_PAYMENT_STATUS', shape: null, evidence: null, blockers: {} };
  }
  const forUpdate = lock ? ' FOR UPDATE' : '';
  let verdict = null;
  if (order.status === 'RECHARGE_PROCESSING') {
    const [attempts] = await queryable.query(
      `SELECT id, status, funds_risk_state, executor_kind FROM recharge_attempts WHERE order_id = ?${forUpdate}`, [order.id]);
    const [runs] = await queryable.query(
      `SELECT br.id, br.status, br.payment_state, br.last_checkpoint_kind, br.worker_lease_until, br.recharge_attempt_id
         FROM browser_runs br INNER JOIN recharge_attempts ra ON ra.id = br.recharge_attempt_id
        WHERE ra.order_id = ?${forUpdate}`, [order.id]);
    verdict = prePaymentShapeVerdict({ attempts, runs, now });
    if (!verdict.eligible) return { ...verdict, evidence: null, blockers: {} };
  }
  const [[evidence]] = await queryable.query(EVIDENCE_SQL, [verdict ? 1 : 0, verdict?.run ? 1 : 0, order.id]);
  const blockers = Object.fromEntries(Object.entries(evidence || {})
    .filter(([, value]) => (typeof value === 'number' ? value > 0 : Boolean(value))));
  if (Object.keys(blockers).length) {
    return { eligible: false, reasonCode: 'PAYMENT_EVIDENCE', shape: verdict?.shape || null, evidence, blockers, attempt: verdict?.attempt, run: verdict?.run };
  }
  return { eligible: true, reasonCode: null, shape: verdict?.shape || null, evidence, blockers,
    attempt: verdict?.attempt || null, run: verdict?.run || null, preSubmit: Boolean(verdict) };
}

/**
 * 在调用方的事务里收掉一张付款前停下的单：关 run 与 attempt、释放账本占用、放卡、取消派单、订单 CLOSED、退卡密。
 * 与原脚本同一顺序（即 browser-execution-repository 的 PRE_PAYMENT_ABORT 段）。拒绝时抛 PrePaymentCloseoutRefused。
 */
export async function closePrePaymentOrderInTransaction(connection, {
  publicNo, reason, actorId = 'admin', runErrorCode, failureCode, source, skipCdkReturn = false, now = new Date(),
  // 额外写进订单事件与卡密退回记录的标记。演练收口必须带 closeRehearsalOrder:true——经营成功率（D-339）
  // 只认这个标记排除演练；后台放弃的是真实客户单，绝不能带。
  eventMetadata = {},
} = {}) {
  if (!reason || !runErrorCode || !failureCode || !source) throw new TypeError('reason, runErrorCode, failureCode and source are required');
  const [[order]] = await connection.query(
    'SELECT id, status, version, assigned_card_id, cdk_id FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]);
  if (!order) throw new PrePaymentCloseoutRefused('ORDER_NOT_FOUND', 'order not found');
  if (!PRE_PAYMENT_CLOSABLE_STATUSES.includes(order.status)) {
    throw new PrePaymentCloseoutRefused('NOT_PRE_PAYMENT_STATUS',
      `order is ${order.status}; only CARD_READY / RECHARGE_PROCESSING pre-payment orders are closable here`);
  }
  const state = await readPrePaymentCloseoutState(connection, order, { lock: true, now });
  if (!state.eligible) {
    if (state.reasonCode === 'PAYMENT_EVIDENCE') {
      throw new PrePaymentCloseoutRefused(state.reasonCode, `payment evidence present, refusing: ${JSON.stringify(state.blockers)}`, state.blockers);
    }
    throw new PrePaymentCloseoutRefused(state.reasonCode, `not a pre-payment rehearsal leftover, refusing: ${JSON.stringify(state.shape)}`, state.shape);
  }
  const fromStatus = order.status;
  let runCloseout = null;
  if (state.preSubmit) {
    // 形态 b 的 run 已经是 FAILED_SAFE 终态（worker 自己收的），没有 run 要关。
    if (state.run) {
      const [runUpdate] = await connection.query(
        `UPDATE browser_runs
            SET status = 'FAILED_SAFE', control_state = 'RELEASED', last_checkpoint_kind = 'PRE_PAYMENT_ABORT',
                last_error_code = ?, worker_lease_until = NULL,
                finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'RUNNING' AND payment_state = 'NOT_STARTED'`,
        [runErrorCode, now, now, state.run.id]);
      if (Number(runUpdate.affectedRows) !== 1) throw new PrePaymentCloseoutRefused('CHANGED_CONCURRENTLY', 'browser run changed concurrently');
    }
    const [attemptUpdate] = await connection.query(
      `UPDATE recharge_attempts
          SET status = 'CLEARED', funds_risk_state = 'CLEARED', result_summary_json = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND executor_kind = 'BROWSER' AND status = 'PREPARED' AND funds_risk_state = 'ACTIVE'`,
      [JSON.stringify({ code: runErrorCode, browserRunId: state.run?.id || null, noExternalPaymentAction: true }), now, now, state.attempt.id]);
    if (Number(attemptUpdate.affectedRows) !== 1) throw new PrePaymentCloseoutRefused('CHANGED_CONCURRENTLY', 'funds attempt changed concurrently');
    runCloseout = { runId: state.run?.id || null, attemptId: state.attempt.id, shape: state.shape };
  }
  const ledger = await transitionCardConsumptionInTransaction(connection, {
    orderId: order.id, targetStatus: 'RELEASED', reason: `Order closed before payment: ${reason}`,
    allowedCurrentStatuses: ['RESERVED'], requireActive: false, evidence: { source },
  });
  const card = await releaseCardForFailedOrderInTransaction(connection, { orderId: order.id, releasedBy: actorId, reason });
  // 派单不收掉会一直停在 QUEUED，控制面上显示「排队中」。
  const [dispatch] = await connection.query(
    `UPDATE browser_dispatch_jobs SET status = 'CANCELLED', last_error_code = 'CANCELLED_PRE_SUBMISSION',
       completed_at = CURRENT_TIMESTAMP(3), lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE order_id = ? AND status IN ('QUEUED','CLAIMED')`, [order.id]);
  const [closed] = await connection.query(
    `UPDATE orders SET status = 'CLOSED', assigned_card_id = NULL,
       failure_code = ?, failure_reason = ?,
       version = version + 1, finished_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND version = ?`, [failureCode, reason, order.id, order.version]);
  if (Number(closed.affectedRows) !== 1) throw new PrePaymentCloseoutRefused('CHANGED_CONCURRENTLY', 'order changed concurrently');
  await connection.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, ?, 'CLOSED', 'ADMIN', ?, ?, ?)`,
    [order.id, fromStatus, String(actorId).slice(0, 128), reason, JSON.stringify({ ...eventMetadata, source, evidence: state.evidence, ledger, card, runCloseout })]);
  const cdk = skipCdkReturn
    ? { skipped: true, note: 'one-off rehearsal code kept REDEEMED on purpose (see --skip-cdk-return)' }
    : await returnCdkForOrderInTransaction(connection, {
      orderId: order.id, reason: `order closed before payment: ${reason}`,
      actorType: 'ADMIN', actorId: String(actorId).slice(0, 128), metadata: { ...eventMetadata, source },
    });
  return { publicNo, fromStatus, evidence: state.evidence, runCloseout, ledger, card, dispatchJobs: dispatch.affectedRows, cdk };
}

/** 后台「放弃并放卡」（D-394）。dryRun=true 走完整个事务再回滚，用来先告诉运营「会发生什么」。 */
export function createPrePaymentAbandonService({ pool, now = () => new Date() }) {
  if (!pool || typeof pool.getConnection !== 'function') throw new TypeError('pool is required');
  return async function abandonPrePaymentOrder(publicNo, { dryRun = false, actorId = 'admin' } = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const summary = await closePrePaymentOrderInTransaction(connection, {
        publicNo: String(publicNo || '').trim(),
        reason: '后台放弃：付款前停下、没有付款痕迹，放卡并退回卡密',
        actorId, runErrorCode: 'ADMIN_ABANDONED', failureCode: 'ABANDONED_PRE_PAYMENT',
        source: 'admin_abandon_pre_payment', now: now(),
      });
      if (dryRun) await connection.rollback(); else await connection.commit();
      return {
        publicNo: summary.publicNo, dryRun, status: 'CLOSED',
        cardReleased: Boolean(summary.card?.released ?? summary.card), cdkReturned: summary.cdk?.returned === true,
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  };
}
