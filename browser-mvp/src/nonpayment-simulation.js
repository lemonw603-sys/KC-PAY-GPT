import { projectUpstreamBrowserJob } from './shared-contract-adapter.js';

/**
 * Executes the first upstream-to-Browser integration slice. The runtime is
 * deliberately injected by the caller; production payment capabilities are
 * not available through this helper.
 */
export async function runNonPaymentUpstreamSimulation({
  projection,
  dispatchStore,
  executionService,
  workerId = 'worker:upstream-mock',
  now = Date.now(),
  executionOptions = {},
}) {
  const job = projectUpstreamBrowserJob(projection, { now });
  await dispatchStore.enqueue(job);
  const claimed = await dispatchStore.claim(workerId);
  if (!claimed) throw new Error('simulation job was not claimable');
  const result = await executionService.execute(claimed.job, {
    assertLease: async () => true,
    ...executionOptions,
  });
  const completed = await dispatchStore.complete({
    jobId: claimed.job.jobId,
    leaseToken: claimed.leaseToken,
    state: 'COMPLETED',
  });
  return { job, claimed, result, completed };
}
