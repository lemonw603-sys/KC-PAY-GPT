import {
  claimNextTask,
  completeTask,
  failTask
} from '../db/repositories/task-repository.js';

export class TaskExecutionError extends Error {
  constructor(message, { code = 'TASK_FAILED', retryable = false, delayMs = 5_000, cause } = {}) {
    super(message, { cause });
    this.name = 'TaskExecutionError';
    this.code = code;
    this.retryable = retryable;
    this.delayMs = delayMs;
  }
}

function normalizeTaskError(error) {
  if (error instanceof TaskExecutionError) return error;
  return new TaskExecutionError(error?.message || 'Task failed', {
    code: error?.businessCode || error?.kind || 'TASK_FAILED',
    retryable: Boolean(error?.retryable),
    cause: error
  });
}

export async function runOneTask({
  pool,
  workerId,
  handlers,
  leaseSeconds = 60,
  allowedTaskTypes = null,
  repository = { claimNextTask, completeTask, failTask }
}) {
  const task = await repository.claimNextTask(pool, {
    workerId,
    leaseSeconds,
    allowedTaskTypes
  });
  if (!task) return { handled: false };

  const handler = handlers[task.task_type];
  if (typeof handler !== 'function') {
    const error = new TaskExecutionError(`No handler for task type ${task.task_type}`, {
      code: 'HANDLER_MISSING',
      retryable: false
    });
    await repository.failTask(pool, {
      taskId: task.id,
      workerId,
      errorCode: error.code,
      errorMessage: error.message,
      forceDead: true
    });
    return { handled: true, task, status: 'DEAD', error };
  }

  try {
    await handler(task);
    await repository.completeTask(pool, { taskId: task.id, workerId });
    return { handled: true, task, status: 'COMPLETED' };
  } catch (rawError) {
    const error = normalizeTaskError(rawError);
    const result = await repository.failTask(pool, {
      taskId: task.id,
      workerId,
      errorCode: error.code,
      errorMessage: error.message,
      retryAt: error.retryable ? new Date(Date.now() + error.delayMs) : null,
      forceDead: !error.retryable
    });
    return { handled: true, task, status: result.status, error };
  }
}
