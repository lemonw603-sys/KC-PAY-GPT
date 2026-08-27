import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { redactSensitiveFields } from '../security/redaction.js';

const STATUSES = new Set(['PREPARED', 'SUBMITTING', 'PENDING', 'SETTLED', 'FAILED', 'MANUAL_REVIEW', 'UNKNOWN']);
const MANUAL_ACTIONS = new Set(['CONFIRM_SETTLED', 'CONFIRM_NOT_CHARGED', 'KEEP_MANUAL_REVIEW']);

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
    const where = status
      ? (status === 'UNKNOWN' ? "WHERE fa.funds_risk_state = 'UNKNOWN'" : 'WHERE fa.status = ?')
      : '';
    const params = status && status !== 'UNKNOWN' ? [status] : [];
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

  async function resolveUnknown({ attemptId, action, actorId, note, confirmation }) {
    const id = String(attemptId || '').trim();
    const normalizedAction = String(action || '').trim().toUpperCase();
    const actor = String(actorId || '').trim();
    const operatorNote = String(note || '').trim();
    if (!id || !MANUAL_ACTIONS.has(normalizedAction) || !actor || operatorNote.length < 10) {
      throw new PublicApiError('Invalid card funding manual resolution', {
        code: 'INVALID_CARD_FUNDING_MANUAL_RESOLUTION', status: 400
      });
    }
    if (String(confirmation || '').trim() !== `确认卡充值对账 ${id}`) {
      throw new PublicApiError('Card funding manual resolution confirmation mismatch', {
        code: 'CARD_FUNDING_MANUAL_CONFIRMATION_REQUIRED', status: 400
      });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT id, status, funds_risk_state FROM card_funding_attempts
         WHERE id = ? LIMIT 1 FOR UPDATE`, [id]
      );
      const attempt = rows[0];
      if (!attempt) throw new PublicApiError('Card funding attempt not found', {
        code: 'CARD_FUNDING_NOT_FOUND', status: 404
      });
      if (attempt.funds_risk_state !== 'UNKNOWN'
        && !(normalizedAction === 'KEEP_MANUAL_REVIEW' && attempt.status === 'MANUAL_REVIEW')) {
        throw new PublicApiError('Card funding attempt is not in UNKNOWN review', {
          code: 'CARD_FUNDING_NOT_UNKNOWN', status: 409
        });
      }
      const next = normalizedAction === 'CONFIRM_SETTLED'
        ? { status: 'SETTLED', risk: 'SETTLED' }
        : normalizedAction === 'CONFIRM_NOT_CHARGED'
          ? { status: 'FAILED', risk: 'NONE' }
          : { status: 'MANUAL_REVIEW', risk: 'UNKNOWN' };
      const actionId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO card_funding_manual_actions
         (id, attempt_id, action, actor_id, operator_note)
         VALUES (?, ?, ?, ?, ?)`, [actionId, id, normalizedAction, actor, operatorNote.slice(0, 2000)]
      );
      await connection.query(
        `UPDATE card_funding_attempts
         SET status = ?, funds_risk_state = ?, finished_at = IF(? IN ('SETTLED','FAILED'), CURRENT_TIMESTAMP(3), finished_at),
             result_summary_json = JSON_SET(COALESCE(result_summary_json, JSON_OBJECT()),
               '$.manualResolution', JSON_OBJECT('action', ?, 'actorId', ?, 'note', ?, 'actionId', ?))
         WHERE id = ?`,
        [next.status, next.risk, next.status, normalizedAction, actor, operatorNote.slice(0, 2000), actionId, id]
      );
      await connection.commit();
      return { attemptId: id, action: normalizedAction, status: next.status, fundsRiskState: next.risk, actionId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { list, resolveUnknown };
}
