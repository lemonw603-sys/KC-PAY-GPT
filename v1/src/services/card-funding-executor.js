import { mapCardRechargeResult } from '../providers/hnskj-card.js';

export async function executeCardFundingAttempt({ repository, provider, attemptId,
  providerAccountId, providerName = 'hnskj', requestKey, now = new Date() }) {
  const begun = await repository.begin({ attemptId, provider: providerName,
    providerAccountId, requestKey, startedAt: now });
  let providerAccepted = false;
  try {
    const response = await provider.rechargeCard({
      cardId: begun.cardId,
      amount: Number(begun.amount),
      idempotencyKey: requestKey,
      remark: `card-funding:${attemptId}`
    });
    providerAccepted = true;
    const mapped = mapCardRechargeResult(response);
    const settled = mapped.state === 'SETTLED';
    try {
      await repository.finish({
        attemptId, providerCallId: begun.providerCallId,
        // The HTTP/API call succeeded even when the card operation remains
        // pending; the funding attempt state carries the pending risk.
        outcome: 'SUCCESS',
        responseSummary: { state: mapped.state, externalReference: mapped.externalReference },
        status: settled ? 'SETTLED' : 'PENDING',
        fundsRiskState: settled ? 'SETTLED' : 'ACTIVE',
        externalReference: mapped.externalReference,
        finishedAt: new Date()
      });
    } catch (error) {
      // Once the provider has accepted the request, a local persistence error
      // can never be treated as a definite failure. Lock it as UNKNOWN so no
      // scheduler, order retry or operator action can automatically pay again.
      error.uncertain = true;
      error.kind = error.kind || 'local_commit_after_provider_acceptance';
      throw error;
    }
    return { attemptId, state: mapped.state, externalReference: mapped.externalReference };
  } catch (error) {
    const unknown = providerAccepted || error?.uncertain === true;
    await repository.finish({
      attemptId, providerCallId: begun.providerCallId,
      outcome: unknown ? 'UNCERTAIN' : 'DEFINITE_FAILURE',
      httpStatus: error?.status ?? null,
      businessCode: error?.businessCode ?? null,
      responseSummary: {
        kind: error?.kind || 'provider', code: error?.code || null,
        retryDisposition: unknown ? 'MANUAL_REVIEW'
          : error?.retryable === true ? 'AUTO_RETRY' : 'DO_NOT_RETRY'
      },
      status: unknown ? 'MANUAL_REVIEW' : 'FAILED',
      fundsRiskState: unknown ? 'UNKNOWN' : 'CLEARED',
      finishedAt: new Date()
    });
    return { attemptId, state: unknown ? 'UNKNOWN' : 'FAILED', code: error?.businessCode || error?.code || null };
  }
}
