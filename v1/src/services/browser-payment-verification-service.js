import { createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Bounded, read-only payment verification coordinator. The verifier supplied
 * by the runtime may only read account/Checkout/provider evidence; this
 * coordinator is the only component allowed to advance the durable state.
 */
export function createBrowserPaymentVerificationService({ repository, verifier,
  clock = () => new Date(), maxBatch = 20, approvedOrderId = null,
  postPlusAction = 'CANCEL_RENEWAL' } = {}) {
  if (!repository || typeof repository.listPaymentVerificationsDue !== 'function'
    || typeof repository.recordPaymentVerificationObservation !== 'function'
    || typeof repository.markPaymentConfirmed !== 'function'
    || typeof repository.recordPlusActivation !== 'function'
    || typeof repository.recordCancellationConfirmed !== 'function'
    || typeof repository.markPaymentDeclinedAfterVerification !== 'function'
    || typeof repository.escalatePaymentVerification !== 'function') {
    throw new TypeError('repository does not implement payment verification contract');
  }
  if (!verifier || typeof verifier.verify !== 'function') throw new TypeError('verifier is required');
  if (!['CANCEL_RENEWAL', 'MANUAL_20X_HANDOFF'].includes(postPlusAction)) {
    throw new TypeError('postPlusAction must be CANCEL_RENEWAL or MANUAL_20X_HANDOFF');
  }
  if (postPlusAction === 'MANUAL_20X_HANDOFF'
    && (typeof repository.recordManual20xHandoff !== 'function'
      || typeof repository.recordManual20xReviewRequired !== 'function')) {
    throw new TypeError('manual 20X repository methods are required for MANUAL_20X_HANDOFF');
  }
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > 100) throw new TypeError('maxBatch must be 1..100');

  return {
    async runOnce() {
      const now = clock();
      const rows = await repository.listPaymentVerificationsDue({
        now, limit: maxBatch, orderId: approvedOrderId,
      });
      const results = [];
      for (const row of rows) {
        const operationId = `payment-verification:${row.runId}:${row.verificationCheckCount || 0}`;
        let observation;
        try {
          observation = await verifier.verify(row);
        } catch (error) {
          observation = { outcome: 'UNKNOWN', reasonCode: 'VERIFICATION_READ_FAILED',
            evidence: { errorCode: error?.code || 'READ_FAILED' } };
        }
        const outcome = String(observation?.outcome || 'UNKNOWN').toUpperCase();
        const evidenceHash = digest({ runId: row.runId, outcome,
          evidence: observation?.evidence || null });
        if (outcome === 'CONFIRMED') {
          if (row.paymentState === 'PAYMENT_UNKNOWN') {
            await repository.markPaymentConfirmed({
              runId: row.runId, operationId: `${operationId}:confirmed`, evidenceHash, now,
            });
          }
          if (observation.postPaymentComplete === true) {
            await repository.recordPlusActivation({
              runId: row.runId, operationId: `${operationId}:plus`,
              evidenceHash: digest(observation.evidence?.plus || observation.evidence), now,
            });
            if (postPlusAction === 'MANUAL_20X_HANDOFF') {
              const method = observation.manual20xState === 'HANDOFF'
                ? 'recordManual20xHandoff'
                : observation.manual20xState === 'REVIEW_REQUIRED'
                  ? 'recordManual20xReviewRequired' : null;
              if (!method) throw new TypeError('manual 20X verification result is incomplete');
              await repository[method]({
                runId: row.runId,
                operationId: `${operationId}:${observation.manual20xState.toLowerCase()}`,
                evidenceHash: digest({
                  transactionHash: observation.evidence?.transactionHash || null,
                  transactionEvidenceKind: observation.evidence?.transactionEvidenceKind || null,
                  transactionCandidateCount: observation.evidence?.transactionCandidateCount ?? null,
                }),
                now,
              });
            } else {
              await repository.recordCancellationConfirmed({
                runId: row.runId, operationId: `${operationId}:cancellation`,
                evidenceHash: digest({
                  cancellation: observation.evidence?.cancellation || null,
                  transactionHash: observation.evidence?.transactionHash || null,
                  transactionEvidenceKind: observation.evidence?.transactionEvidenceKind || null,
                }), now,
              });
            }
          }
        } else if (outcome === 'DECLINED' && row.paymentState === 'PAYMENT_UNKNOWN') {
          await repository.markPaymentDeclinedAfterVerification({
            runId: row.runId, operationId: `${operationId}:declined`,
            reasonCode: observation.reasonCode || 'PAYMENT_DECLINED_VERIFIED', evidenceHash, now,
          });
        } else if (outcome === 'CONFLICT' || outcome === 'DECLINED' || (row.verificationDeadlineAt
          && new Date(row.verificationDeadlineAt).getTime() <= now.getTime())) {
          await repository.escalatePaymentVerification({
            runId: row.runId, operationId: `${operationId}:escalated`,
            reasonCode: observation.reasonCode || 'PAYMENT_VERIFICATION_TIMEOUT', evidenceHash, now,
          });
        } else {
          await repository.recordPaymentVerificationObservation({
            runId: row.runId, operationId, outcome: 'UNKNOWN', evidenceHash,
            nextCheckAt: observation.nextCheckAt || null, now,
          });
        }
        results.push({ runId: row.runId, outcome });
      }
      return { status: rows.length ? 'PROCESSED' : 'IDLE', count: rows.length, results };
    }
  };
}
