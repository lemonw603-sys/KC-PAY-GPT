import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserWorkerLoop } from '../src/services/browser-worker-loop.js';

test('offline concurrent worker harness claims each dispatch job once', async () => {
  const jobs = Array.from({ length: 240 }, (_, index) => ({ jobId: `dispatch-${index + 1}`, status: 'CLAIMED' }));
  const claimed = new Set();
  const executed = [];
  const stopped = [];
  const service = {
    claim: async () => jobs.shift() || null,
    runClaimedJob: async (job) => ({
      run: { runId: `run-${job.jobId}` },
      stop: () => stopped.push(job.jobId)
    })
  };
  const workers = Array.from({ length: 8 }, (_, index) => runBrowserWorkerLoop({
    workerService: service,
    workerId: `worker-${index + 1}`,
    iterations: 40,
    executeJob: async (control) => {
      await new Promise((resolve) => setTimeout(resolve, (executed.length % 3) + 1));
      const jobId = control.run.runId.slice(4);
      assert.equal(claimed.has(jobId), false, `duplicate execution: ${jobId}`);
      claimed.add(jobId);
      executed.push(jobId);
      return 'mock-complete';
    }
  }));
  const results = (await Promise.all(workers)).flat();
  assert.equal(results.filter((result) => result.status === 'EXECUTED').length, 240);
  assert.equal(claimed.size, 240);
  assert.equal(executed.length, 240);
  assert.equal(stopped.length, 0);
  assert.equal(jobs.length, 0);
});
