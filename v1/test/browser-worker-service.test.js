import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserWorkerService } from '../src/services/browser-worker-service.js';

const digest = (c) => c.repeat(64);

function setup({ recovery = { recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' } } = {}) {
  const calls = [];
  const dispatchRepository = {
    claim: async (input) => { calls.push(['claim', input]); return null; },
    heartbeat: async (input) => { calls.push(['heartbeat', input]); return { jobId: input.jobId }; }
  };
  const executionRepository = {
    beginRun: async (input) => { calls.push(['beginRun', input]); return {
      runId: input.runId, runStatus: 'RUNNING', paymentState: 'NOT_STARTED'
    }; },
    getRecoveryState: async (runId) => { calls.push(['recovery', runId]); return recovery; }
  };
  const runtime = { navigate: async (url) => `opened:${url}` };
  const service = createBrowserWorkerService({
    dispatchRepository,
    executionRepository,
    resolveExecutionContext: async () => ({
      executorProfileId: 'profile-1', accountKeyHmac: digest('a'),
      profileManifestSha256: digest('b'), networkLeaseHmac: digest('c')
    }),
    runtime,
    now: () => new Date('2026-08-22T00:00:00.000Z')
  });
  return { service, calls, dispatchRepository, executionRepository };
}

test('worker binds a claimed dispatch job to one Browser run before page actions', async () => {
  const { service, calls } = setup();
  const worker = await service.runClaimedJob({
    jobId: 7, jobKey: 'browser-attempt:1', attemptId: 'attempt-1', status: 'CLAIMED',
    leaseOwner: 'worker-1', leaseToken: 'lease-token'
  }, { workerId: 'worker-1' });
  assert.equal(worker.run.runStatus, 'RUNNING');
  await worker.perform('navigate', async (navigate) => navigate('https://example.test'));
  assert.deepEqual(calls.map(([kind]) => kind), ['beginRun', 'heartbeat', 'recovery']);
});

test('worker blocks every action after dispatch lease loss', async () => {
  const { service, dispatchRepository, calls } = setup();
  dispatchRepository.heartbeat = async () => {
    throw Object.assign(new Error('expired'), { code: 'LEASE_NOT_OWNED' });
  };
  const worker = await service.runClaimedJob({
    jobId: 7, jobKey: 'browser-attempt:1', attemptId: 'attempt-1', status: 'CLAIMED',
    leaseOwner: 'worker-1', leaseToken: 'lease-token'
  }, { workerId: 'worker-1' });
  await assert.rejects(
    worker.perform('navigate', async () => {}),
    (error) => error.code === 'LEASE_LOST_BEFORE_ACTION'
  );
  assert.equal(calls.some(([kind]) => kind === 'recovery'), false);
});

test('worker blocks actions when the Browser run is no longer resumable', async () => {
  const { service } = setup({ recovery: { recoveryMode: 'RECONCILE_ONLY', runStatus: 'RECONCILE_ONLY' } });
  const worker = await service.runClaimedJob({
    jobId: 7, jobKey: 'browser-attempt:1', attemptId: 'attempt-1', status: 'CLAIMED',
    leaseOwner: 'worker-1', leaseToken: 'lease-token'
  }, { workerId: 'worker-1' });
  await assert.rejects(
    worker.perform('navigate', async () => {}),
    (error) => error.code === 'RUN_NOT_ACTIONABLE'
  );
});

test('worker watchdog interrupts a long action after lease loss', async () => {
  const { service, dispatchRepository } = setup();
  let heartbeats = 0;
  dispatchRepository.heartbeat = async () => {
    heartbeats += 1;
    if (heartbeats > 1) throw Object.assign(new Error('expired'), { code: 'LEASE_NOT_OWNED' });
  };
  const worker = await service.runClaimedJob({
    jobId: 7, jobKey: 'browser-attempt:1', attemptId: 'attempt-1', status: 'CLAIMED',
    leaseOwner: 'worker-1', leaseToken: 'lease-token'
  }, { workerId: 'worker-1', leaseSeconds: 10 });
  await assert.rejects(
    worker.perform('navigate', () => new Promise(() => {}), { actionTimeoutMs: 5000 }),
    (error) => error.code === 'LEASE_LOST_DURING_ACTION'
  );
});
