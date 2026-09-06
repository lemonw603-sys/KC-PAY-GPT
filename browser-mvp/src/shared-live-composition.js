import { createHmac } from 'node:crypto';

import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { createBrowserRecoveryRepository } from '../../v1/src/db/repositories/browser-recovery-repository.js';
import { createBrowserWorkerService } from '../../v1/src/services/browser-worker-service.js';
import { BrowserExecutionService } from './executor.js';
import { createMysqlUpstreamProjectionAdapter } from './mysql-upstream-adapter.js';
import { BrowserPaymentExecutor } from './payment-executor.js';
import { LiveChatGPTPaymentAdapter, LIVE_PAYMENT_CONFIRMATION } from './live-chatgpt-payment-adapter.js';
import { ChatGptPostPaymentVerifier } from './chatgpt-post-payment-verifier.js';
import { createBrowserPaymentExecutionRuntime, SharedBrowserRuntimeIntegration } from './shared-runtime-integration.js';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function key32(value, name) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError(`${name} must be a 32-byte Buffer`);
  return Buffer.from(value);
}

function hmac(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}:${required(value, namespace)}`).digest('hex');
}

/** Production-shaped LIVE composition. Construction alone performs no payment action. */
export function createSharedLivePaymentWorker({
  pool,
  workerId,
  executorProfileId,
  approvedOrderId,
  runtimeAdapter,
  manifest,
  observation,
  sessionProvider,
  cardMaterialLeaseProvider,
  resolveAccountKey,
  resolveSessionIdentity,
  resolveSessionRef,
  resolveCardMaterialRef,
  transactionReaderFactory,
  runtimeHmacKey,
  artifactKey,
  resourceHmacKey,
  evidenceSink,
  leaseSeconds = 60,
  executionTimeoutMs = 60_000,
  verificationWindowMs = 300_000,
  verificationIntervalMs = 5_000,
} = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('mysql2-like pool is required');
  if (!runtimeAdapter?.open || !runtimeAdapter?.close) throw new TypeError('runtimeAdapter is required');
  if (!manifest || manifest.allowWrites !== false) throw new TypeError('reviewed Browser manifest is required');
  if (!observation?.pageContract || !observation?.checkoutContract) throw new TypeError('LIVE observation contracts are required');
  if (observation.checkoutContract.requiredCurrency !== 'PHP'
    || observation.checkoutContract.requireZeroTax !== true
    || observation.checkoutContract.requireQuoteConsistency !== true) {
    throw new TypeError('LIVE Checkout contract must require PHP, zero tax and quote consistency');
  }
  if (!sessionProvider?.open || !sessionProvider?.bootstrap || !sessionProvider?.close) throw new TypeError('sessionProvider is required');
  if (!cardMaterialLeaseProvider?.open || !cardMaterialLeaseProvider?.withMaterial || !cardMaterialLeaseProvider?.close) throw new TypeError('cardMaterialLeaseProvider is required');
  for (const [name, value] of Object.entries({ resolveAccountKey, resolveSessionIdentity, resolveSessionRef, resolveCardMaterialRef, transactionReaderFactory })) {
    if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  }
  const worker = required(workerId, 'workerId');
  const profile = required(executorProfileId, 'executorProfileId');
  const approvedOrder = required(approvedOrderId, 'approvedOrderId');
  const runtimeKey = key32(runtimeHmacKey, 'runtimeHmacKey');
  const recoveryArtifactKey = key32(artifactKey, 'artifactKey');
  const recoveryResourceKey = key32(resourceHmacKey, 'resourceHmacKey');
  const dispatchRepository = createBrowserDispatchRepository(pool);
  const executionRepository = createBrowserExecutionRepository(pool);
  const recoveryRepository = createBrowserRecoveryRepository(pool, {
    artifactKeys: new Map([[1, recoveryArtifactKey]]), currentArtifactKeyVersion: 1,
    resourceHmacKey: recoveryResourceKey,
  });
  const upstreamAdapter = createMysqlUpstreamProjectionAdapter({ db: pool });
  const executionService = new BrowserExecutionService({
    runtimeAdapter, evidenceSink, sessionProvider, timeoutMs: executionTimeoutMs,
  });
  const resolveExecutionContext = async ({ claimedJob, run }) => {
    if (claimedJob.orderId !== approvedOrder) throw new Error('claimed order is not approved for LIVE payment');
    const sessionIdentity = await resolveSessionIdentity({
      orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId,
    });
    const loaded = await upstreamAdapter.load({
      runId: run.runId, manifest, observation: { ...observation, sessionIdentity },
      sessionRef: await resolveSessionRef({ orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId }),
    });
    return {
      job: loaded.job,
      executionOptions: {
        cardMaterialLeaseProvider,
        cardMaterialRef: await resolveCardMaterialRef({ orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId }),
        validateCardMaterialOnly: true,
      },
    };
  };
  let integration;
  const runtime = createBrowserPaymentExecutionRuntime({
    executionService,
    resolveExecutionContext,
    createPaymentHandler: async ({ claimedJob, run, control }) => async ({
      page, checkout, checkoutContract, cardMaterial, billingEmail,
    }) => {
      const verifier = new ChatGptPostPaymentVerifier({
        page,
        expectedIdentity: await resolveSessionIdentity({
          orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId,
        }),
        transactionReader: await transactionReaderFactory({ claimedJob, run }),
        timeoutMs: verificationWindowMs,
        pollIntervalMs: verificationIntervalMs,
      });
      const adapter = new LiveChatGPTPaymentAdapter({
        enabled: true,
        confirmation: LIVE_PAYMENT_CONFIRMATION,
        outcomeObserver: async () => ({ status: (await verifier.confirmPlus()).confirmed ? 'CONFIRMED' : 'UNKNOWN' }),
      });
      return new BrowserPaymentExecutor({
        integration, executionRepository, paymentAdapter: adapter,
        postPaymentVerifier: verifier, enabled: true,
        verificationWindowMs, verificationIntervalMs,
      }).execute({
        control, run, page, checkout, checkoutContract, cardMaterial, billingEmail,
        operationId: `browser-live-payment:${run.runId}`,
        beforeSubmit: () => control.assertLeaseBeforeAction('FINAL_PRE_SUBMIT_RECHECK'),
      });
    },
  });
  const workerService = createBrowserWorkerService({
    dispatchRepository, executionRepository, runtime,
    resolveExecutionContext: async (job) => ({
      executorProfileId: job.executorProfileId || profile,
      accountKeyHmac: hmac(runtimeKey, 'account', await resolveAccountKey({ orderId: job.orderId, attemptId: job.attemptId })),
      profileManifestSha256: manifest.profileDigest,
      networkLeaseHmac: hmac(runtimeKey, 'network', manifest.networkDigest),
    }),
  });
  integration = new SharedBrowserRuntimeIntegration({
    workerService, executionRepository, recoveryRepository,
    workerId: worker, executorProfileId: profile, leaseSeconds,
  });
  return Object.freeze({
    workerId: worker,
    approvedOrderId: approvedOrder,
    runOnce: () => integration.runPaymentOnce({ approvedOrderId: approvedOrder }),
  });
}
