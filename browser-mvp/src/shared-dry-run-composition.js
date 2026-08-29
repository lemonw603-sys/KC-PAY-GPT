import { createHmac } from 'node:crypto';

import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { createBrowserRecoveryRepository } from '../../v1/src/db/repositories/browser-recovery-repository.js';
import { createBrowserWorkerService } from '../../v1/src/services/browser-worker-service.js';
import { BrowserExecutionService } from './executor.js';
import { MemoryEvidenceSink } from './evidence-sink.js';
import { createMysqlUpstreamProjectionAdapter } from './mysql-upstream-adapter.js';
import { createBrowserExecutionRuntime, SharedBrowserRuntimeIntegration } from './shared-runtime-integration.js';

export const SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION = 'RUN SHARED BROWSER NONPAYMENT DRY RUN';

export class SharedDryRunError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SharedDryRunError';
    this.code = code;
  }
}

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new SharedDryRunError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

function key32(value, name) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new SharedDryRunError(`${name} must be a 32-byte Buffer`, 'INVALID_KEY');
  }
  return Buffer.from(value);
}

function hmac(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}:${required(value, namespace)}`).digest('hex');
}

async function assertPaymentWritesDisabled(pool) {
  const [rows] = await pool.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key = 'browser_payment_writes_enabled' LIMIT 1`,
  );
  if (rows.length !== 1 || String(rows[0].setting_value).trim().toLowerCase() !== 'false') {
    throw new SharedDryRunError(
      'shared non-payment dry-run requires browser_payment_writes_enabled=false',
      'PAYMENT_WRITES_NOT_DISABLED',
    );
  }
}

/**
 * Production-shaped composition for a deliberately non-payment Browser run.
 * It uses the real MySQL dispatch/run/resource repositories and the Browser
 * executor, but has no payment submitter and always closes through the shared
 * pre-payment safe-abort transaction.
 */
export function createSharedNonPaymentDryRun({
  pool,
  workerId,
  executorProfileId,
  runtimeAdapter,
  manifest,
  observation,
  resolveObservation = null,
  sessionProvider = null,
  resolveSessionRef = async () => null,
  cardMaterialLeaseProvider = null,
  resolveCardMaterialRef = async () => null,
  validateCardMaterialOnly = false,
  resolveAccountKey,
  runtimeHmacKey,
  artifactKey,
  resourceHmacKey,
  evidenceSink = new MemoryEvidenceSink(),
  leaseSeconds = 60,
  executionTimeoutMs = 10_000,
} = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
    throw new TypeError('mysql2-like pool is required');
  }
  if (!runtimeAdapter || typeof runtimeAdapter.open !== 'function' || typeof runtimeAdapter.close !== 'function') {
    throw new TypeError('runtimeAdapter is required');
  }
  if (!manifest || manifest.allowWrites !== false) {
    throw new SharedDryRunError('read-only Browser manifest is required', 'WRITE_CAPABLE_MANIFEST_REJECTED');
  }
  if (!observation?.pageContract && typeof resolveObservation !== 'function') {
    throw new SharedDryRunError('observation.pageContract is required', 'PAGE_CONTRACT_REQUIRED');
  }
  if (resolveObservation != null && typeof resolveObservation !== 'function') {
    throw new TypeError('resolveObservation must be a function');
  }
  if (typeof resolveSessionRef !== 'function') throw new TypeError('resolveSessionRef must be a function');
  if (typeof resolveCardMaterialRef !== 'function') throw new TypeError('resolveCardMaterialRef must be a function');
  if (validateCardMaterialOnly && (!cardMaterialLeaseProvider
    || typeof cardMaterialLeaseProvider.open !== 'function'
    || typeof cardMaterialLeaseProvider.withMaterial !== 'function'
    || typeof cardMaterialLeaseProvider.close !== 'function')) {
    throw new TypeError('cardMaterialLeaseProvider is required for card material preflight');
  }
  if (typeof resolveAccountKey !== 'function') {
    throw new TypeError('resolveAccountKey is required for cross-order account isolation');
  }
  const worker = required(workerId, 'workerId');
  const profile = required(executorProfileId, 'executorProfileId');
  const runtimeKey = key32(runtimeHmacKey, 'runtimeHmacKey');
  const recoveryArtifactKey = key32(artifactKey, 'artifactKey');
  const recoveryResourceKey = key32(resourceHmacKey, 'resourceHmacKey');

  const dispatchRepository = createBrowserDispatchRepository(pool);
  const executionRepository = createBrowserExecutionRepository(pool);
  const recoveryRepository = createBrowserRecoveryRepository(pool, {
    artifactKeys: new Map([[1, recoveryArtifactKey]]),
    currentArtifactKeyVersion: 1,
    resourceHmacKey: recoveryResourceKey,
  });
  const upstreamAdapter = createMysqlUpstreamProjectionAdapter({ db: pool });
  const executionService = new BrowserExecutionService({
    runtimeAdapter,
    evidenceSink,
    sessionProvider,
    timeoutMs: executionTimeoutMs,
  });
  const runtime = createBrowserExecutionRuntime({
    executionService,
    resolveExecutionContext: async ({ claimedJob, run }) => {
      const sessionRef = await resolveSessionRef({
        orderId: claimedJob.orderId,
        attemptId: claimedJob.attemptId,
        runId: run.runId,
      });
      const cardMaterialRef = await resolveCardMaterialRef({
        orderId: claimedJob.orderId,
        attemptId: claimedJob.attemptId,
        runId: run.runId,
      });
      const effectiveObservation = resolveObservation == null ? observation : await resolveObservation({
        orderId: claimedJob.orderId,
        attemptId: claimedJob.attemptId,
        runId: run.runId,
        baseObservation: observation,
      });
      if (!effectiveObservation?.pageContract) {
        throw new SharedDryRunError('resolved observation.pageContract is required', 'PAGE_CONTRACT_REQUIRED');
      }
      const loaded = await upstreamAdapter.load({
        runId: run.runId,
        manifest,
        observation: effectiveObservation,
        sessionRef: sessionRef || null,
      });
      return {
        job: loaded.job,
        executionOptions: cardMaterialRef == null ? {} : {
          cardMaterialLeaseProvider,
          cardMaterialRef,
          validateCardMaterialOnly,
        },
      };
    },
  });
  const workerService = createBrowserWorkerService({
    dispatchRepository,
    executionRepository,
    runtime,
    resolveExecutionContext: async (job) => {
      const accountKey = await resolveAccountKey({
        orderId: job.orderId,
        attemptId: job.attemptId,
      });
      return {
        executorProfileId: job.executorProfileId || profile,
        accountKeyHmac: hmac(runtimeKey, 'account', accountKey),
        profileManifestSha256: manifest.profileDigest,
        networkLeaseHmac: hmac(runtimeKey, 'network', manifest.networkDigest),
      };
    },
  });
  const integration = new SharedBrowserRuntimeIntegration({
    workerService,
    executionRepository,
    recoveryRepository,
    workerId: worker,
    executorProfileId: profile,
    leaseSeconds,
  });

  return Object.freeze({
    workerId: worker,
    evidenceSink,
    async runOnce({ confirmation } = {}) {
      if (confirmation !== SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION) {
        throw new SharedDryRunError('exact non-payment dry-run confirmation is required', 'CONFIRMATION_REQUIRED');
      }
      await assertPaymentWritesDisabled(pool);
      const result = await integration.runNonPaymentOnce();
      if (result.externalPaymentCalls !== 0) {
        throw new SharedDryRunError('dry-run reported an external payment call', 'PAYMENT_SIDE_EFFECT_DETECTED');
      }
      return result;
    },
  });
}
