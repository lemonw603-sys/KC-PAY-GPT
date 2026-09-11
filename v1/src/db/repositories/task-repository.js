import { TaskStatus } from '../../domain/task.js';

export async function claimNextTask(pool, {
  workerId,
  leaseSeconds = 60,
  allowedTaskTypes = null,
  allowedRechargeExecutorKinds = [],
  rechargeDispatchMode
}) {
  if (Array.isArray(allowedTaskTypes) && allowedTaskTypes.length === 0) return null;
  const typeFilter = Array.isArray(allowedTaskTypes)
    ? `AND task_type IN (${allowedTaskTypes.map(() => '?').join(', ')})`
    : '';
  const executorKinds = [...new Set((allowedRechargeExecutorKinds || [])
    .map((kind) => String(kind).trim().toUpperCase()))]
    .filter((kind) => ['API', 'BROWSER'].includes(kind));
  const executorFilter = executorKinds.length
    ? `AND fr.executor_kind IN (${executorKinds.map(() => '?').join(', ')})`
    : 'AND 1 = 0';
  const dispatchMode = String(rechargeDispatchMode || '').trim().toUpperCase();
  if (!['AUTOMATIC', 'MANUAL'].includes(dispatchMode)) {
    throw new TypeError('rechargeDispatchMode must be AUTOMATIC or MANUAL');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // D-158: a Browser order no longer waits on a separate pre-attempt login.
    // Its two checks — session identity match and "account is still free" —
    // now run inside the live attempt's own session and abort it safely
    // before any payment, so one login covers what two used to.
    const [rows] = await connection.query(
      `SELECT id, order_id, task_type, attempts, max_attempts, payload_json
       FROM tasks
       WHERE available_at <= CURRENT_TIMESTAMP(3)
         AND (
           task_type <> 'SUBMIT_RECHARGE'
           OR (
             (? = 'AUTOMATIC' OR EXISTS (
               SELECT 1 FROM recharge_authorization_items manual_item
               INNER JOIN recharge_authorizations manual_auth
                 ON manual_auth.id = manual_item.authorization_id
               WHERE manual_item.order_id = tasks.order_id
                 AND manual_item.status = 'PENDING'
                 AND manual_auth.status = 'ACTIVE'
                 AND manual_auth.authorization_mode IN ('SINGLE', 'BATCH')
                 AND manual_auth.expires_at > UTC_TIMESTAMP(3)
             ))
             AND EXISTS (
               SELECT 1
               FROM orders o
               INNER JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
               LEFT JOIN provider_accounts pa ON pa.id = fr.recharge_provider_account_id
               WHERE o.id = tasks.order_id
                 AND o.status = 'CARD_READY'
                 ${executorFilter}
                 AND (
                   (fr.executor_kind = 'API' AND pa.write_enabled = 1)
                   OR (
                     fr.executor_kind = 'BROWSER'
                     AND EXISTS (
                       SELECT 1 FROM app_settings browser_gate
                       WHERE browser_gate.setting_key = 'browser_dispatch_enabled'
                         AND browser_gate.setting_value = 'true'
                     )
                     AND EXISTS (
                       SELECT 1 FROM executor_profiles browser_profile
                       WHERE browser_profile.executor_kind = 'BROWSER'
                         AND browser_profile.status = 'ACTIVE'
                     )
                   )
                 )
                 AND EXISTS (
                   SELECT 1 FROM tasks prepared
                   WHERE prepared.order_id = o.id
                     AND prepared.task_type = 'PREPARE_RECHARGE'
                     AND prepared.status = 'COMPLETED'
                 )
             )
             AND NOT EXISTS (
               SELECT 1 FROM recharge_attempts rat
               WHERE rat.order_id = tasks.order_id
                 AND rat.funds_risk_state IN ('ACTIVE', 'UNKNOWN', 'SETTLED')
             )
             AND NOT EXISTS (
               SELECT 1 FROM provider_calls pc
               WHERE pc.order_id = tasks.order_id
                 AND pc.recharge_attempt_id IS NULL
                 AND LOWER(pc.provider) = 'zzshu'
                 AND pc.operation = 'create_direct'
             )
           )
         )
         AND (
           status = ?
           OR (status = ? AND leased_until < CURRENT_TIMESTAMP(3))
         )
         ${typeFilter}
       ORDER BY available_at ASC, id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [dispatchMode, ...executorKinds, TaskStatus.PENDING, TaskStatus.RUNNING, ...(allowedTaskTypes || [])]
    );

    if (rows.length === 0) {
      await connection.commit();
      return null;
    }

    const task = rows[0];
    const [result] = await connection.query(
      `UPDATE tasks
       SET status = ?, leased_by = ?,
           leased_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
           attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?
         AND (
           status = ?
           OR (status = ? AND leased_until < CURRENT_TIMESTAMP(3))
         )`,
      [
        TaskStatus.RUNNING,
        workerId,
        leaseSeconds,
        task.id,
        TaskStatus.PENDING,
        TaskStatus.RUNNING
      ]
    );
    if (result.affectedRows !== 1) {
      throw new Error(`Failed to claim task ${task.id}`);
    }

    await connection.commit();
    return { ...task, attempts: Number(task.attempts) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function completeTask(pool, { taskId, workerId }) {
  const [result] = await pool.query(
    `UPDATE tasks
     SET status = ?, leased_by = NULL, leased_until = NULL,
         completed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = ? AND leased_by = ?`,
    [TaskStatus.COMPLETED, taskId, TaskStatus.RUNNING, workerId]
  );
  if (result.affectedRows !== 1) {
    throw new Error(`Task lease lost before completion: ${taskId}`);
  }
}

export async function failTask(pool, {
  taskId,
  workerId,
  errorCode,
  errorMessage,
  retryAt = null,
  forceDead = false,
  refundAttempt = false
}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT attempts, max_attempts
       FROM tasks WHERE id = ? AND status = ? AND leased_by = ? FOR UPDATE`,
      [taskId, TaskStatus.RUNNING, workerId]
    );
    if (rows.length !== 1) {
      throw new Error(`Task lease lost before failure handling: ${taskId}`);
    }

    const effectiveAttempts = Math.max(
      0,
      Number(rows[0].attempts) - (refundAttempt ? 1 : 0)
    );
    const exhausted = forceDead
      || effectiveAttempts >= Number(rows[0].max_attempts);
    const nextStatus = exhausted ? TaskStatus.DEAD : TaskStatus.PENDING;
    const availableAt = exhausted ? null : (retryAt || new Date());

    await connection.query(
      `UPDATE tasks
       SET status = ?, available_at = COALESCE(?, available_at),
           attempts = CASE WHEN ? THEN GREATEST(attempts - 1, 0) ELSE attempts END,
           leased_by = NULL, leased_until = NULL,
           last_error_code = ?, last_error_message = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [nextStatus, availableAt, refundAttempt ? 1 : 0, errorCode, errorMessage, taskId]
    );
    await connection.commit();
    return { status: nextStatus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
