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
  // 开卡不再是订单任务：供卡由水位调度器 + card-stock-job-runner 做（D-247 面二③），
  // worker 只分库存卡。providerCardWritesEnabled 因此不再解锁任何任务类型。
  if (settings.dispatchNewRecharges) types.push(TaskType.ASSIGN_CARD, TaskType.PREPARE_RECHARGE);
  if (settings.dispatchNewRecharges && providerReadsEnabled
    && (providerWritesEnabled || providerRechargeWritesEnabled || settings.browserDispatchEnabled)) {
    types.push(TaskType.SUBMIT_RECHARGE);
  }
  if (settings.pollExistingOrders && providerReadsEnabled) {
    types.push(TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION);
  }
  if (settings.syncCardTransactions && providerReadsEnabled) {
    types.push(TaskType.SYNC_CARD_TRANSACTIONS);
  }
  // D-411：发补钱属于新单分卡（跟着派单开关）；查到账属于追踪已有订单（跟着轮询开关）——
  // 停单不能停追踪（CLAUDE.md），已经发出去的补钱在停单时照样要核对完。
  // 不另设进程权限：补钱任务只在分卡选中「可补钱旧卡」时才会产生，而那条规则本身要求「自动开卡」
  // 总闸开着（D-412 补记三，不新增开关）。开卡 runner 同理，常开写权限、由总闸管。
  // 发补钱还要求追踪开着：追踪关了就没人查到账，发出去的钱会停在「给卡补钱中」没人管。
  if (settings.dispatchNewRecharges && settings.pollExistingOrders) types.push(TaskType.TOP_UP_CARD);
  if (settings.pollExistingOrders) types.push(TaskType.CHECK_TOP_UP);
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
  const allowedRechargeExecutorKinds = [];
  if (providerReadsEnabled && (providerWritesEnabled || providerRechargeWritesEnabled)) {
    allowedRechargeExecutorKinds.push('API');
  }
  if (settings.browserDispatchEnabled) allowedRechargeExecutorKinds.push('BROWSER');
  return taskRunner({
    pool,
    workerId,
    handlers,
    leaseSeconds,
    allowedTaskTypes,
    allowedRechargeExecutorKinds,
    rechargeDispatchMode: settings.rechargeDispatchMode
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
