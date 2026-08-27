import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserWorkerIteration, runBrowserWorkerLoop } from '../src/services/browser-worker-loop.js';

test('worker iteration stays idle when no Browser dispatch job is available', async () => {
  const service = { claim: async () => null, runClaimedJob: async () => { throw new Error('not called'); } };
  const result = await runBrowserWorkerIteration({
    workerService: service, workerId: 'worker-1', executeJob: async () => { throw new Error('not called'); }
  });
  assert.deepEqual(result, { status: 'IDLE', workerId: 'worker-1' });
});

test('worker loop executes claimed jobs through the control shell', async () => {
  let claims = 0;
  const service = {
    claim: async () => ({ jobId: ++claims, status: 'CLAIMED' }),
    runClaimedJob: async (job) => ({ run: { runId: `run-${job.jobId}` }, stop() {} })
  };
  const seen = [];
  const results = await runBrowserWorkerLoop({
    workerService: service, workerId: 'worker-1', iterations: 2,
    executeJob: async (control) => { seen.push(control.run.runId); return 'mock-complete'; }
  });
  assert.deepEqual(seen, ['run-1', 'run-2']);
  assert.deepEqual(results.map((result) => result.status), ['EXECUTED', 'EXECUTED']);
});

test('worker loop stops a claimed control shell when execution fails', async () => {
  let stopped = 0;
  const service = {
    claim: async () => ({ jobId: 1, status: 'CLAIMED' }),
    runClaimedJob: async () => ({ run: { runId: 'run-1' }, stop: () => { stopped += 1; } })
  };
  await assert.rejects(
    runBrowserWorkerIteration({
      workerService: service, workerId: 'worker-1', executeJob: async () => { throw new Error('mock failure'); }
    }),
    /mock failure/
  );
  assert.equal(stopped, 1);
});
