import {
  finishProviderCall,
  startProviderCall
} from '../db/repositories/provider-call-repository.js';
import { redactSensitiveFields } from '../security/redaction.js';
import { ProviderError, ProviderSchemaError } from './http-client.js';

function outcomeForError(error) {
  if (error instanceof ProviderSchemaError) return error.uncertain ? 'UNCERTAIN' : 'SCHEMA_ERROR';
  if (error instanceof ProviderError) {
    if (error.uncertain) return 'UNCERTAIN';
    if (error.retryable) return 'RETRYABLE_FAILURE';
  }
  return 'DEFINITE_FAILURE';
}

function errorSummary(error) {
  return redactSensitiveFields({
    name: error?.name || 'Error',
    kind: error?.kind || null,
    message: error?.message || 'unknown error',
    retryable: Boolean(error?.retryable),
    uncertain: Boolean(error?.uncertain)
  });
}

export async function recordProviderCall({
  pool,
  orderId = null,
  provider,
  operation,
  requestKey = null,
  attemptNo = 1,
  sideEffecting = false,
  action,
  summarize = () => ({ ok: true })
}) {
  const started = Date.now();
  const call = await startProviderCall(pool, {
    orderId,
    provider,
    operation,
    requestKey,
    attemptNo,
    startedAt: new Date(started)
  });

  try {
    const result = await action();
    try {
      await finishProviderCall(pool, {
        callId: call.id,
        outcome: 'SUCCESS',
        responseSummary: summarize(result),
        durationMs: Date.now() - started
      });
    } catch (auditError) {
      throw new ProviderError('Provider result could not be persisted', {
        provider,
        kind: 'audit',
        retryable: !sideEffecting,
        uncertain: sideEffecting,
        cause: auditError
      });
    }
    return result;
  } catch (error) {
    try {
      await finishProviderCall(pool, {
        callId: call.id,
        outcome: outcomeForError(error),
        httpStatus: error?.status ?? null,
        businessCode: error?.businessCode ?? null,
        responseSummary: errorSummary(error),
        durationMs: Date.now() - started
      });
    } catch (auditError) {
      if (Object.isExtensible(error)) error.auditFailure = auditError;
    }
    throw error;
  }
}
