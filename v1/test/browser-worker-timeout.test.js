import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserWorkerService } from '../src/services/browser-worker-service.js';

const digest = (value) => value.repeat(64);

test('Browser action timeout aborts runtime work and stops the control shell', async () => {
  const dispatchRepository = {
    heartbeat: async (input) => ({ jobId: input.jobId }),
    complete: async () => ({ status: 'COMPLETED' })
  };
  const executionRepository = {
    beginRun: async ({ runId }) => ({ runId, runStatus: 'RUNNING', paymentState: 'NOT_STARTED' }),
    getRecoveryState: async () => ({ recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' })
  };
  const workerService = createBrowserWorkerService({
    dispatchRepository,
    executionRepository,
    resolveExecutionContext: async () => ({
      executorProfileId: 'profile-1',
      accountKeyHmac: digest('a'),
      profileManifestSha256: digest('b'),
      networkLeaseHmac: digest('c')
    }),
    runtime: { navigate: async () => 'unused' }
  });
  const worker = await workerService.runClaimedJob({
    jobId: 1,
    jobKey: 'browser-timeout-test',
    attemptId: 'attempt-timeout-test',
    status: 'CLAIMED',
    leaseOwner: 'worker-timeout-test',
    leaseToken: 'lease-token'
  }, { workerId: 'worker-timeout-test', leaseSeconds: 10 });

  let aborted = false;
  await assert.rejects(
    worker.perform('navigate', async (_navigate, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('runtime aborted'));
      }, { once: true });
    }), { actionTimeoutMs: 100 }),
    (error) => error.code === 'ACTION_TIMEOUT'
  );
  assert.equal(aborted, true);
  await assert.rejects(
    worker.perform('navigate', async () => 'must not run'),
    (error) => error.code === 'WORKER_STOPPED'
  );
});
