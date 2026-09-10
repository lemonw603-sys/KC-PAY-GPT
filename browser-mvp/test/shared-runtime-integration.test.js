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
    // F-25: the payment switch flipped off mid-run is a pause, not a failed order.
    'BROWSER_PAYMENT_WRITES_DISABLED',
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

// F-26: a worker killed after the submit intent leaves the run RUNNING/PAYMENT_SUBMITTING;
// re-claiming it must lock the payment as unknown for the verification lane, never resume,
// never safe-abort (the click may have happened), never click again.
test('a re-claimed run that lost its worker after the submit intent is locked as payment-unknown, not resumed', async () => {
  const harness = makeHarness({ replayRun: true });
  harness.state.paymentState = 'PAYMENT_SUBMITTING';
  harness.state.attemptStatus = 'SUBMITTING';
  const unknownCalls = [];
  harness.executionRepository.markPaymentUnknown = async (input) => {
    unknownCalls.push(input);
    harness.state.runStatus = 'RECONCILE_ONLY';
    harness.state.paymentState = 'PAYMENT_UNKNOWN';
    return { runId: input.runId, runStatus: 'RECONCILE_ONLY', paymentState: 'PAYMENT_UNKNOWN' };
  };
  await assert.rejects(
    () => harness.integration.runPaymentOnce({ safeAbortOnFailure: true }),
    (error) => error.code === 'RUN_NOT_RESUMABLE' && error.details?.recoveryMode === 'RECONCILE_ONLY',
  );
  assert.equal(unknownCalls.length, 1);
  assert.equal(unknownCalls[0].operationId, 'browser-recovery-unknown:run-runtime-1');
  assert.equal(unknownCalls[0].reasonCode, 'WORKER_LOST_AFTER_SUBMIT_INTENT');
  assert.equal(harness.state.recovered, 0, 'recoverExpiredRun must not be attempted');
  assert.equal(harness.state.aborts.length, 0, 'no safe-abort after a submit intent');
  assert.equal(harness.state.externalPaymentCalls, 0);
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

function rehearsalHarness(paymentResult) {
  const calls = { aborts: [], stops: 0, completes: 0, heartbeats: 0 };
  const run = {
    runId: 'run-rehearsal-1', leaseToken: 'run-lease-1', runStatus: 'RUNNING', orderStatus: 'RECHARGE_PROCESSING',
    attemptStatus: 'PREPARED', fundsRiskState: 'ACTIVE', paymentState: 'NOT_STARTED',
  };
  const control = {
    run,
    stop: () => { calls.stops += 1; },
    complete: async () => { calls.completes += 1; return { status: 'COMPLETED' }; },
    assertLeaseBeforeAction: async () => undefined,
    perform: async (name, callback) => callback(async () => ({ paymentResult }), { signal: null }),
  };
  const workerService = {
    claim: async (workerId, { orderId }) => ({ status: 'CLAIMED', orderId, leaseOwner: workerId, leaseToken: 'job-lease-1', jobId: 'job-rehearsal-1' }),
    runClaimedJob: async () => control,
  };
  const executionRepository = {
    abortBeforePayment: async (args) => { calls.aborts.push(args); return { fundsRiskState: 'CLEARED', attemptStatus: 'CLEARED', orderStatus: args.targetOrderStatus }; },
    issuePaymentPermit: async () => { throw new Error('a rehearsal never issues a permit'); },
    getRecoveryState: async () => null,
  };
  const recoveryRepository = {
    acquireRunResources: async () => undefined,
    heartbeatRunResources: async () => { calls.heartbeats += 1; },
    recoverExpiredRun: async () => { throw new Error('not used'); },
  };
  const integration = new SharedBrowserRuntimeIntegration({ workerService, executionRepository, recoveryRepository, workerId: 'worker-rehearsal', leaseSeconds: 60 });
  return { integration, calls };
}

test('rehearsal stop before submit clears the funds fence, returns the order to CARD_READY and keeps the profile', async () => {
  const { integration, calls } = rehearsalHarness({
    status: 'PRE_SUBMIT_STOPPED', reasonCode: 'STOP_BEFORE_SUBMIT', paymentSubmitCalls: 0,
    quote: { currency: 'PHP', amount: '982.14', estimatedTax: '0.00' }, preserveProfile: true,
  });
  const result = await integration.runPaymentOnce({ approvedOrderId: 'order-rehearsal-1' });
  assert.equal(result.status, 'PRE_SUBMIT_STOPPED');
  assert.equal(result.reasonCode, 'BROWSER_REHEARSAL_STOPPED');
  assert.equal(result.externalPaymentCalls, 0);
  assert.equal(result.profilePreserved, true);
  assert.equal(result.targetOrderStatus, 'CARD_READY');
  assert.equal(result.fundsRiskState, 'CLEARED');
  assert.deepEqual(result.quote, { currency: 'PHP', amount: '982.14', estimatedTax: '0.00' });
  assert.equal(calls.aborts.length, 1);
  assert.equal(calls.aborts[0].targetOrderStatus, 'CARD_READY');
  assert.equal(calls.aborts[0].reasonCode, 'BROWSER_REHEARSAL_STOPPED');
  assert.equal(calls.aborts[0].customerActionCode, null);
  assert.equal(calls.stops, 1);
  assert.equal(calls.completes, 0, 'a rehearsal never completes the dispatch as a paid order');
});

test('a rehearsal that reports a submit click is rejected as an invalid payment result', async () => {
  const { integration, calls } = rehearsalHarness({ status: 'PRE_SUBMIT_STOPPED', paymentSubmitCalls: 1 });
  await assert.rejects(() => integration.runPaymentOnce({ approvedOrderId: 'order-rehearsal-2' }), (error) => error.code === 'PAYMENT_RESULT_INVALID');
  assert.equal(calls.aborts.length, 0);
  assert.equal(calls.stops, 1);
});

test('a resident lane claims the next queued job when no order is bound and reports which order it served', async () => {
  const claims = [];
  const { integration } = (() => {
    const h = rehearsalHarness({ status: 'PRE_SUBMIT_STOPPED', reasonCode: 'STOP_BEFORE_SUBMIT', paymentSubmitCalls: 0, quote: null, preserveProfile: true });
    const original = h.integration.workerService.claim;
    h.integration.workerService.claim = async (workerId, options) => { claims.push(options); return original(workerId, { ...options, orderId: options.orderId || 'order-next-in-queue' }); };
    return h;
  })();
  const result = await integration.runPaymentOnce();
  assert.equal(result.status, 'PRE_SUBMIT_STOPPED');
  assert.equal(result.orderId, 'order-next-in-queue');
  assert.equal(claims.length, 1);
  assert.equal('orderId' in claims[0], false, 'an unbound lane must not filter the claim by order');
  // A bound run still refuses a job for another order.
  const bound = rehearsalHarness({ status: 'PRE_SUBMIT_STOPPED', paymentSubmitCalls: 0 });
  bound.integration.workerService.claim = async (workerId) => ({ status: 'CLAIMED', orderId: 'order-other', leaseOwner: workerId, leaseToken: 'lt', jobId: 'job-x' });
  await assert.rejects(() => bound.integration.runPaymentOnce({ approvedOrderId: 'order-bound' }), (e) => e.code === 'LIVE_JOB_NOT_APPROVED');
});

test('a resident lane converts a thrown pre-payment execution failure into a classified safe-abort and stops requeueing after the retry limit', async () => {
  const build = (attemptCount, thrown) => {
    const h = rehearsalHarness(null);
    h.integration.workerService.claim = async (workerId, { orderId }) => ({ status: 'CLAIMED', orderId: orderId || 'order-lane', leaseOwner: workerId, leaseToken: 'lt', jobId: 'job-lane', attemptCount });
    h.integration.workerService.runClaimedJob = async () => ({ ...(await (async () => { const c = {}; return c; })()), run: { runId: 'run-lane', leaseToken: 'rl', runStatus: 'RUNNING', orderStatus: 'RECHARGE_PROCESSING', attemptStatus: 'PREPARED', fundsRiskState: 'ACTIVE', paymentState: 'NOT_STARTED' }, stop: () => { h.calls.stops += 1; }, complete: async () => { h.calls.completes += 1; }, assertLeaseBeforeAction: async () => undefined, perform: async () => { throw thrown; } });
    h.integration.executionRepository.getRecoveryState = async () => ({ paymentState: 'NOT_STARTED', recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' });
    return h;
  };
  // Session problem on the page -> customer action, page kept.
  const sessionCase = build(1, Object.assign(new Error('ChatGPT reports the session has expired'), { reason: 'SESSION_INVALID' }));
  const closed = await sessionCase.integration.runPaymentOnce({ safeAbortOnFailure: true });
  assert.equal(closed.status, 'SAFE_ABORTED'); assert.equal(closed.reasonCode, 'SESSION_INVALID'); assert.equal(closed.targetOrderStatus, 'WAITING_FOR_SESSION');
  assert.equal(closed.orderId, 'order-lane'); assert.equal(closed.profilePreserved, true); assert.equal(closed.externalPaymentCalls, 0);
  assert.equal(sessionCase.calls.aborts[0].customerActionCode, 'SESSION_INVALID');
  // Third failed dispatch attempt -> terminal, no more requeue.
  const exhausted = build(3, Object.assign(new Error('nav'), { reason: 'CHECKOUT_NAVIGATION_FAILED' }));
  const terminal = await exhausted.integration.runPaymentOnce({ safeAbortOnFailure: true });
  assert.equal(terminal.status, 'SAFE_ABORTED'); assert.equal(terminal.reasonCode, 'BROWSER_RETRY_LIMIT'); assert.equal(terminal.targetOrderStatus, 'RECHARGE_FAILED');
  assert.equal(terminal.failure, 'CHECKOUT_NAVIGATION_FAILED');
  // The single-order tool keeps the old behaviour: the failure surfaces, the run stays for a human.
  const manual = build(1, Object.assign(new Error('nav'), { reason: 'CHECKOUT_NAVIGATION_FAILED' }));
  await assert.rejects(() => manual.integration.runPaymentOnce({ approvedOrderId: 'order-lane' }), /nav/);
  assert.equal(manual.calls.aborts.length, 0);
});
