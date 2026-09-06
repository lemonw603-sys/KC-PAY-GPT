import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

import { createBrowserWorkerService } from '../../v1/src/services/browser-worker-service.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { BrowserExecutionService } from '../src/executor.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { createSyntheticManifest } from '../src/fixtures.js';
import { projectSharedBrowserJob } from '../src/shared-contract-adapter.js';
import {
  createBrowserExecutionRuntime,
  SharedBrowserRuntimeIntegration,
} from '../src/shared-runtime-integration.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function formalProjection(run, observation = undefined) {
  return {
    order: { id: 'order-runtime-1', status: 'RECHARGE_PROCESSING', fulfillmentRouteId: 'route-runtime-1', frozenCardProviderAccountId: 'provider-runtime-1' },
    attempt: {
      id: 'attempt-runtime-1', status: 'PREPARED', fundsRiskState: 'ACTIVE',
      executorKind: 'BROWSER', executorProfileId: 'profile-runtime-1',
      fulfillmentRouteId: 'route-runtime-1',
    },
    profile: { id: 'profile-runtime-1' },
    run: {
      id: run.runId, attemptId: 'attempt-runtime-1', status: 'RUNNING',
      paymentState: run.paymentState,
    },
    card: {
      id: 'card-runtime-1', orderId: 'order-runtime-1',
      providerCardRef: 'provider-card-runtime-1', providerAccountId: 'provider-runtime-1',
    },
    cardConsumption: {
      id: 'consumption-runtime-1', status: 'RESERVED',
      attemptId: 'attempt-runtime-1', orderId: 'order-runtime-1', cardId: 'card-runtime-1',
    },
    route: { id: 'route-runtime-1', executorKind: 'BROWSER', cardProviderAccountId: 'provider-runtime-1' },
    ...(observation == null ? {} : { observation }),
  };
}

function makeHarness({ execution, loseDispatchLeaseAt = Infinity, replayRun = false, permitError = null } = {}) {
  const state = {
    claimCount: 0,
    heartbeatCount: 0,
    runHeartbeatCount: 0,
    externalPaymentCalls: 0,
    orderStatus: 'RECHARGE_PROCESSING',
    attemptStatus: 'PREPARED',
    fundsRiskState: 'ACTIVE',
    dispatchStatus: 'CLAIMED',
    runStatus: 'RUNNING',
    paymentState: 'NOT_STARTED',
    permits: [],
    aborts: [],
    recovered: 0,
  };
  const dispatchRepository = {
    async claim({ workerId }) {
      state.claimCount += 1;
      if (state.claimCount > 1) return null;
      return {
        jobId: 'dispatch-runtime-1', jobKey: 'dispatch-key-runtime-1',
        attemptId: 'attempt-runtime-1', orderId: 'order-runtime-1',
        status: 'CLAIMED', leaseOwner: workerId, leaseToken: 'dispatch-lease-runtime-1',
      };
    },
    async heartbeat() {
      state.heartbeatCount += 1;
      if (state.heartbeatCount >= loseDispatchLeaseAt) {
        throw Object.assign(new Error('dispatch lease lost'), { code: 'LEASE_NOT_OWNED' });
      }
      return { leaseUntil: new Date(Date.now() + 60_000) };
    },
    async complete() { throw new Error('safe-abort path must not separately complete dispatch'); },
  };
  const executionRepository = {
    async beginRun() {
      return {
        runId: 'run-runtime-1', runStatus: state.runStatus, paymentState: state.paymentState,
        attemptStatus: state.attemptStatus, fundsRiskState: state.fundsRiskState,
        orderStatus: state.orderStatus, leaseToken: replayRun ? null : 'run-lease-runtime-1',
        idempotentReplay: replayRun,
      };
    },
    async getRecoveryState() {
      return {
        recoveryMode: state.runStatus === 'RUNNING' ? 'RESUMABLE' : 'TERMINAL',
        runStatus: state.runStatus, paymentState: state.paymentState,
      };
    },
    async issuePaymentPermit(input) {
      assert.equal(Object.hasOwn(input, 'snapshotHash'), false);
      if (permitError) throw Object.assign(new Error('authoritative permit rejected'), { code: permitError });
      state.permits.push({ status: 'ISSUED' });
      state.paymentState = 'PAYMENT_ARMED';
      return { permitId: 'permit-runtime-1', permitNonce: 'nonce-runtime-1', snapshotHash: digest('server-facts') };
    },
    async abortBeforePayment(input) {
      state.aborts.push(input);
      assert.equal(state.externalPaymentCalls, 0);
      state.orderStatus = input.targetOrderStatus;
      state.attemptStatus = 'CLEARED';
      state.fundsRiskState = 'CLEARED';
      state.dispatchStatus = 'CANCELLED';
      state.runStatus = 'FAILED_SAFE';
      state.permits.forEach((permit) => { permit.status = 'REVOKED'; });
      return {
        runId: input.runId, runStatus: state.runStatus, paymentState: state.paymentState,
        attemptStatus: state.attemptStatus, fundsRiskState: state.fundsRiskState,
        orderStatus: state.orderStatus,
      };
    },
  };
  const recoveryRepository = {
    async acquireRunResources() { return { resourceTypes: ['ACCOUNT', 'ORDER', 'CARD'] }; },
    async heartbeatRunResources() { state.runHeartbeatCount += 1; return { resourceCount: 3 }; },
    async recoverExpiredRun() {
      state.recovered += 1;
      return { recoveryMode: 'RESUMABLE', leaseToken: 'recovered-run-lease-runtime-1' };
    },
  };
  const executionService = {
    async execute(job, options) {
      if (execution) return execution({ job, ...options, state });
      return { status: 'OBSERVED', submitCalls: 0 };
    },
  };
  const runtime = createBrowserExecutionRuntime({
    executionService,
    resolveExecutionContext: async ({ run }) => ({
      job: projectSharedBrowserJob(formalProjection(run), { manifest: createSyntheticManifest() }),
    }),
  });
  const workerService = createBrowserWorkerService({
    dispatchRepository,
    executionRepository,
    resolveExecutionContext: async () => ({
      executorProfileId: 'profile-runtime-1', accountKeyHmac: digest('account'),
      profileManifestSha256: digest('profile'), networkLeaseHmac: digest('network'),
      runId: 'run-runtime-1',
    }),
    runtime,
  });
  const integration = new SharedBrowserRuntimeIntegration({
    workerService, executionRepository, recoveryRepository,
    workerId: 'worker-runtime-1', leaseSeconds: 10,
  });
  return { state, workerService, executionRepository, recoveryRepository, integration };
}

test('shared dispatch/run drives a real BrowserContext then atomically safe-aborts with zero payment', async () => {
  const html = encodeURIComponent('<title>Runtime fixture</title><main data-runtime-marker>safe</main>');
  const evidenceSink = new MemoryEvidenceSink();
  const browserExecution = new BrowserExecutionService({
    runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
    evidenceSink,
    timeoutMs: 2_000,
  });
  const harness = makeHarness({
    execution: async ({ job, ...options }) => {
      const observedJob = projectSharedBrowserJob(formalProjection({
        runId: 'run-runtime-1', paymentState: 'NOT_STARTED',
      }, {
        pageContract: {
          urlPrefix: `data:text/html,${html}`, title: 'Runtime fixture',
          requiredSelector: '[data-runtime-marker]', markerText: 'safe',
        },
      }), { manifest: createSyntheticManifest() });
      return browserExecution.execute(observedJob, options);
    },
  });
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.status, 'SAFE_ABORTED');
  assert.equal(result.reasonCode, 'NONPAYMENT_VERIFIED');
  assert.equal(result.externalPaymentCalls, 0);
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
  assert.equal(harness.state.dispatchStatus, 'CANCELLED');
  assert.deepEqual(evidenceSink.events.map(({ type }) => type), ['intent', 'checkpoint']);
});

test('Session invalid and account-already-Plus return the original order to Session handling', async () => {
  for (const reason of ['SESSION_INVALID', 'SESSION_IDENTITY_MISMATCH', 'ACCOUNT_ALREADY_PLUS']) {
    const harness = makeHarness({ execution: async () => { throw Object.assign(new Error('safe failure'), { reason }); } });
    const result = await harness.integration.runNonPaymentOnce();
    assert.equal(result.targetOrderStatus, 'WAITING_FOR_SESSION');
    assert.equal(result.fundsRiskState, 'CLEARED');
    assert.equal(harness.state.aborts[0].customerActionCode, reason === 'ACCOUNT_ALREADY_PLUS' ? reason : 'SESSION_INVALID');
    assert.equal(harness.state.externalPaymentCalls, 0);
  }
});

test('ChatGPT access blocks are terminal and do not requeue the submit task', async () => {
  const harness = makeHarness({
    execution: async () => {
      throw Object.assign(new Error('upstream access blocked'), { reason: 'CHATGPT_ACCESS_BLOCKED' });
    },
  });
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.status, 'SAFE_ABORTED');
  assert.equal(result.reasonCode, 'CHATGPT_ACCESS_BLOCKED');
  assert.equal(result.targetOrderStatus, 'RECHARGE_FAILED');
  assert.equal(result.externalPaymentCalls, 0);
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
});

test('authoritative permit rejects card balance/status/sync and route drift, then safe-abort clears funds', async () => {
  for (const code of [
    'CARD_BALANCE_INSUFFICIENT', 'CARD_NOT_READY', 'CARD_CHECK_STALE',
    'ROUTE_BINDING_MISMATCH', 'CARD_PROVIDER_MISMATCH', 'PAYMENT_SNAPSHOT_CHANGED',
  ]) {
    const harness = makeHarness({ permitError: code });
    const claimed = await harness.workerService.claim('worker-runtime-1', { leaseSeconds: 10 });
    const control = await harness.workerService.runClaimedJob(claimed, {
      workerId: 'worker-runtime-1', leaseToken: claimed.leaseToken, leaseSeconds: 10,
    });
    const run = control.run;
    await harness.recoveryRepository.acquireRunResources({
      runId: run.runId, ownerId: 'worker-runtime-1', leaseToken: run.leaseToken, ttlSeconds: 10,
    });
    let permitFailure;
    await assert.rejects(
      harness.integration.issueAuthoritativePaymentPermit({ control, run }),
      (error) => { permitFailure = error; return error.code === code; },
    );
    const result = await harness.integration.abortForPrePaymentFailure({ control, run, error: permitFailure });
    assert.equal(result.targetOrderStatus, 'CARD_READY');
    assert.equal(result.reasonCode, code);
    assert.equal(harness.state.fundsRiskState, 'CLEARED');
    assert.equal(harness.state.permits.length, 0);
    assert.equal(harness.state.externalPaymentCalls, 0);
  }
});

test('lease loss before a page action safe-aborts without any external payment', async () => {
  const harness = makeHarness({ loseDispatchLeaseAt: 1 });
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.reasonCode, 'BROWSER_LEASE_LOST');
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
  assert.equal(harness.state.externalPaymentCalls, 0);
});

test('lease loss during a page action aborts runtime and clears the funds fence', async () => {
  const harness = makeHarness({
    loseDispatchLeaseAt: 2,
    execution: async ({ signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ status: 'OBSERVED', submitCalls: 0 }), 2_000);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('runtime aborted'), { reason: 'LEASE_LOST' }));
      }, { once: true });
    }),
  });
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.reasonCode, 'BROWSER_LEASE_LOST');
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
  assert.equal(harness.state.externalPaymentCalls, 0);
});

test('runtime crash is converted into an authoritative pre-payment safe-abort', async () => {
  const harness = makeHarness({ execution: async () => { throw new Error('simulated process/runtime crash'); } });
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.reasonCode, 'BROWSER_RUNTIME_FAILURE');
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
  assert.equal(harness.state.externalPaymentCalls, 0);
});

test('duplicate delivery recovers the existing run lease instead of creating a parallel run', async () => {
  const harness = makeHarness({ replayRun: true });
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.status, 'SAFE_ABORTED');
  assert.equal(harness.state.recovered, 1);
  assert.equal(harness.state.aborts[0].leaseToken, 'recovered-run-lease-runtime-1');
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
});

test('authoritative payment permit boundary accepts no caller snapshot and has no submit capability', async () => {
  const harness = makeHarness();
  const claimed = await harness.workerService.claim('worker-runtime-1', { leaseSeconds: 10 });
  const control = await harness.workerService.runClaimedJob(claimed, {
    workerId: 'worker-runtime-1', leaseToken: claimed.leaseToken, leaseSeconds: 10,
  });
  const run = { ...control.run, leaseToken: control.run.leaseToken };
  await harness.recoveryRepository.acquireRunResources({
    runId: run.runId, ownerId: 'worker-runtime-1', leaseToken: run.leaseToken, ttlSeconds: 10,
  });
  const permit = await harness.integration.issueAuthoritativePaymentPermit({ control, run, ttlSeconds: 30 });
  assert.equal(permit.snapshotHash, digest('server-facts'));
  assert.equal(harness.state.permits.length, 1);
  assert.equal(harness.state.externalPaymentCalls, 0);
  assert.equal(typeof harness.integration.commitPaymentSubmissionIntent, 'undefined');
  control.stop();
});

test('non-payment adapter never leaves an issued permit or active funds fence', async () => {
  const harness = makeHarness();
  const result = await harness.integration.runNonPaymentOnce();
  assert.equal(result.externalPaymentCalls, 0);
  assert.equal(harness.state.permits.length, 0);
  assert.equal(harness.state.attemptStatus, 'CLEARED');
  assert.equal(harness.state.fundsRiskState, 'CLEARED');
});
