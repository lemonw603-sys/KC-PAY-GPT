import { TaskType } from '../domain/task.js';
import { loadRuntimeSettings } from '../db/repositories/settings-repository.js';
import { runOneTask } from './task-runner.js';

export function allowedTaskTypesFor(settings, {
  providerReadsEnabled = false,
  providerWritesEnabled = false
} = {}) {
  const types = [];
  if (settings.dispatchNewRecharges && providerWritesEnabled) {
    types.push(TaskType.PURCHASE_CARD, TaskType.SUBMIT_RECHARGE);
  }
  if (settings.pollExistingOrders && providerReadsEnabled) types.push(TaskType.POLL_RECHARGE);
  return types;
}

export async function runWorkerIteration({
  pool,
  workerId,
  handlers,
  leaseSeconds = 60,
  providerReadsEnabled = false,
  providerWritesEnabled = false,
  settingsRepository = { loadRuntimeSettings },
  taskRunner = runOneTask
}) {
  const settings = await settingsRepository.loadRuntimeSettings(pool);
  const allowedTaskTypes = allowedTaskTypesFor(settings, {
    providerReadsEnabled,
    providerWritesEnabled
  });
  return taskRunner({
    pool,
    workerId,
    handlers,
    leaseSeconds,
    allowedTaskTypes
  });
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function runWorkerLoop({
  signal,
  idleDelayMs = 1_000,
  onError = () => {},
  ...iterationOptions
}) {
  while (!signal?.aborted) {
    try {
      const result = await runWorkerIteration(iterationOptions);
      if (!result.handled) await abortableDelay(idleDelayMs, signal);
    } catch (error) {
      onError(error);
      await abortableDelay(idleDelayMs, signal);
    }
  }
}
