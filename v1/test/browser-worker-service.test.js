import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
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

test('worker timeout aborts the runtime action and permanently stops the control shell', async () => {
  const { service } = setup();
  const worker = await service.runClaimedJob({
    jobId: 7, jobKey: 'browser-attempt:timeout', attemptId: 'attempt-1', status: 'CLAIMED',
    leaseOwner: 'worker-1', leaseToken: 'lease-token'
  }, { workerId: 'worker-1', leaseSeconds: 10 });
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

test('Playwright navigation is aborted after lease loss without a submit event', async () => {
  let submitEvents = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<button data-testid="submit">submit</button>');
      }, 5000);
      return;
    }
    if (request.url === '/submit') submitEvents += 1;
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const { service, dispatchRepository } = setup();
  let heartbeats = 0;
  dispatchRepository.heartbeat = async () => {
    heartbeats += 1;
    if (heartbeats > 1) throw Object.assign(new Error('expired'), { code: 'LEASE_NOT_OWNED' });
  };
  const worker = await service.runClaimedJob({
    jobId: 7, jobKey: 'browser-attempt:playwright-abort', attemptId: 'attempt-1', status: 'CLAIMED',
    leaseOwner: 'worker-1', leaseToken: 'lease-token'
  }, { workerId: 'worker-1', leaseSeconds: 10 });
  let pageCloseRequested = false;
  try {
    await assert.rejects(
      worker.perform('navigate', async (_navigate, { signal }) => {
        const abort = new Promise((_, reject) => signal.addEventListener('abort', () => {
          pageCloseRequested = true;
          page.close().catch(() => {}).finally(() => reject(new Error('page navigation aborted')));
        }, { once: true }));
        await Promise.race([page.goto(`http://127.0.0.1:${address.port}/slow`), abort]);
      }, { actionTimeoutMs: 5000 }),
      (error) => error.code === 'LEASE_LOST_DURING_ACTION'
    );
    assert.equal(submitEvents, 0);
    assert.equal(pageCloseRequested, true);
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
});
