import { createHmac } from 'node:crypto';

import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { createBrowserRecoveryRepository } from '../../v1/src/db/repositories/browser-recovery-repository.js';
import { createBrowserWorkerService } from '../../v1/src/services/browser-worker-service.js';
import { BrowserExecutionService } from './executor.js';
import { createMysqlUpstreamProjectionAdapter } from './mysql-upstream-adapter.js';
import { BrowserPaymentExecutor } from './payment-executor.js';
import { createHumanVerificationGate } from './human-verification-gate.js';
import { createLocalOperatorNotifier } from './local-operator-notify.js';
import { LiveChatGPTPaymentAdapter, LIVE_PAYMENT_CONFIRMATION } from './live-chatgpt-payment-adapter.js';
import { ChatGptPostPaymentVerifier } from './chatgpt-post-payment-verifier.js';
import { recoverSessionAfterPayment } from './post-payment-session-recovery.js';
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

/**
 * Rehearsal of the exact LIVE single pass (card → address → email → zero-tax
 * requote → final recheck) that stops before the submit click. It never asks
 * for a permit or a submission intent, so the adapter cannot cross the
 * external boundary: authorizeSubmit always answers "do not execute".
 */
export async function runPreSubmitRehearsal({
  adapter, control, page, checkout, checkoutContract, cardMaterial, billingEmail, operationId,
} = {}) {
  if (!adapter || typeof adapter.submit !== 'function') throw new TypeError('adapter is required');
  if (!control || typeof control.assertLeaseBeforeAction !== 'function') throw new TypeError('control is required');
  const op = required(operationId, 'operationId');
  try {
    const result = await adapter.submit({
      page, operationId: op, checkout, checkoutContract, cardMaterial, billingEmail,
      assertContinue: () => control.assertLeaseBeforeAction('PAYMENT_PAGE_ACTION'),
      beforeSubmit: () => control.assertLeaseBeforeAction('FINAL_PRE_SUBMIT_RECHECK'),
      authorizeSubmit: async () => ({ executeExternal: false, rehearsal: true }),
    });
    if (result?.status !== 'RECONCILE_ONLY') {
      throw Object.assign(new Error('rehearsal adapter returned an unexpected status'), { code: 'REHEARSAL_RESULT_INVALID' });
    }
    return {
      status: 'PRE_SUBMIT_STOPPED', reasonCode: 'STOP_BEFORE_SUBMIT', paymentSubmitCalls: 0,
      quote: result.quote || null, preserveProfile: true,
    };
  } catch (error) {
    // Without authorization the adapter never clicks; an UNKNOWN here would be
    // a contract violation and must surface, never be softened.
    if (error?.code === 'PAYMENT_RESULT_UNKNOWN') throw error;
    return { status: 'PRE_SUBMIT_FAILED', reasonCode: error?.code || 'PRE_SUBMIT_FAILED', paymentSubmitCalls: 0 };
  }
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
  // D-154: how long to hold the clicked checkout page while a person satisfies a
  // human-verification challenge. 0 = do not wait (only detect and report).
  humanVerificationWaitMs = 0,
  notifyOperator = createLocalOperatorNotifier(),
  postPlusAction = 'CANCEL_RENEWAL',
  resolvePlan = null,
  stopBeforeSubmit = false,
  releaseSessionOnComplete = false,
  // Resident lanes close failed pre-payment runs themselves (classified safe
  // abort, bounded retries); the single-order tool leaves them for a human.
  safeAbortOnFailure = false,
} = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('mysql2-like pool is required');
  if (typeof postPlusAction !== 'function' && !['CANCEL_RENEWAL', 'MANUAL_20X_HANDOFF', 'UPGRADE_DIALOG_STOP'].includes(postPlusAction)) {
    throw new TypeError('postPlusAction must be CANCEL_RENEWAL, MANUAL_20X_HANDOFF, UPGRADE_DIALOG_STOP or a function of the plan');
  }
  if (stopBeforeSubmit === true && typeof postPlusAction === 'string' && postPlusAction !== 'CANCEL_RENEWAL') {
    throw new TypeError('a rehearsal cannot carry a manual 20X handoff');
  }
  const resolvePostPlusAction = (plan) => (typeof postPlusAction === 'function' ? postPlusAction(plan) : postPlusAction);
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
  // null = resident lane serving any queued Browser job of this executor profile.
  const approvedOrder = approvedOrderId == null ? null : required(approvedOrderId, 'approvedOrderId');
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
    if (approvedOrder && claimedJob.orderId !== approvedOrder) throw new Error('claimed order is not approved for LIVE payment');
    const sessionIdentity = await resolveSessionIdentity({
      orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId,
    });
    // Two-stage Pro (pro_5x/pro_20x): stage 1 always buys Plus in Checkout; the Pro
    // upgrade runs after payment (UPGRADE_DIALOG_STOP). A free account cannot buy Pro
    // directly, and the Pro tier toggle is absent on the Plus purchase dialog, so the
    // checkout navigation plan is fixed to plus; only the post-payment upgrade uses the order plan.
    const loaded = await upstreamAdapter.load({
      runId: run.runId, manifest, observation: { ...observation, sessionIdentity, plan: 'plus' },
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
    preserveRuntimeOnManualHandoff: typeof postPlusAction === 'function' || postPlusAction !== 'CANCEL_RENEWAL',
    releaseSessionOnComplete: releaseSessionOnComplete === true,
    createPaymentHandler: async ({ claimedJob, run, control }) => async ({
      page, checkout, checkoutContract, cardMaterial, billingEmail,
    }) => {
      if (stopBeforeSubmit === true) {
        return runPreSubmitRehearsal({
          adapter: new LiveChatGPTPaymentAdapter({
            enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION,
            outcomeObserver: async () => { throw new Error('rehearsal never observes a payment outcome'); },
          }),
          control, page, checkout, checkoutContract, cardMaterial, billingEmail,
          operationId: `browser-live-rehearsal:${run.runId}`,
        });
      }
      const plan = typeof resolvePlan === 'function'
        ? await resolvePlan({ orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId }) : 'plus';
      const action = resolvePostPlusAction(plan);
      const sessionRefInput = { orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId };
      const verifier = new ChatGptPostPaymentVerifier({
        page,
        expectedIdentity: await resolveSessionIdentity(sessionRefInput),
        transactionReader: await transactionReaderFactory({ runId: run.runId }),
        timeoutMs: verificationWindowMs,
        pollIntervalMs: verificationIntervalMs,
        upgradePlan: action === 'UPGRADE_DIALOG_STOP' ? plan : null,
        navigationTimeoutMs: executionTimeoutMs,
        // D-134 (2026-09-08 root cause): payment rotates the ChatGPT session. The
        // backend sets a FRESH session-token (Plus, with a live accessToken) in the
        // browser after checkout succeeds. The order only holds the PRE-payment
        // token (Free, expired accessToken, no auth.openai.com layer to refresh).
        // Reinjecting that old token overwrote the fresh one and forced a false
        // "session expired". Recovery must NOT reinject: it only reloads so the
        // front-end re-establishes login from the post-payment token the browser
        // already holds.
        sessionRecovery: (targetPage) => recoverSessionAfterPayment(targetPage, {
          navigationTimeoutMs: executionTimeoutMs,
        }),
      });
      const adapter = new LiveChatGPTPaymentAdapter({
        enabled: true,
        confirmation: LIVE_PAYMENT_CONFIRMATION,
        // D-154: detect a human-verification challenge raised by the submit click,
        // tell the operator, and wait for a person to satisfy it in the window.
        // Never satisfied here; `humanVerificationWaitMs = 0` keeps the old
        // behaviour except that the reason is now recorded.
        challengeGate: createHumanVerificationGate({
          waitMs: humanVerificationWaitMs,
          pollIntervalMs: verificationIntervalMs,
          notify: async ({ waitMs }) => notifyOperator({
            title: '充值需要人工验证',
            message: waitMs > 0
              ? `结账页出现人机验证。请在比特浏览器窗口勾选，${Math.round(waitMs / 1000)} 秒内勾选自动继续；超时表单保留，可自行完成`
              : '结账页出现人机验证。自动化不处理该验证，本单已停并保留现场',
          }),
        }),
        outcomeObserver: async () => ({ status: (await verifier.confirmPlus()).confirmed ? 'CONFIRMED' : 'UNKNOWN' }),
      });
      return new BrowserPaymentExecutor({
        integration, executionRepository, paymentAdapter: adapter,
        postPaymentVerifier: verifier, enabled: true,
        postPlusAction: action,
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
    stopBeforeSubmit: stopBeforeSubmit === true,
    runOnce: () => integration.runPaymentOnce({ approvedOrderId: approvedOrder, safeAbortOnFailure: safeAbortOnFailure === true }),
    resident: approvedOrder == null,
  });
}
