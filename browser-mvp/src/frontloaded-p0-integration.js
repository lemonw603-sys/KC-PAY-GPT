import { projectUpstreamBrowserJob } from './shared-contract-adapter.js';
import { runNonPaymentUpstreamSimulation } from './nonpayment-simulation.js';
import { ContractError } from './contracts.js';

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
  materialRef = null,
  fillCardFields = false,
} = {}) {
  if (!cardMaterialLeaseProvider || typeof cardMaterialLeaseProvider.open !== 'function' || typeof cardMaterialLeaseProvider.withMaterial !== 'function' || typeof cardMaterialLeaseProvider.close !== 'function') {
    throw new TypeError('durable card material lease provider is required');
  }
  const job = projectUpstreamBrowserJob(projection, { now });
  const cardRef = job.metadata.upstream.cardRef;
  const resolvedMaterialRef = materialRef || job.metadata.upstream.providerCardRef || cardRef;
  if (cardMaterialLeaseProvider.requiresProviderCardRef && !materialRef && !job.metadata.upstream.providerCardRef) {
    throw new ContractError('provider card material source requires an explicit providerCardRef');
  }
  const lease = await cardMaterialLeaseProvider.open(resolvedMaterialRef, { purpose: 'browser-nonpayment-simulation' });
  const executionOptions = fillCardFields
    ? { cardMaterialLeaseProvider, cardMaterialLease: lease, fillCardFields: true }
    : {};
  try {
    const run = () => runNonPaymentUpstreamSimulation({
      projection,
      dispatchStore,
      executionService,
      workerId,
      now,
      executionOptions,
    });
    // Preserve the one-read contract for the observation-only path. The
    // card-fill path reads exactly once inside the executor while the page is
    // live, immediately clearing fields before releasing this lease.
    return fillCardFields ? await run() : await cardMaterialLeaseProvider.withMaterial(lease, run);
  } finally {
    await cardMaterialLeaseProvider.close(lease).catch(() => undefined);
  }
}
