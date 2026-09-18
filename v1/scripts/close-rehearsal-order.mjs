// Close a Browser rehearsal order that stopped BEFORE any payment and still holds its
// card (assignment ACTIVE + ledger RESERVED) so the card returns to the pool and the
// CDK goes back to AVAILABLE. Mirrors the admin "取消并释放卡" closeout, but for a
// CARD_READY order whose SUBMIT_RECHARGE already ran once (the admin path refuses those
// as SUBMISSION_RISK even though the rehearsal provably never clicked payment).
//
//   node scripts/close-rehearsal-order.mjs <public-no> [--dry-run] [--reason "..."] [--skip-cdk-return]
//
// --skip-cdk-return：只用于运维自己为演练生成的一次性码。退回会写 cdk_delivery_events，
// 它有外键指向 cdk_batches；用底层 storeCdkBatch 造的码没有批次行，退回会直接失败。
// 跳过后这张码停在 REDEEMED 且订单 CLOSED，等于死码，不会被任何人再兑换。**客户的码一律不要用它**，
// 客户码必须退回成 AVAILABLE 才能重兑。
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced,
//   or through the 13306 tunnel). Refuses when ANY payment evidence exists.
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { releaseCardForFailedOrderInTransaction } = await import(join(HERE, '../src/db/repositories/card-release-repository.js'));
const { returnCdkForOrderInTransaction } = await import(join(HERE, '../src/db/repositories/cdk-return-repository.js'));
const { transitionCardConsumptionInTransaction } = await import(join(HERE, '../src/services/card-consumption-ledger-service.js'));

const [publicNo, ...rest] = process.argv.slice(2);
if (!publicNo) { console.error('usage: close-rehearsal-order <public-no> [--dry-run] [--reason "..."]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const skipCdkReturn = rest.includes('--skip-cdk-return');
const reasonIndex = rest.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(rest[reasonIndex + 1] || '').trim() : 'rehearsal finished; closed before any payment to release the card';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[order]] = await connection.query(
    'SELECT id, status, version, assigned_card_id, cdk_id FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]);
  if (!order) throw new Error('order not found');
  // 两种演练残单：
  //   CARD_READY —— 旧形态（D-158 前，演练在预检后停）。
  //   RECHARGE_PROCESSING —— D-158 起的形态：SUBMIT_RECHARGE 已把单交给 Browser dispatch，
  //     演练 worker 在付款前 fail-closed（现场保留等接手）后退出，留下 attempt PREPARED/ACTIVE、
  //     run RUNNING/NOT_STARTED 且租约已过期。后台控制面只有「恢复自动化」没有「放弃并放卡」，
  //     worker 的 abort 又要租约（已死的 worker 才有），所以这里按 worker 付款前中止的同一顺序收
  //     （browser-execution-repository 的 PRE_PAYMENT_ABORT 段）。任何付款痕迹仍然一律拒。
  if (!['CARD_READY', 'RECHARGE_PROCESSING'].includes(order.status)) {
    throw new Error(`order is ${order.status}; only CARD_READY / RECHARGE_PROCESSING rehearsal leftovers are closable here`);
  }
  const fromStatus = order.status;
  let preSubmitRun = null;
  if (order.status === 'RECHARGE_PROCESSING') {
    const [attempts] = await connection.query(
      `SELECT id, status, funds_risk_state, executor_kind FROM recharge_attempts WHERE order_id = ? FOR UPDATE`, [order.id]);
    const [runs] = await connection.query(
      `SELECT br.id, br.status, br.payment_state, br.last_checkpoint_kind, br.worker_lease_until, br.recharge_attempt_id
         FROM browser_runs br INNER JOIN recharge_attempts ra ON ra.id = br.recharge_attempt_id
        WHERE ra.order_id = ? FOR UPDATE`, [order.id]);
    // 演练残单有两种形态，都是「一条还占着卡的 PREPARED/ACTIVE attempt，且全程没碰过付款」：
    //   a) worker fail-closed 直接退出（第③步两次）：那条 attempt 还挂着 run RUNNING/NOT_STARTED、租约已过期。
    //   b) worker 自己走完付款前中止（第④步这次，走到报价段才停）：它已把当时那条 attempt 收成
    //      CLEARED/CLEARED、run 置 FAILED_SAFE/PRE_PAYMENT_ABORT，并按设计重置了 SUBMIT_RECHARGE，
    //      于是 worker 又建了一条新的 PREPARED/ACTIVE attempt 和一个 QUEUED 派单在等池来跑。
    // 所以判据不是「只有一条 attempt」，而是「恰好一条还活着的 attempt、其余都已清、没有任何付款痕迹」。
    const pending = attempts.filter((row) => row.status === 'PREPARED' && row.funds_risk_state === 'ACTIVE');
    const settled = attempts.filter((row) => !(row.status === 'PREPARED' && row.funds_risk_state === 'ACTIVE'));
    const attempt = pending[0];
    const run = attempt ? runs.find((row) => row.recharge_attempt_id === attempt.id) || null : null;
    const otherRuns = runs.filter((row) => row.id !== run?.id);
    const shape = {
      attempts: attempts.length, pendingAttempts: pending.length,
      settledAttempts: settled.map((row) => `${row.status}/${row.funds_risk_state}`),
      attemptStatus: attempt?.status, fundsRiskState: attempt?.funds_risk_state, executorKind: attempt?.executor_kind,
      runs: runs.length, runStatus: run?.status ?? null, paymentState: run?.payment_state ?? null,
      lastCheckpoint: run?.last_checkpoint_kind ?? null,
      otherRunStates: otherRuns.map((row) => `${row.status}/${row.payment_state}/${row.last_checkpoint_kind || '-'}`),
      leaseUntil: run?.worker_lease_until ?? null,
      leaseExpired: run?.worker_lease_until ? new Date(run.worker_lease_until).getTime() < Date.now() : null,
    };
    const noPaymentTrace = (row) => String(row.payment_state) === 'NOT_STARTED'
      && !String(row.last_checkpoint_kind || '').toUpperCase().startsWith('PAYMENT');
    const ok = pending.length === 1 && attempt.executor_kind === 'BROWSER'
      // 已清掉的 attempt 只能是 CLEARED/CLEARED：FAILED/UNKNOWN/SETTLED 都意味着动过钱。
      && settled.every((row) => row.status === 'CLEARED' && row.funds_risk_state === 'CLEARED')
      // 任何 run 都不许有付款痕迹，包括已经终态的那些。
      && runs.every(noPaymentTrace)
      // 还活着的那条 attempt 要么没有 run（形态 b），要么 run 还在 RUNNING 且租约已过期（形态 a）。
      && (run === null || (run.status === 'RUNNING' && shape.leaseExpired === true));
    if (!ok) throw new Error(`not a pre-payment rehearsal leftover, refusing: ${JSON.stringify(shape)}`);
    preSubmitRun = { run, attempt, shape };
  }
  const [[evidence]] = await connection.query(
    `SELECT
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
     FROM orders o WHERE o.id = ?`, [preSubmitRun ? 1 : 0, preSubmitRun?.run ? 1 : 0, order.id]);
  const blockers = Object.entries(evidence).filter(([key, value]) => (typeof value === 'number' ? value > 0 : Boolean(value)));
  if (blockers.length) throw new Error(`payment evidence present, refusing: ${JSON.stringify(Object.fromEntries(blockers))}`);

  let runCloseout = null;
  if (preSubmitRun) {
    const now = new Date();
    // 形态 b 的 run 已经是 FAILED_SAFE 终态（worker 自己收的），没有 run 要关。
    if (preSubmitRun.run) {
      const [runUpdate] = await connection.query(
        `UPDATE browser_runs
            SET status = 'FAILED_SAFE', control_state = 'RELEASED', last_checkpoint_kind = 'PRE_PAYMENT_ABORT',
                last_error_code = 'REHEARSAL_CLOSED', worker_lease_until = NULL,
                finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'RUNNING' AND payment_state = 'NOT_STARTED'`,
        [now, now, preSubmitRun.run.id]);
      if (Number(runUpdate.affectedRows) !== 1) throw new Error('browser run changed concurrently');
    }
    const [attemptUpdate] = await connection.query(
      `UPDATE recharge_attempts
          SET status = 'CLEARED', funds_risk_state = 'CLEARED', result_summary_json = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND executor_kind = 'BROWSER' AND status = 'PREPARED' AND funds_risk_state = 'ACTIVE'`,
      [JSON.stringify({ code: 'REHEARSAL_CLOSED', browserRunId: preSubmitRun.run?.id || null, noExternalPaymentAction: true }), now, now, preSubmitRun.attempt.id]);
    if (Number(attemptUpdate.affectedRows) !== 1) throw new Error('funds attempt changed concurrently');
    runCloseout = { runId: preSubmitRun.run?.id || null, attemptId: preSubmitRun.attempt.id, shape: preSubmitRun.shape };
  }
  const ledger = await transitionCardConsumptionInTransaction(connection, {
    orderId: order.id, targetStatus: 'RELEASED', reason: `Order closed before payment: ${reason}`,
    allowedCurrentStatuses: ['RESERVED'], requireActive: false, evidence: { source: 'close_rehearsal_order' },
  });
  const card = await releaseCardForFailedOrderInTransaction(connection, { orderId: order.id, releasedBy: 'admin', reason });
  // The dispatch job would otherwise stay QUEUED forever and show as 排队中 on the control panel.
  const [dispatch] = await connection.query(
    `UPDATE browser_dispatch_jobs SET status = 'CANCELLED', last_error_code = 'CANCELLED_PRE_SUBMISSION',
       completed_at = CURRENT_TIMESTAMP(3), lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE order_id = ? AND status IN ('QUEUED','CLAIMED')`, [order.id]);
  const [closed] = await connection.query(
    `UPDATE orders SET status = 'CLOSED', assigned_card_id = NULL,
       failure_code = 'CANCELLED_PRE_SUBMISSION', failure_reason = ?,
       version = version + 1, finished_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND version = ?`, [reason, order.id, order.version]);
  if (Number(closed.affectedRows) !== 1) throw new Error('order changed concurrently');
  await connection.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, ?, 'CLOSED', 'ADMIN', 'admin', ?, ?)`,
    [order.id, fromStatus, reason, JSON.stringify({ closeRehearsalOrder: true, evidence, ledger, card, runCloseout })]);
  const cdk = skipCdkReturn
    ? { skipped: true, note: 'one-off rehearsal code kept REDEEMED on purpose (see --skip-cdk-return)' }
    : await returnCdkForOrderInTransaction(connection, {
      orderId: order.id, reason: `order closed after rehearsal before payment: ${reason}`,
      actorType: 'ADMIN', actorId: 'admin', metadata: { closeRehearsalOrder: true },
    });
  const summary = { publicNo, dryRun, fromStatus, evidence, runCloseout, ledger, card, dispatchJobs: dispatch.affectedRows, cdk };
  if (dryRun) { await connection.rollback(); console.log('DRY RUN (rolled back)', JSON.stringify(summary)); }
  else { await connection.commit(); console.log('CLOSED', JSON.stringify(summary)); }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error('refused/failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
