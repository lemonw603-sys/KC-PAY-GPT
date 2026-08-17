import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskType } from '../src/domain/task.js';
import {
  allowedTaskTypesFor,
  runWorkerIteration
} from '../src/workers/worker-runtime.js';

const allSettings = Object.freeze({
  dispatchNewRecharges: true,
  pollExistingOrders: true,
  syncCardTransactions: true
});

test('runtime settings and process gates jointly control task eligibility', () => {
  assert.deepEqual(allowedTaskTypesFor(allSettings), []);
  assert.deepEqual(
    allowedTaskTypesFor(allSettings, { providerReadsEnabled: true }),
    [TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION]
  );
  assert.deepEqual(
    allowedTaskTypesFor(allSettings, {
      providerReadsEnabled: true,
      providerWritesEnabled: true
    }),
    [TaskType.PURCHASE_CARD, TaskType.SUBMIT_RECHARGE, TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION]
  );
  assert.deepEqual(
    allowedTaskTypesFor({ ...allSettings, dispatchNewRecharges: false }, {
      providerReadsEnabled: true,
      providerWritesEnabled: true
    }),
    [TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION]
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
  assert.deepEqual(input.allowedTaskTypes, [TaskType.VERIFY_CARD, TaskType.POLL_RECHARGE, TaskType.RECHECK_CANCELLATION]);
});
