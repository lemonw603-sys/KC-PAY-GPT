import { ChatGptPostPaymentVerifier } from './chatgpt-post-payment-verifier.js';
import { browserRunMaterialRef } from './shared-encrypted-materials.js';

/**
 * Read-only recovery for a payment whose durable state is UNKNOWN or whose
 * payment is confirmed but Plus/cancellation closure is incomplete. It never
 * receives a payment adapter and therefore cannot click the submit control.
 */
export class LivePostPaymentRecoveryVerifier {
  constructor({
    runtimeAdapter,
    manifest,
    sessionProvider,
    resolveSessionIdentity,
    transactionReaderFactory,
    navigationTimeoutMs = 60_000,
    verificationWindowMs = 300_000,
    verificationIntervalMs = 5_000,
    postPlusAction = 'CANCEL_RENEWAL',
    verifierFactory = (input) => new ChatGptPostPaymentVerifier(input),
  } = {}) {
    if (!runtimeAdapter?.open || !runtimeAdapter?.close) throw new TypeError('runtimeAdapter is required');
    if (!manifest || manifest.allowWrites !== false) throw new TypeError('read-only manifest is required');
    if (!sessionProvider?.open || !sessionProvider?.bootstrap || !sessionProvider?.close) throw new TypeError('sessionProvider is required');
    if (typeof resolveSessionIdentity !== 'function') throw new TypeError('resolveSessionIdentity is required');
    if (typeof transactionReaderFactory !== 'function') throw new TypeError('transactionReaderFactory is required');
    if (typeof verifierFactory !== 'function') throw new TypeError('verifierFactory is required');
    if (!['CANCEL_RENEWAL', 'MANUAL_20X_HANDOFF'].includes(postPlusAction)) {
      throw new TypeError('postPlusAction must be CANCEL_RENEWAL or MANUAL_20X_HANDOFF');
    }
    if (postPlusAction === 'MANUAL_20X_HANDOFF' && typeof runtimeAdapter.detach !== 'function') {
      throw new TypeError('runtimeAdapter.detach is required for MANUAL_20X_HANDOFF');
    }
    this.runtimeAdapter = runtimeAdapter;
    this.manifest = manifest;
    this.sessionProvider = sessionProvider;
    this.resolveSessionIdentity = resolveSessionIdentity;
    this.transactionReaderFactory = transactionReaderFactory;
    this.navigationTimeoutMs = navigationTimeoutMs;
    this.verificationWindowMs = verificationWindowMs;
    this.verificationIntervalMs = verificationIntervalMs;
    this.postPlusAction = postPlusAction;
    this.verifierFactory = verifierFactory;
  }

  async verify(row) {
    let runtime;
    let sessionLease;
    let preserveProfile = false;
    try {
      runtime = await this.runtimeAdapter.open(this.manifest, {
        profileRef: `profile:${row.executorProfileId}`,
      });
      sessionLease = await this.sessionProvider.open(browserRunMaterialRef(row.runId), {
        purpose: 'browser-post-payment-verify', ttlMs: this.navigationTimeoutMs,
      });
      await this.sessionProvider.bootstrap(sessionLease, runtime.context);
      await this.sessionProvider.close(sessionLease);
      sessionLease = null;
      const page = await runtime.context.newPage();
      await page.goto('https://chatgpt.com/', {
        waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs,
      });
      const verifier = this.verifierFactory({
        page,
        expectedIdentity: await this.resolveSessionIdentity(row),
        transactionReader: await this.transactionReaderFactory(row),
        timeoutMs: this.verificationWindowMs,
        pollIntervalMs: this.verificationIntervalMs,
      });
      const plus = await verifier.confirmPlus();
      if (!plus.confirmed) {
        return { outcome: 'UNKNOWN', reasonCode: 'PLUS_ACTIVATION_UNCONFIRMED', evidence: plus.evidence };
      }
      if (this.postPlusAction === 'MANUAL_20X_HANDOFF') {
        const transactions = await verifier.readCardTransactions();
        const reconciliation = await verifier.reconcile({ transactions });
        preserveProfile = true;
        return {
          outcome: 'CONFIRMED', postPaymentComplete: true,
          manual20xState: reconciliation.matched ? 'HANDOFF' : 'REVIEW_REQUIRED',
          reasonCode: reconciliation.matched ? null : 'MANUAL_20X_RECONCILIATION_REQUIRED',
          evidence: {
            plus: plus.evidence,
            transactionEvidenceKind: reconciliation.evidenceKind || null,
            transactionHash: reconciliation.transactionHash || null,
            transactionCandidateCount: reconciliation.candidateCount ?? null,
          },
        };
      }
      const cancellation = await verifier.confirmCancellation();
      const transactions = await verifier.readCardTransactions();
      const reconciliation = await verifier.reconcile({ transactions });
      if (!cancellation.confirmed || !reconciliation.matched) {
        return {
          outcome: 'UNKNOWN', reasonCode: 'POST_PAYMENT_RECONCILIATION_REQUIRED',
          evidence: {
            plus: plus.evidence,
            cancellation: cancellation.evidence,
            transactionEvidenceKind: reconciliation.evidenceKind || null,
            transactionCandidateCount: reconciliation.candidateCount ?? null,
          },
        };
      }
      return {
        outcome: 'CONFIRMED', postPaymentComplete: true,
        evidence: {
          plus: plus.evidence,
          cancellation: cancellation.evidence,
          transactionEvidenceKind: reconciliation.evidenceKind || null,
          transactionHash: reconciliation.transactionHash || null,
        },
      };
    } finally {
      if (sessionLease) await this.sessionProvider.close(sessionLease).catch(() => undefined);
      if (runtime) {
        if (preserveProfile) await this.runtimeAdapter.detach(runtime).catch(() => undefined);
        else await this.runtimeAdapter.close(runtime).catch(() => undefined);
      }
    }
  }
}
