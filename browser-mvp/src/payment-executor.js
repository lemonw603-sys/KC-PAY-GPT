import { createHash } from 'node:crypto';

export class BrowserPaymentExecutorError extends Error {
  constructor(message, code, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BrowserPaymentExecutorError';
    this.code = code;
  }
}

export function loadPaymentExecutorConfig(env = process.env, { liveAdapterAvailable = false } = {}) {
  const enabled = env.BROWSER_PAYMENT_EXECUTOR_ENABLED === 'true';
  const mode = String(env.BROWSER_PAYMENT_EXECUTOR_MODE || 'MOCK').trim().toUpperCase();
  if (!['MOCK', 'LIVE'].includes(mode)) {
    throw new BrowserPaymentExecutorError('BROWSER_PAYMENT_EXECUTOR_MODE must be MOCK or LIVE', 'INVALID_PAYMENT_EXECUTOR_MODE');
  }
  if (mode === 'LIVE' && liveAdapterAvailable !== true) {
    throw new BrowserPaymentExecutorError('LIVE Browser payment adapter is not implemented in this release', 'LIVE_PAYMENT_ADAPTER_UNAVAILABLE');
  }
  return Object.freeze({ enabled, mode });
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new BrowserPaymentExecutorError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

/** A deterministic checkout adapter for tests. It never opens a network connection. */
export class MockCheckoutPaymentAdapter {
  constructor({ outcome = 'CONFIRMED' } = {}) {
    if (!['CONFIRMED', 'UNKNOWN', 'DECLINED'].includes(outcome)) {
      throw new TypeError('mock outcome must be CONFIRMED, UNKNOWN, or DECLINED');
    }
    this.outcome = outcome;
    this.calls = [];
  }

  async submit({ operationId, checkout, cardMaterial, authorizeSubmit }) {
    if (!checkout || checkout.kind !== 'MOCK_CHECKOUT') {
      throw new BrowserPaymentExecutorError('mock adapter requires MOCK_CHECKOUT', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (!cardMaterial || typeof cardMaterial !== 'object') {
      throw new BrowserPaymentExecutorError('card material must stay inside the adapter boundary', 'CARD_MATERIAL_REQUIRED');
    }
    if (typeof authorizeSubmit !== 'function') throw new TypeError('authorizeSubmit is required');
    const intent = await authorizeSubmit();
    if (!intent?.executeExternal) return { status: 'RECONCILE_ONLY' };
    this.calls.push({ operationId: required(operationId, 'operationId') });
    if (this.outcome === 'UNKNOWN') throw new Error('mock checkout connection lost after submit');
    if (this.outcome === 'DECLINED') return { status: 'DECLINED', providerCallRef: `mock-call:${operationId}` };
    return { status: 'CONFIRMED', providerCallRef: `mock-call:${operationId}` };
  }
}

/** Mock post-payment observers used to exercise the status contract without external calls. */
export class MockPostPaymentVerifier {
  constructor({ plusActive = true, cancellationConfirmed = true, cardTransaction = null } = {}) {
    this.plusActive = plusActive;
    this.cancellationConfirmed = cancellationConfirmed;
    this.cardTransaction = cardTransaction || {
      id: 'mock-card-txn-1', type: 'purchase', status: 'success', amount: 20, currency: 'USD',
    };
    this.calls = [];
  }

  async confirmPlus() {
    this.calls.push('plus');
    return { confirmed: this.plusActive, evidence: { kind: 'PLUS_ACTIVE', observed: this.plusActive } };
  }

  async confirmCancellation() {
    this.calls.push('cancellation');
    return { confirmed: this.cancellationConfirmed, evidence: { kind: 'CANCELLATION_CONFIRMED', observed: this.cancellationConfirmed } };
  }

  async readCardTransactions() {
    this.calls.push('card-transactions');
    return [this.cardTransaction];
  }

  async reconcile({ transactions }) {
    this.calls.push('reconcile');
    return { matched: Array.isArray(transactions) && transactions.length > 0 };
  }
}

/**
 * Payment lane orchestration. The shared repository remains authoritative:
 * permit issuance and submit-intent commit happen before the adapter is
 * called. After that point every non-confirmed result is UNKNOWN and is never
 * retried or switched to another card.
 */
export class BrowserPaymentExecutor {
  constructor({ integration, executionRepository, paymentAdapter, postPaymentVerifier,
    enabled = false, verificationWindowMs = 5 * 60_000, verificationIntervalMs = 5_000 } = {}) {
    if (!integration || typeof integration.issueAuthoritativePaymentPermit !== 'function') throw new TypeError('integration is required');
    if (!executionRepository || typeof executionRepository.commitPaymentSubmissionIntent !== 'function') throw new TypeError('executionRepository is required');
    if (!paymentAdapter || typeof paymentAdapter.submit !== 'function') throw new TypeError('paymentAdapter is required');
    if (!postPaymentVerifier || typeof postPaymentVerifier.confirmPlus !== 'function'
      || typeof postPaymentVerifier.confirmCancellation !== 'function'
      || typeof postPaymentVerifier.readCardTransactions !== 'function'
      || typeof postPaymentVerifier.reconcile !== 'function') throw new TypeError('postPaymentVerifier is required');
    this.integration = integration;
    this.executionRepository = executionRepository;
    this.paymentAdapter = paymentAdapter;
    this.postPaymentVerifier = postPaymentVerifier;
    this.enabled = enabled === true;
    if (!Number.isInteger(verificationWindowMs) || verificationWindowMs < 1_000) {
      throw new TypeError('verificationWindowMs must be an integer >= 1000');
    }
    if (!Number.isInteger(verificationIntervalMs) || verificationIntervalMs < 250
      || verificationIntervalMs > verificationWindowMs) {
      throw new TypeError('verificationIntervalMs must be within verificationWindowMs');
    }
    this.verificationWindowMs = verificationWindowMs;
    this.verificationIntervalMs = verificationIntervalMs;
  }

  async execute({
    control, run, page = null, checkout, checkoutContract = null, cardMaterial,
    billingEmail = null, beforeSubmit = async () => undefined, operationId,
  } = {}) {
    if (!this.enabled) throw new BrowserPaymentExecutorError('Browser payment executor is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    const op = required(operationId, 'operationId');
    if (!control || typeof control.assertLeaseBeforeAction !== 'function') throw new TypeError('control is required');
    await control.assertLeaseBeforeAction('PAYMENT_PERMIT');
    const permit = await this.integration.issueAuthoritativePaymentPermit({ control, run });
    let intent = null;
    const authorizeSubmit = async () => {
      if (intent) return intent;
      await control.assertLeaseBeforeAction('PAYMENT_SUBMIT_INTENT');
      intent = await this.executionRepository.commitPaymentSubmissionIntent({
        runId: required(run?.runId, 'run.runId'),
        workerId: required(this.integration.workerId, 'workerId'),
        leaseToken: required(run?.leaseToken, 'run.leaseToken'),
        permitNonce: required(permit.permitNonce, 'permit.permitNonce'),
        operationId: op,
      });
      return intent;
    };

    let submission;
    try {
      await control.assertLeaseBeforeAction('PAYMENT_SUBMIT');
      submission = await this.paymentAdapter.submit({
        page, operationId: op, checkout, checkoutContract, cardMaterial,
        billingEmail, permit, beforeSubmit, authorizeSubmit,
        assertContinue: () => control.assertLeaseBeforeAction('PAYMENT_PAGE_ACTION'),
      });
      if (submission?.status === 'RECONCILE_ONLY') {
        return { status: 'RECONCILE_ONLY', idempotentReplay: true, paymentSubmitCalls: 0 };
      }
      await control.assertLeaseBeforeAction('PAYMENT_RESULT');
    } catch (error) {
      // Failures proven to occur before the submit click must not poison the
      // payment attempt as UNKNOWN; they are safe to correct/retry by the
      // caller. Only post-click failures consume the one-shot uncertainty path.
      if (['CHECKOUT_DRIFT', 'CARD_MATERIAL_INVALID', 'CHECKOUT_ADAPTER_MISMATCH', 'INVALID_ARGUMENT'].includes(error?.code)) {
        if (intent?.executeExternal) {
          await this.executionRepository.markPaymentUnknown({
            runId: run.runId, operationId: `${op}:unknown`, reasonCode: 'PAYMENT_RESULT_UNKNOWN',
            verificationDeadline: new Date(Date.now() + this.verificationWindowMs),
            verificationNextCheckAt: new Date(Date.now() + this.verificationIntervalMs),
          });
          return { status: 'UNKNOWN', reasonCode: 'PAYMENT_RESULT_UNKNOWN', paymentSubmitCalls: 0 };
        }
        return { status: 'PRE_SUBMIT_FAILED', reasonCode: error.code, paymentSubmitCalls: 0 };
      }
      // No intent means the adapter proved it never crossed the external
      // submit boundary, so this remains a safe pre-submit failure.
      if (!intent) {
        return { status: 'PRE_SUBMIT_FAILED', reasonCode: error?.code || 'PRE_SUBMIT_FAILED', paymentSubmitCalls: 0 };
      }
      await this.executionRepository.markPaymentUnknown({
        runId: run.runId, operationId: `${op}:unknown`, reasonCode: 'PAYMENT_RESULT_UNKNOWN',
        verificationDeadline: new Date(Date.now() + this.verificationWindowMs),
        verificationNextCheckAt: new Date(Date.now() + this.verificationIntervalMs),
      });
      return { status: 'UNKNOWN', reasonCode: 'PAYMENT_RESULT_UNKNOWN', paymentSubmitCalls: 1 };
    }
    if (submission?.status !== 'CONFIRMED') {
      await this.executionRepository.markPaymentUnknown({
        runId: run.runId, operationId: `${op}:unknown`, reasonCode: `PAYMENT_${submission?.status || 'UNKNOWN'}`,
        verificationDeadline: new Date(Date.now() + this.verificationWindowMs),
        verificationNextCheckAt: new Date(Date.now() + this.verificationIntervalMs),
      });
      return { status: 'UNKNOWN', reasonCode: `PAYMENT_${submission?.status || 'UNKNOWN'}`, paymentSubmitCalls: 1 };
    }

    const paymentEvidenceHash = digest({ operationId: op, providerCallRef: submission.providerCallRef, status: submission.status });
    await this.executionRepository.markPaymentConfirmed({
      runId: run.runId, operationId: `${op}:confirmed`, evidenceHash: paymentEvidenceHash,
    });
    try {
      const plus = await this.postPaymentVerifier.confirmPlus();
      if (!plus?.confirmed) return { status: 'POST_PAYMENT_UNKNOWN', reasonCode: 'PLUS_ACTIVATION_UNCONFIRMED', paymentSubmitCalls: 1 };
      await this.executionRepository.recordPlusActivation({
        runId: run.runId, operationId: `${op}:plus`, evidenceHash: digest(plus.evidence),
      });
      const cancellation = await this.postPaymentVerifier.confirmCancellation();
      const transactions = await this.postPaymentVerifier.readCardTransactions();
      const reconciliation = await this.postPaymentVerifier.reconcile({ transactions });
      if (!cancellation?.confirmed || !reconciliation?.matched) {
        return { status: 'POST_PAYMENT_UNKNOWN', reasonCode: 'POST_PAYMENT_RECONCILIATION_REQUIRED', paymentSubmitCalls: 1 };
      }
      await this.executionRepository.recordCancellationConfirmed({
        runId: run.runId, operationId: `${op}:cancellation`, evidenceHash: digest({ cancellation: cancellation.evidence, transactions }),
      });
      return { status: 'COMPLETED', paymentSubmitCalls: 1, cardTransactionCount: transactions.length };
    } catch (error) {
      // Payment is already confirmed; a verifier/recording failure must never
      // bubble into a retryable submit path. Leave the run for reconciliation.
      return {
        status: 'POST_PAYMENT_UNKNOWN',
        reasonCode: 'POST_PAYMENT_RECONCILIATION_REQUIRED',
        paymentSubmitCalls: 1,
      };
    }
  }
}
