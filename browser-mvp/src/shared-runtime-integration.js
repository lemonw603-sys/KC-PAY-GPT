import { assertSafeObject, ContractError } from './contracts.js';

export class SharedBrowserRuntimeError extends Error {
  constructor(message, code, details = undefined, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SharedBrowserRuntimeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const SESSION_ABORTS = new Map([
  ['SESSION_INVALID', 'SESSION_INVALID'],
  ['SESSION_IDENTITY_MISMATCH', 'SESSION_INVALID'],
  ['ACCOUNT_ALREADY_PLUS', 'ACCOUNT_ALREADY_PLUS'],
]);

const SAFE_CARD_RETRY_CODES = new Set([
  'CARD_BALANCE_INSUFFICIENT',
  'CARD_NOT_READY',
  'CARD_CHECK_STALE',
  'CARD_BINDING_MISMATCH',
  'CARD_PROVIDER_MISMATCH',
  'ROUTE_BINDING_MISMATCH',
  'EXECUTOR_KIND_MISMATCH',
  'PAYMENT_SNAPSHOT_CHANGED',
]);

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new SharedBrowserRuntimeError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

function operationalCode(value, fallback) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(normalized) ? normalized : fallback;
}

function assertFormalRun(run) {
  if (!run || typeof run !== 'object') throw new SharedBrowserRuntimeError('shared beginRun result is missing', 'RUN_NOT_STARTED');
  if (run.runStatus !== 'RUNNING') throw new SharedBrowserRuntimeError('shared Browser run is not RUNNING', 'RUN_NOT_ACTIONABLE');
  if (run.orderStatus !== 'RECHARGE_PROCESSING') throw new SharedBrowserRuntimeError('shared order is not RECHARGE_PROCESSING', 'ORDER_NOT_READY');
  if (run.attemptStatus !== 'PREPARED' || run.fundsRiskState !== 'ACTIVE') {
    throw new SharedBrowserRuntimeError('shared funds attempt is not PREPARED/ACTIVE', 'ATTEMPT_NOT_READY');
  }
  if (run.paymentState !== 'NOT_STARTED') {
    throw new SharedBrowserRuntimeError('non-payment execution requires NOT_STARTED payment state', 'PAYMENT_ALREADY_ARMED');
  }
  return run;
}

function classifySafeAbort(error) {
  const sourceCode = operationalCode(error?.reason || error?.code, 'BROWSER_RUNTIME_FAILURE');
  const customerActionCode = SESSION_ABORTS.get(sourceCode) || null;
  if (customerActionCode) {
    return {
      targetOrderStatus: 'WAITING_FOR_SESSION',
      reasonCode: customerActionCode,
      customerActionCode,
      failureReason: customerActionCode === 'ACCOUNT_ALREADY_PLUS'
        ? 'Account already has an active Plus subscription before payment'
        : 'Browser Session is invalid and must be replaced',
    };
  }
  if (SAFE_CARD_RETRY_CODES.has(sourceCode)) {
    return {
      targetOrderStatus: 'CARD_READY',
      reasonCode: sourceCode,
      customerActionCode: null,
      failureReason: 'Authoritative card or route facts are not ready for Browser payment',
    };
  }
  // The operator's "can we pay" switch is a pause, not a verdict on the order
  // (CORE_SPEC §6). Without this branch a switch flipped mid-run ended the
  // order as RECHARGE_FAILED, handed the CDK back and released the card
  // (audit F-25). The order waits at CARD_READY until the switch is on again.
  if (sourceCode === 'BROWSER_PAYMENT_WRITES_DISABLED') {
    return {
      targetOrderStatus: 'CARD_READY',
      reasonCode: sourceCode,
      customerActionCode: null,
      failureReason: 'Browser payment writes are switched off; the order waits for the switch',
    };
  }
  if (sourceCode.includes('LEASE')) {
    return {
      targetOrderStatus: 'CARD_READY',
      reasonCode: 'BROWSER_LEASE_LOST',
      customerActionCode: null,
      failureReason: 'Browser execution lease was lost before payment',
    };
  }
  // Access/navigation blocks are not card-readiness problems. Returning the
  // order to CARD_READY would requeue SUBMIT_RECHARGE and let a readonly
  // worker retry the same blocked Session indefinitely.  Treat this class as
  // a terminal pre-payment failure; the operator can inspect the evidence and
  // deliberately retry later rather than generating repeated attempts.
  if (sourceCode === 'CHATGPT_ACCESS_BLOCKED'
    || sourceCode === 'CHECKOUT_NAVIGATION_FAILED'
    || sourceCode === 'CHECKOUT_OBSERVATION_FAILED') {
    return {
      targetOrderStatus: 'RECHARGE_FAILED',
      reasonCode: sourceCode,
      customerActionCode: null,
      failureReason: 'Browser could not access or verify the ChatGPT checkout before payment',
    };
  }
  return {
    targetOrderStatus: 'RECHARGE_FAILED',
    reasonCode: sourceCode,
    customerActionCode: null,
    failureReason: 'Browser execution stopped safely before payment',
  };
}

/**
 * Adapter between the Browser-only executor and the shared dispatch/run/funds
 * repositories. This class has no payment submitter and therefore cannot make
 * an external payment. A successful observation is deliberately closed with
 * abortBeforePayment(CARD_READY) until the separately confirmed payment lane
 * is implemented and enabled.
 */
export class SharedBrowserRuntimeIntegration {
  constructor({
    workerService,
    executionRepository,
    recoveryRepository,
    workerId,
    executorProfileId = null,
    leaseSeconds = 60,
  } = {}) {
    if (!workerService || typeof workerService.claim !== 'function' || typeof workerService.runClaimedJob !== 'function') {
      throw new TypeError('workerService with claim/runClaimedJob is required');
    }
    if (!executionRepository || typeof executionRepository.abortBeforePayment !== 'function'
      || typeof executionRepository.issuePaymentPermit !== 'function') {
      throw new TypeError('executionRepository with abortBeforePayment/issuePaymentPermit is required');
    }
    if (!recoveryRepository || typeof recoveryRepository.acquireRunResources !== 'function'
      || typeof recoveryRepository.heartbeatRunResources !== 'function'
      || typeof recoveryRepository.recoverExpiredRun !== 'function') {
      throw new TypeError('recoveryRepository with acquire/heartbeat/recover is required');
    }
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
      throw new TypeError('leaseSeconds must be between 10 and 3600');
    }
    this.workerService = workerService;
    this.executionRepository = executionRepository;
    this.recoveryRepository = recoveryRepository;
    this.workerId = required(workerId, 'workerId');
    this.executorProfileId = executorProfileId == null
      ? null : required(executorProfileId, 'executorProfileId');
    this.leaseSeconds = leaseSeconds;
  }

  async #effectiveRun(control) {
    // F-26: a worker that died after committing the submit intent (the click
    // may or may not have happened) leaves the run RUNNING/PAYMENT_SUBMITTING.
    // Nothing moves it from there: the verification lane only looks at
    // PAYMENT_UNKNOWN / PAYMENT_CONFIRMED, and the resumability guard below
    // would reject it every tick. Lock it as unknown (attempt UNKNOWN, ledger
    // RECONCILIATION, order SUBMIT_UNKNOWN, verification scheduled) so the
    // verification lane takes over. It is never resumed or re-clicked.
    if (control.run?.idempotentReplay && control.run.paymentState === 'PAYMENT_SUBMITTING'
      && typeof this.executionRepository.markPaymentUnknown === 'function') {
      await this.executionRepository.markPaymentUnknown({
        runId: control.run.runId,
        operationId: `browser-recovery-unknown:${control.run.runId}`,
        reasonCode: 'WORKER_LOST_AFTER_SUBMIT_INTENT',
      });
      throw new SharedBrowserRuntimeError(
        'run lost its worker after the submit intent; locked for payment verification',
        'RUN_NOT_RESUMABLE', { recoveryMode: 'RECONCILE_ONLY' },
      );
    }
    assertFormalRun(control.run);
    if (control.run.leaseToken) {
      await this.recoveryRepository.acquireRunResources({
        runId: control.run.runId,
        ownerId: this.workerId,
        leaseToken: control.run.leaseToken,
        ttlSeconds: this.leaseSeconds,
      });
      return { ...control.run, resourcesAcquired: true };
    }
    if (!control.run.idempotentReplay) {
      throw new SharedBrowserRuntimeError('new Browser run did not return its one-time lease', 'RUN_LEASE_MISSING');
    }
    const recovered = await this.recoveryRepository.recoverExpiredRun({
      runId: control.run.runId,
      newOwnerId: this.workerId,
      ttlSeconds: this.leaseSeconds,
    });
    if (!recovered.leaseToken || !['RESUMABLE', 'RESUME_EXISTING_ARTIFACT'].includes(recovered.recoveryMode)) {
      throw new SharedBrowserRuntimeError('replayed Browser run is not safely resumable', 'RUN_NOT_RESUMABLE', {
        recoveryMode: recovered.recoveryMode,
      });
    }
    return { ...control.run, leaseToken: recovered.leaseToken, recovered: true, resourcesAcquired: true };
  }

  async #heartbeatRun(run) {
    return this.recoveryRepository.heartbeatRunResources({
      runId: run.runId,
      ownerId: this.workerId,
      leaseToken: run.leaseToken,
      ttlSeconds: this.leaseSeconds,
    });
  }

  async #abort(control, run, abort) {
    const result = await this.executionRepository.abortBeforePayment({
      runId: run.runId,
      workerId: this.workerId,
      leaseToken: run.leaseToken,
      operationId: `browser-abort:${run.runId}:${abort.reasonCode.toLowerCase()}`,
      targetOrderStatus: abort.targetOrderStatus,
      reasonCode: abort.reasonCode,
      failureReason: abort.failureReason,
      customerActionCode: abort.customerActionCode,
    });
    if (result.fundsRiskState !== 'CLEARED' || result.attemptStatus !== 'CLEARED') {
      throw new SharedBrowserRuntimeError('pre-payment abort left the funds fence active', 'FUNDS_FENCE_NOT_CLEARED');
    }
    control.stop();
    return result;
  }

  /**
   * Future payment-lane boundary. The caller cannot supply a snapshot hash;
   * issuePaymentPermit() derives it from locked authoritative database facts.
   * This method is not invoked by runNonPaymentOnce().
   */
  async issueAuthoritativePaymentPermit({ control, run, ttlSeconds = 60 } = {}) {
    if (!control || typeof control.assertLeaseBeforeAction !== 'function') {
      throw new TypeError('claimed control is required');
    }
    await control.assertLeaseBeforeAction('PAYMENT_PERMIT');
    await this.#heartbeatRun(run);
    return this.executionRepository.issuePaymentPermit({
      runId: required(run?.runId, 'run.runId'),
      workerId: this.workerId,
      leaseToken: required(run?.leaseToken, 'run.leaseToken'),
      ttlSeconds,
    });
  }

  async abortForPrePaymentFailure({ control, run, error } = {}) {
    if (!control || typeof control.stop !== 'function') throw new TypeError('claimed control is required');
    const abort = classifySafeAbort(error);
    const closed = await this.#abort(control, run, abort);
    return {
      status: 'SAFE_ABORTED',
      reasonCode: abort.reasonCode,
      diagnosticMessage: String(error?.message || '').slice(0, 300),
      targetOrderStatus: closed.orderStatus,
      fundsRiskState: closed.fundsRiskState,
      externalPaymentCalls: 0,
    };
  }

  async runNonPaymentOnce() {
    const claimed = await this.workerService.claim(this.workerId, {
      executorProfileId: this.executorProfileId,
      leaseSeconds: this.leaseSeconds,
    });
    if (!claimed) return { status: 'IDLE', workerId: this.workerId, externalPaymentCalls: 0 };
    if (claimed.status !== 'CLAIMED') {
      throw new SharedBrowserRuntimeError('dispatch repository returned a non-claimed job', 'JOB_NOT_CLAIMED');
    }
    if (claimed.leaseOwner !== this.workerId || !claimed.leaseToken) {
      throw new SharedBrowserRuntimeError('claimed dispatch lease is not owned by this worker', 'LEASE_NOT_OWNED');
    }
    if (this.executorProfileId && claimed.executorProfileId !== this.executorProfileId) {
      throw new SharedBrowserRuntimeError(
        'claimed dispatch job belongs to another executor profile',
        'EXECUTOR_PROFILE_CONFLICT',
      );
    }
    const control = await this.workerService.runClaimedJob(claimed, {
      workerId: this.workerId,
      leaseToken: claimed.leaseToken,
      leaseSeconds: this.leaseSeconds,
    });
    let run;
    try {
      run = await this.#effectiveRun(control);
      const result = await control.perform('executeNonPayment', (executeNonPayment, actionContext) => (
        executeNonPayment({
          claimedJob: claimed,
          run,
          heartbeatRunLease: () => this.#heartbeatRun(run),
        }, actionContext)
      ));
      assertSafeObject(result, 'non-payment Browser result');
      if (result?.submitCalls !== 0) {
        throw new SharedBrowserRuntimeError('non-payment runtime reported a payment submit call', 'PAYMENT_SIDE_EFFECT_DETECTED');
      }
      const abort = {
        targetOrderStatus: 'CARD_READY',
        reasonCode: 'NONPAYMENT_VERIFIED',
        customerActionCode: null,
        failureReason: 'Browser non-payment integration completed without a payment action',
      };
      const closed = await this.#abort(control, run, abort);
      return {
        status: 'SAFE_ABORTED',
        workerId: this.workerId,
        jobId: claimed.jobId,
        runId: run.runId,
        reasonCode: abort.reasonCode,
        targetOrderStatus: closed.orderStatus,
        fundsRiskState: closed.fundsRiskState,
        result,
        externalPaymentCalls: 0,
      };
    } catch (error) {
      control.stop();
      if (error?.code === 'PAYMENT_SIDE_EFFECT_DETECTED') {
        throw new SharedBrowserRuntimeError(
          'non-payment runtime reported a possible payment side effect; funds state must remain locked for reconciliation',
          'PAYMENT_SIDE_EFFECT_REQUIRES_RECONCILIATION',
          undefined,
          error,
        );
      }
      if (!run?.leaseToken) throw error;
      try {
        const closed = await this.abortForPrePaymentFailure({ control, run, error });
        return {
          ...closed,
          workerId: this.workerId,
          jobId: claimed.jobId,
          runId: run.runId,
        };
      } catch (abortError) {
        throw new SharedBrowserRuntimeError(
          'Browser failed before payment and the authoritative safe-abort did not close cleanly',
          'SAFE_ABORT_FAILED',
          { sourceCode: operationalCode(error?.reason || error?.code, 'BROWSER_RUNTIME_FAILURE') },
          abortError,
        );
      }
    }
  }

  /** One-order LIVE lane. The dispatch query itself is constrained by orderId. */
  // approvedOrderId binds the run to one order (the single-order LIVE tool);
  // null lets a resident lane claim the next queued Browser job of its
  // executor profile. Payment authority never comes from this argument: it is
  // the database flag, the permit and the unique PAYMENT_SUBMIT operation.
  async runPaymentOnce({ approvedOrderId = null, safeAbortOnFailure = false, maxDispatchAttempts = 3 } = {}) {
    const orderId = approvedOrderId == null ? null : required(approvedOrderId, 'approvedOrderId');
    const claimed = await this.workerService.claim(this.workerId, {
      executorProfileId: this.executorProfileId,
      ...(orderId ? { orderId } : {}),
      leaseSeconds: this.leaseSeconds,
    });
    if (!claimed) return { status: 'IDLE', workerId: this.workerId, externalPaymentCalls: 0 };
    if (claimed.status !== 'CLAIMED' || (orderId && claimed.orderId !== orderId)
      || claimed.leaseOwner !== this.workerId || !claimed.leaseToken) {
      throw new SharedBrowserRuntimeError('LIVE dispatch is not the approved owned job', 'LIVE_JOB_NOT_APPROVED');
    }
    const control = await this.workerService.runClaimedJob(claimed, {
      workerId: this.workerId,
      leaseToken: claimed.leaseToken,
      leaseSeconds: this.leaseSeconds,
    });
    let run;
    try {
      run = await this.#effectiveRun(control);
      const result = await control.perform('executePayment', (executePayment, actionContext) => (
        executePayment({
          claimedJob: claimed,
          run,
          control,
          heartbeatRunLease: () => this.#heartbeatRun(run),
        }, actionContext)
      ), { actionTimeoutMs: 10 * 60_000 });
      assertSafeObject(result, 'LIVE Browser result');
      const payment = result?.paymentResult;
      if (!payment || !Number.isInteger(payment.paymentSubmitCalls)
        || payment.paymentSubmitCalls < 0 || payment.paymentSubmitCalls > 1) {
        throw new SharedBrowserRuntimeError('LIVE runtime returned an invalid payment result', 'PAYMENT_RESULT_INVALID');
      }
      if (payment.status === 'COMPLETED') {
        const dispatch = await control.complete();
        return { status: 'COMPLETED', workerId: this.workerId, jobId: claimed.jobId, orderId: claimed.orderId,
          runId: run.runId, dispatchStatus: dispatch.status, externalPaymentCalls: payment.paymentSubmitCalls };
      }
      if (['MANUAL_20X_HANDOFF', 'MANUAL_20X_REVIEW_REQUIRED'].includes(payment.status)) {
        control.stop();
        return { status: payment.status, workerId: this.workerId,
          jobId: claimed.jobId, orderId: claimed.orderId, runId: run.runId,
          externalPaymentCalls: payment.paymentSubmitCalls, profilePreserved: true };
      }
      if (payment.status === 'PRE_SUBMIT_STOPPED') {
        if (payment.paymentSubmitCalls !== 0) {
          throw new SharedBrowserRuntimeError('rehearsal reported a submit click', 'PAYMENT_RESULT_INVALID');
        }
        // The rehearsal proved the page path up to the click. Clear the funds
        // fence and return the order to CARD_READY so the paying run can
        // claim it later; the identity keeps its filled Checkout for inspection.
        const closed = await this.#abort(control, run, {
          targetOrderStatus: 'CARD_READY',
          reasonCode: 'BROWSER_REHEARSAL_STOPPED',
          customerActionCode: null,
          failureReason: 'Browser rehearsal stopped before the payment submit by configuration',
        });
        return { status: 'PRE_SUBMIT_STOPPED', reasonCode: 'BROWSER_REHEARSAL_STOPPED',
          workerId: this.workerId, jobId: claimed.jobId, orderId: claimed.orderId, runId: run.runId,
          targetOrderStatus: closed.orderStatus, fundsRiskState: closed.fundsRiskState,
          quote: payment.quote || null, externalPaymentCalls: 0, profilePreserved: true };
      }
      if (['UNKNOWN', 'POST_PAYMENT_UNKNOWN', 'RECONCILE_ONLY'].includes(payment.status)) {
        control.stop();
        return { status: payment.status, workerId: this.workerId, jobId: claimed.jobId, orderId: claimed.orderId,
          runId: run.runId, reasonCode: payment.reasonCode || null,
          externalPaymentCalls: payment.paymentSubmitCalls };
      }
      if (payment.status === 'PRE_SUBMIT_FAILED') {
        const closed = await this.abortForPrePaymentFailure({
          control, run,
          error: { code: payment.reasonCode || 'PRE_SUBMIT_FAILED' },
        });
        return { ...closed, workerId: this.workerId, jobId: claimed.jobId, orderId: claimed.orderId, runId: run.runId };
      }
      throw new SharedBrowserRuntimeError('LIVE payment result is unsupported', 'PAYMENT_RESULT_INVALID');
    } catch (error) {
      if (!run?.leaseToken) { control.stop(); throw error; }
      const state = await this.executionRepository.getRecoveryState(run.runId).catch(() => null);
      if (state?.recoveryMode === 'RECONCILE_ONLY') {
        control.stop();
        return { status: 'RECONCILE_ONLY', workerId: this.workerId, jobId: claimed.jobId, orderId: claimed.orderId,
          runId: run.runId, reasonCode: operationalCode(error?.code, 'LIVE_RUNTIME_FAILURE'),
          externalPaymentCalls: 0 };
      }
      // A resident lane cannot leave a failed run RUNNING for a human: with no
      // submission intent it is provably pre-payment, so close it with the
      // classified safe-abort (Session problems go back to the customer,
      // access blocks are terminal, card facts requeue) and keep the page.
      // Repeated failures of one dispatch stop requeueing after a few tries.
      const prePayment = state?.recoveryMode === 'RESUMABLE' && state?.runStatus === 'RUNNING'
        && (state.paymentState == null || ['NOT_STARTED', 'PAYMENT_ARMED'].includes(state.paymentState));
      if (safeAbortOnFailure && prePayment) {
        const exhausted = Number(claimed.attemptCount || 0) >= maxDispatchAttempts;
        const abortError = exhausted ? { code: 'BROWSER_RETRY_LIMIT', message: 'dispatch attempts exhausted' } : { code: error?.reason || error?.code, message: error?.message };
        const closed = await this.abortForPrePaymentFailure({ control, run, error: abortError });
        return { ...closed, workerId: this.workerId, jobId: claimed.jobId, orderId: claimed.orderId, runId: run.runId,
          failure: operationalCode(error?.reason || error?.code, 'LIVE_RUNTIME_FAILURE'), profilePreserved: true };
      }
      control.stop();
      throw error;
    }
  }
}

/**
 * Runtime action consumed by BrowserWorkerService.perform(). The resolver may
 * obtain Session and card material just-in-time, but those values never enter
 * dispatch/run logs or the return object.
 */
export function createBrowserExecutionRuntime({ executionService, resolveExecutionContext } = {}) {
  if (!executionService || typeof executionService.execute !== 'function') {
    throw new TypeError('executionService is required');
  }
  if (typeof resolveExecutionContext !== 'function') {
    throw new TypeError('resolveExecutionContext is required');
  }
  return Object.freeze({
    async executeNonPayment({ claimedJob, run, heartbeatRunLease }, { signal } = {}) {
      if (typeof heartbeatRunLease !== 'function') throw new TypeError('heartbeatRunLease is required');
      const resolved = await resolveExecutionContext({ claimedJob, run });
      if (!resolved?.job || resolved.job.state !== 'RUNNING') {
        throw new ContractError('runtime resolver must return a RUNNING Browser job');
      }
      if (resolved.job.metadata?.browserRunRef !== `run:${run.runId}`) {
        throw new ContractError('Browser job must be bound to the claimed browser_run.id');
      }
      const assertLease = async () => {
        if (signal?.aborted) return false;
        await heartbeatRunLease();
        return !signal?.aborted;
      };
      const result = await executionService.execute(resolved.job, {
        ...(resolved.executionOptions || {}),
        assertLease,
        signal,
      });
      assertSafeObject(result, 'Browser execution result');
      return result;
    },
  });
}

/** Runtime bridge that keeps the page, Session and card lease alive through post-payment verification. */
export function createBrowserPaymentExecutionRuntime({
  executionService,
  resolveExecutionContext,
  createPaymentHandler,
  preserveRuntimeOnManualHandoff = false,
  releaseSessionOnComplete = false,
} = {}) {
  if (!executionService || typeof executionService.execute !== 'function') throw new TypeError('executionService is required');
  if (typeof resolveExecutionContext !== 'function') throw new TypeError('resolveExecutionContext is required');
  if (typeof createPaymentHandler !== 'function') throw new TypeError('createPaymentHandler is required');
  return Object.freeze({
    async executePayment({ claimedJob, run, control, heartbeatRunLease }, { signal } = {}) {
      const resolved = await resolveExecutionContext({ claimedJob, run });
      if (!resolved?.job || resolved.job.state !== 'RUNNING'
        || resolved.job.metadata?.browserRunRef !== `run:${run.runId}`) {
        throw new ContractError('LIVE Browser job must be bound to the claimed run');
      }
      const assertLease = async () => {
        if (signal?.aborted) return false;
        await heartbeatRunLease();
        return !signal?.aborted;
      };
      const paymentHandler = await createPaymentHandler({ claimedJob, run, control, assertLease });
      return executionService.execute(resolved.job, {
        ...(resolved.executionOptions || {}),
        assertLease,
        signal,
        paymentHandler,
        preserveRuntimeOnManualHandoff,
        preserveRuntimeOnFailure: true,
        releaseSessionOnComplete,
        startFresh: run?.recovered !== true,
      });
    },
  });
}
