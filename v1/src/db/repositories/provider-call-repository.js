import { redactSensitiveFields } from '../../security/redaction.js';

const outcomes = new Set([
  'STARTED',
  'SUCCESS',
  'RETRYABLE_FAILURE',
  'DEFINITE_FAILURE',
  'UNCERTAIN',
  'SCHEMA_ERROR'
]);

export async function startProviderCall(pool, {
  orderId = null,
  provider,
  operation,
  requestKey = null,
  attemptNo = 1,
  startedAt = new Date()
}) {
  const [result] = await pool.query(
    `INSERT INTO provider_calls
     (order_id, provider, operation, request_key, attempt_no, outcome, started_at)
     VALUES (?, ?, ?, ?, ?, 'STARTED', ?)`,
    [orderId, provider, operation, requestKey, attemptNo, startedAt]
  );
  return { id: result.insertId, startedAt };
}

export async function finishProviderCall(pool, {
  callId,
  outcome,
  httpStatus = null,
  businessCode = null,
  responseSummary = null,
  durationMs,
  finishedAt = new Date()
}) {
  if (!outcomes.has(outcome) || outcome === 'STARTED') {
    throw new Error(`Invalid provider call outcome: ${outcome}`);
  }
  const safeSummary = responseSummary == null
    ? null
    : JSON.stringify(redactSensitiveFields(responseSummary));
  const [result] = await pool.query(
    `UPDATE provider_calls
     SET outcome = ?, http_status = ?, business_code = ?,
         response_summary_json = ?, duration_ms = ?, finished_at = ?
     WHERE id = ? AND outcome = 'STARTED'`,
    [outcome, httpStatus, businessCode, safeSummary, durationMs, finishedAt, callId]
  );
  if (result.affectedRows !== 1) {
    throw new Error(`Provider call is missing or already finished: ${callId}`);
  }
}
