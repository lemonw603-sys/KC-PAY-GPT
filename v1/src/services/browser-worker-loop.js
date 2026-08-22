import { BrowserWorkerError } from './browser-worker-service.js';

export async function runBrowserWorkerIteration({
  workerService,
  workerId,
  leaseSeconds = 60,
  executeJob
}) {
  if (!workerService || typeof workerService.claim !== 'function'
    || typeof workerService.runClaimedJob !== 'function') {
    throw new TypeError('workerService with claim/runClaimedJob is required');
  }
  if (typeof executeJob !== 'function') throw new TypeError('executeJob is required');
  const job = await workerService.claim(workerId, { leaseSeconds });
  if (!job) return { status: 'IDLE', workerId };
  if (job.status !== 'CLAIMED') {
    throw new BrowserWorkerError('claimed repository returned a non-claimed job', 'JOB_NOT_CLAIMED');
  }
  const control = await workerService.runClaimedJob(job, { workerId, leaseSeconds });
  try {
    const result = await executeJob(control);
    return { status: 'EXECUTED', workerId, jobId: job.jobId, runId: control.run.runId, result };
  } catch (error) {
    control.stop();
    throw error;
  }
}

export async function runBrowserWorkerLoop({
  workerService,
  workerId,
  leaseSeconds = 60,
  executeJob,
  iterations = 1,
  onIteration = () => {}
}) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000) {
    throw new BrowserWorkerError('iterations must be between 1 and 10000', 'INVALID_ARGUMENT');
  }
  const results = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = await runBrowserWorkerIteration({
      workerService, workerId, leaseSeconds, executeJob
    });
    results.push(result);
    await onIteration(result);
  }
  return results;
}
