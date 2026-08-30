import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskType } from '../src/domain/task.js';
import {
  allowedTaskTypesFor,
  runWorkerIteration,
  runWorkerLoop
} from '../src/workers/worker-runtime.js';

const allSettings = Object.freeze({
  dispatchNewRecharges: true,
  browserDispatchEnabled: false,
  rechargeDispatchMode: 'AUTOMATIC',
  pollExistingOrders: true,
  syncCardTransactions: true
});

test('runtime settings and process gates jointly control task eligibility', () => {
  assert.deepEqual(allowedTaskTypesFor(allSettings), [TaskType.ASSIGN_CARD, TaskType.PREPARE_RECHARGE]);
  assert.deepEqual(
    allowedTaskTypesFor(allSettings, { providerReadsEnabled: true }),
    [TaskType.ASSIGN_CARD, TaskType.PREPARE_RECHARGE, TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION, TaskType.SYNC_CARD_TRANSACTIONS]
  );
  assert.deepEqual(
    allowedTaskTypesFor(allSettings, {
      providerReadsEnabled: true,
      providerWritesEnabled: true
    }),
    [TaskType.ASSIGN_CARD, TaskType.PURCHASE_CARD, TaskType.PREPARE_RECHARGE, TaskType.SUBMIT_RECHARGE, TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION, TaskType.SYNC_CARD_TRANSACTIONS]
  );
  assert.deepEqual(
    allowedTaskTypesFor({ ...allSettings, dispatchNewRecharges: false }, {
      providerReadsEnabled: true,
      providerWritesEnabled: true
    }),
    [TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION, TaskType.SYNC_CARD_TRANSACTIONS]
  );
  assert.deepEqual(
    allowedTaskTypesFor(allSettings, { providerReadsEnabled: true, providerCardWritesEnabled: true }),
    [TaskType.ASSIGN_CARD, TaskType.PURCHASE_CARD, TaskType.PREPARE_RECHARGE, TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION, TaskType.SYNC_CARD_TRANSACTIONS]
  );
  assert.equal(
    allowedTaskTypesFor(allSettings, { providerReadsEnabled: true, providerRechargeWritesEnabled: true }).includes(TaskType.SUBMIT_RECHARGE),
    true
  );
  assert.equal(
    allowedTaskTypesFor(allSettings, { providerRechargeWritesEnabled: true }).includes(TaskType.SUBMIT_RECHARGE),
    false
  );
  assert.equal(
    allowedTaskTypesFor({ ...allSettings, browserDispatchEnabled: true }, {
      providerReadsEnabled: true
    }).includes(TaskType.SUBMIT_RECHARGE),
    true
  );
});

test('one worker iteration passes only eligible task types to the runner', async () => {
  let input;
  const result = await runWorkerIteration({
    pool: {},
    workerId: 'worker-a',
    handlers: {},
    providerReadsEnabled: true,
    providerWritesEnabled: false,
    settingsRepository: { loadRuntimeSettings: async () => allSettings },
    taskRunner: async (value) => {
      input = value;
      return { handled: false };
    }
  });
  assert.equal(result.handled, false);
  assert.equal(input.rechargeDispatchMode, 'AUTOMATIC');
  assert.deepEqual(input.allowedRechargeExecutorKinds, []);
  assert.deepEqual(input.allowedTaskTypes, [TaskType.ASSIGN_CARD, TaskType.PREPARE_RECHARGE, TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION, TaskType.SYNC_CARD_TRANSACTIONS]);
});

test('worker passes only executable recharge kinds to task claiming', async () => {
  const captured = [];
  await runWorkerIteration({
    pool: {}, workerId: 'browser-only', handlers: {}, providerReadsEnabled: true,
    settingsRepository: { loadRuntimeSettings: async () => ({ ...allSettings, browserDispatchEnabled: true }) },
    taskRunner: async (input) => { captured.push(input); return { handled: false }; }
  });
  assert.deepEqual(captured[0].allowedRechargeExecutorKinds, ['BROWSER']);
  await runWorkerIteration({
    pool: {}, workerId: 'api-only', handlers: {}, providerReadsEnabled: true,
    providerRechargeWritesEnabled: true,
    settingsRepository: { loadRuntimeSettings: async () => allSettings },
    taskRunner: async (input) => { captured.push(input); return { handled: false }; }
  });
  assert.deepEqual(captured[1].allowedRechargeExecutorKinds, ['API']);
});

test('worker loop runs at most the configured number of iterations concurrently', async () => {
  const controller = new AbortController();
  let active = 0;
  let peak = 0;
  let calls = 0;
  await runWorkerLoop({
    signal: controller.signal,
    workerConcurrency: 3,
    idleDelayMs: 0,
    iteration: async () => {
      active += 1;
      peak = Math.max(peak, active);
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (calls >= 3) controller.abort();
      return { handled: true };
    }
  });
  assert.equal(peak, 3);
});

test('one failed concurrent iteration is reported without cancelling siblings', async () => {
  const controller = new AbortController();
  const errors = [];
  let completed = 0;
  await runWorkerLoop({
    signal: controller.signal,
    workerConcurrency: 2,
    idleDelayMs: 0,
    onError: (error) => errors.push(error),
    iteration: async ({ marker }) => {
      if (marker === undefined) {
        // The first wave deliberately has one failure and one success.
        marker = completed;
      }
      completed += 1;
      if (completed === 1) throw new Error('expected test failure');
      controller.abort();
      return { handled: true };
    }
  });
  assert.equal(errors.length, 1);
  assert.equal(completed, 2);
});

test('worker loop emits a bounded heartbeat without blocking task iterations', async () => {
  const controller = new AbortController();
  let heartbeats = 0;
  let clock = 0;
  let iterations = 0;
  await runWorkerLoop({
    signal: controller.signal,
    idleDelayMs: 0,
    heartbeatIntervalMs: 15,
    now: () => clock,
    heartbeat: async () => { heartbeats += 1; },
    iteration: async () => {
      iterations += 1;
      clock += 10;
      if (iterations >= 4) controller.abort();
      return { handled: true };
    }
  });
  assert.equal(heartbeats, 2);
});
