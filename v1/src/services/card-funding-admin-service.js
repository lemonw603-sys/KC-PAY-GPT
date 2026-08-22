import { PublicApiError } from '../domain/public-api-error.js';
import { redactSensitiveFields } from '../security/redaction.js';

const STATUSES = new Set(['PREPARED', 'SUBMITTING', 'PENDING', 'SETTLED', 'FAILED', 'MANUAL_REVIEW']);

function parseQuery(input = {}) {
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  const status = String(input.status || '').trim().toUpperCase();
  if (!Number.isInteger(page) || page < 1 || page > 100_000
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new PublicApiError('Invalid card funding pagination', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  if (status && !STATUSES.has(status)) {
    throw new PublicApiError('Invalid card funding status', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  return { page, pageSize, status };
}

function parseSummary(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? redactSensitiveFields(parsed) : null;
  } catch {
    return null;
  }
}

export function createCardFundingAdminService({ pool }) {
  async function list(input = {}) {
    const { page, pageSize, status } = parseQuery(input);
    const where = status ? 'WHERE fa.status = ?' : '';
    const params = status ? [status] : [];
    const [[countRow], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM card_funding_attempts fa ${where}`, params),
      pool.query(`SELECT fa.id, fa.card_id, fa.order_id, fa.amount, fa.currency,
          fa.status, fa.funds_risk_state, fa.external_reference,
          fa.submit_intent_at, fa.submitted_at, fa.last_reconciled_at,
          fa.finished_at, fa.created_at, fa.updated_at,
          c.provider_card_id, c.last4, o.public_no,
          pc.provider, pc.outcome AS provider_call_outcome,
          pc.http_status AS provider_http_status, pc.business_code AS provider_business_code,
          pc.finished_at AS provider_finished_at, fa.result_summary_json
        FROM card_funding_attempts fa
        INNER JOIN cards c ON c.id = fa.card_id
        LEFT JOIN orders o ON o.id = fa.order_id
        LEFT JOIN provider_calls pc ON pc.id = (
          SELECT MAX(pci.id) FROM provider_calls pci
          WHERE pci.card_funding_attempt_id = fa.id
        )
        ${where}
        ORDER BY fa.created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
    ]);
    return {
      page,
      pageSize,
      total: Number(countRow[0]?.total || 0),
      attempts: rows.map((row) => ({
        id: row.id,
        cardId: row.card_id,
        providerCardId: row.provider_card_id,
        last4: row.last4 || null,
        publicNo: row.public_no || null,
        amount: String(row.amount),
        currency: row.currency,
        status: row.status,
        fundsRiskState: row.funds_risk_state,
        externalReference: row.external_reference || null,
        provider: row.provider || null,
        providerCallOutcome: row.provider_call_outcome || null,
        providerHttpStatus: row.provider_http_status == null ? null : Number(row.provider_http_status),
        providerBusinessCode: row.provider_business_code || null,
        providerFinishedAt: row.provider_finished_at?.toISOString?.() || row.provider_finished_at || null,
        resultSummary: parseSummary(row.result_summary_json),
        submitIntentAt: row.submit_intent_at?.toISOString?.() || row.submit_intent_at || null,
        submittedAt: row.submitted_at?.toISOString?.() || row.submitted_at || null,
        lastReconciledAt: row.last_reconciled_at?.toISOString?.() || row.last_reconciled_at || null,
        finishedAt: row.finished_at?.toISOString?.() || row.finished_at || null,
        createdAt: row.created_at?.toISOString?.() || row.created_at || null,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null
      }))
    };
  }

  return { list };
}
