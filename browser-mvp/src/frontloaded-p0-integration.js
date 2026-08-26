import { projectUpstreamBrowserJob } from './shared-contract-adapter.js';
import { runNonPaymentUpstreamSimulation } from './nonpayment-simulation.js';

/**
 * Non-payment integration slice for the two P0 contracts. It consumes the
 * shared read-only order/card/readiness projection, acquires a durable card
 * lease, runs the Browser observation, and always releases the lease on a
 * terminal local result. No payment permit is created and no funds write is
 * possible in this path.
 */
export async function runFrontloadedNonPaymentIntegration({
  projection,
  dispatchStore,
  executionService,
  cardMaterialLeaseProvider,
  workerId = 'worker:p0-simulation',
  now = Date.now(),
} = {}) {
  if (!cardMaterialLeaseProvider || typeof cardMaterialLeaseProvider.open !== 'function' || typeof cardMaterialLeaseProvider.withMaterial !== 'function' || typeof cardMaterialLeaseProvider.close !== 'function') {
    throw new TypeError('durable card material lease provider is required');
  }
  const job = projectUpstreamBrowserJob(projection, { now });
  const cardRef = job.metadata.upstream.cardRef;
  const lease = await cardMaterialLeaseProvider.open(cardRef, { purpose: 'browser-nonpayment-simulation' });
  try {
    return await cardMaterialLeaseProvider.withMaterial(lease, async () => runNonPaymentUpstreamSimulation({
      projection,
      dispatchStore,
      executionService,
      workerId,
      now,
    }));
  } finally {
    await cardMaterialLeaseProvider.close(lease).catch(() => undefined);
  }
}
