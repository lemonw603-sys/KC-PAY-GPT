import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderError } from '../src/providers/http-client.js';
import { runOneTask } from '../src/workers/task-runner.js';

function repositoryFor(task, calls) {
  return {
    claimNextTask: async () => task,
    completeTask: async (_pool, input) => calls.push({ method: 'complete', input }),
    failTask: async (_pool, input) => {
      calls.push({ method: 'fail', input });
      return { status: input.forceDead ? 'DEAD' : 'PENDING' };
    }
  };
}

test('completes one leased task without affecting other jobs', async () => {
  const calls = [];
  const task = { id: 1, task_type: 'POLL_RECHARGE' };
  const result = await runOneTask({
    pool: {},
    workerId: 'worker-a',
    handlers: { POLL_RECHARGE: async () => {} },
    repository: repositoryFor(task, calls)
  });

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(calls, [{
    method: 'complete',
    input: { taskId: 1, workerId: 'worker-a' }
  }]);
});

test('requeues an explicitly retryable provider failure', async () => {
  const calls = [];
  const task = { id: 2, task_type: 'PURCHASE_CARD' };
  const error = new ProviderError('temporary card channel failure', {
    provider: 'hnskj',
    kind: 'transport',
    retryable: true,
    uncertain: true
  });
  const result = await runOneTask({
    pool: {},
    workerId: 'worker-a',
    handlers: { PURCHASE_CARD: async () => { throw error; } },
    repository: repositoryFor(task, calls)
  });

  assert.equal(result.status, 'PENDING');
  assert.equal(calls[0].input.forceDead, false);
  assert.equal(calls[0].input.retryAt instanceof Date, true);
});

test('dead-letters an ambiguous non-retryable recharge submission', async () => {
  const calls = [];
  const task = { id: 3, task_type: 'SUBMIT_RECHARGE' };
  const error = new ProviderError('submission timeout', {
    provider: 'zzshu',
    kind: 'timeout',
    retryable: false,
    uncertain: true
  });
  const result = await runOneTask({
    pool: {},
    workerId: 'worker-a',
    handlers: { SUBMIT_RECHARGE: async () => { throw error; } },
    repository: repositoryFor(task, calls)
  });

  assert.equal(result.status, 'DEAD');
  assert.equal(calls[0].input.forceDead, true);
  assert.equal(calls[0].input.retryAt, null);
});

test('redacts provider-controlled secrets before persisting task failures', async () => {
  const calls = [];
  const task = { id: 5, task_type: 'SUBMIT_RECHARGE' };
  const error = new ProviderError(
    'rejected accessToken=eyJheader.payload.signature cardNumber=4242424242424242 cvv=123',
    {
      provider: 'zzshu',
      kind: 'provider',
      businessCode: 'invalid code with spaces',
      retryable: false
    }
  );
  await runOneTask({
    pool: {},
    workerId: 'worker-a',
    handlers: { SUBMIT_RECHARGE: async () => { throw error; } },
    repository: repositoryFor(task, calls)
  });

  const persisted = calls[0].input;
  assert.equal(persisted.errorCode, 'TASK_FAILED');
  assert.equal(persisted.errorMessage.includes('eyJheader.payload.signature'), false);
  assert.equal(persisted.errorMessage.includes('4242424242424242'), false);
  assert.equal(persisted.errorMessage.includes('cvv=123'), false);
  assert.match(persisted.errorMessage, /accessToken=\[REDACTED\]/);
});

test('dead-letters an unknown task type', async () => {
  const calls = [];
  const result = await runOneTask({
    pool: {},
    workerId: 'worker-a',
    handlers: {},
    repository: repositoryFor({ id: 4, task_type: 'UNKNOWN' }, calls)
  });

  assert.equal(result.status, 'DEAD');
  assert.equal(calls[0].input.errorCode, 'HANDLER_MISSING');
});
