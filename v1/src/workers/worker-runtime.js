import { TaskType } from '../domain/task.js';
import { loadRuntimeSettings } from '../db/repositories/settings-repository.js';
import { runOneTask } from './task-runner.js';

export function allowedTaskTypesFor(settings, {
  providerReadsEnabled = false,
  providerWritesEnabled = false,
  providerCardWritesEnabled = false,
  providerRechargeWritesEnabled = false
} = {}) {
  const types = [];
  if (settings.dispatchNewRecharges) types.push(TaskType.ASSIGN_CARD);
  if (settings.dispatchNewRecharges && (providerWritesEnabled || providerCardWritesEnabled)) types.push(TaskType.PURCHASE_CARD);
  if (settings.dispatchNewRecharges) types.push(TaskType.PREPARE_RECHARGE);
  if (settings.dispatchNewRecharges && (providerWritesEnabled || providerRechargeWritesEnabled)) types.push(TaskType.SUBMIT_RECHARGE);
  if (settings.pollExistingOrders && providerReadsEnabled) {
    types.push(TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION);
  }
  if (settings.syncCardTransactions && providerReadsEnabled) {
    types.push(TaskType.SYNC_CARD_TRANSACTIONS);
  }
  return types;
}

export async function runWorkerIteration({
  pool,
  workerId,
  handlers,
  leaseSeconds = 60,
  providerReadsEnabled = false,
  providerWritesEnabled = false,
  providerCardWritesEnabled = false,
  providerRechargeWritesEnabled = false,
  settingsRepository = { loadRuntimeSettings },
  taskRunner = runOneTask
}) {
  const settings = await settingsRepository.loadRuntimeSettings(pool);
  const allowedTaskTypes = allowedTaskTypesFor(settings, {
    providerReadsEnabled,
    providerWritesEnabled,
    providerCardWritesEnabled,
    providerRechargeWritesEnabled
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
  workerConcurrency = 1,
  onError = () => {},
  heartbeat = null,
  heartbeatIntervalMs = 15_000,
  now = () => Date.now(),
  iteration = runWorkerIteration,
  ...iterationOptions
}) {
  const concurrency = Math.max(1, Math.min(32, Math.trunc(workerConcurrency)));
  let nextHeartbeatAt = 0;
  while (!signal?.aborted) {
    if (typeof heartbeat === 'function' && now() >= nextHeartbeatAt) {
      try {
        await heartbeat();
      } catch (error) {
        onError(error);
      }
      nextHeartbeatAt = now() + heartbeatIntervalMs;
    }
    const results = await Promise.all(Array.from({ length: concurrency }, async () => {
      try {
        return await iteration(iterationOptions);
      } catch (error) {
        onError(error);
        return { handled: false, error };
      }
    }));
    if (results.every((result) => !result?.handled)) {
      await abortableDelay(idleDelayMs, signal);
    }
  }
}
