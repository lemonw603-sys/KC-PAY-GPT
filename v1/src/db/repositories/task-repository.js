import { TaskStatus } from '../../domain/task.js';

export async function claimNextTask(pool, { workerId, leaseSeconds = 60 }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, order_id, task_type, attempts, max_attempts, payload_json
       FROM tasks
       WHERE available_at <= CURRENT_TIMESTAMP(3)
         AND (
           status = ?
           OR (status = ? AND leased_until < CURRENT_TIMESTAMP(3))
         )
       ORDER BY available_at ASC, id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [TaskStatus.PENDING, TaskStatus.RUNNING]
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
  retryAt = null
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

    const exhausted = Number(rows[0].attempts) >= Number(rows[0].max_attempts);
    const nextStatus = exhausted ? TaskStatus.DEAD : TaskStatus.PENDING;
    const availableAt = exhausted ? null : (retryAt || new Date());

    await connection.query(
      `UPDATE tasks
       SET status = ?, available_at = COALESCE(?, available_at),
           leased_by = NULL, leased_until = NULL,
           last_error_code = ?, last_error_message = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [nextStatus, availableAt, errorCode, errorMessage, taskId]
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
