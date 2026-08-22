import { randomUUID } from 'node:crypto';
import { redactSensitiveFields } from '../security/redaction.js';

const RUN_STATUSES = new Set([
  'READY', 'RUNNING', 'RECONCILE_ONLY', 'HUMAN_REQUIRED', 'COMPLETED', 'FAILED_SAFE'
]);
const PAYMENT_STATES = new Set([
  'NOT_STARTED', 'PAYMENT_ARMED', 'PAYMENT_SUBMITTING', 'PAYMENT_UNKNOWN',
  'PAYMENT_DECLINED', 'PAYMENT_CONFIRMED'
]);
const CONTROL_STATES = new Set(['AUTOMATION', 'REQUESTED', 'FROZEN', 'TRANSFERRED', 'RELEASED']);
const CONTROL_ACTIONS = new Set([
  'REQUEST', 'FREEZE', 'TRANSFER', 'RELEASE_SAFE', 'MARK_PAYMENT_UNKNOWN', 'CANCEL'
]);
const INTERVENTION_REASONS = new Set([
  'CAPTCHA', 'THREE_DS', 'PAGE_DRIFT', 'SESSION_REPAIR', 'OPERATOR_REVIEW',
  'PAYMENT_RECONCILIATION'
]);
const SAFE_PAYMENT_STATES = new Set(['NOT_STARTED', 'PAYMENT_ARMED']);
const MAX_PAGE_SIZE = 100;

export class BrowserAdminError extends Error {
  constructor(message, code, status = 400, details = undefined) {
    super(message);
    this.name = 'BrowserAdminError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function required(value, name, maxLength = 191) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BrowserAdminError(`${name} is required`, 'INVALID_ARGUMENT');
  if (normalized.length > maxLength) {
    throw new BrowserAdminError(`${name} is too long`, 'INVALID_ARGUMENT');
  }
  return normalized;
}

function optionalEnum(value, allowed, code) {
  if (value == null || String(value).trim() === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.has(normalized)) throw new BrowserAdminError(`invalid ${code}`, code);
  return normalized;
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return redactSensitiveFields(value);
  try { return redactSensitiveFields(JSON.parse(value)); } catch { return null; }
}

function json(value) {
  return JSON.stringify(redactSensitiveFields(value));
}

function publicRun(row) {
  return {
    id: row.run_id ?? row.id,
    publicNo: row.public_no,
    rechargeAttemptId: row.recharge_attempt_id,
    profile: {
      code: row.profile_code,
      version: Number(row.profile_version),
      runtimeId: row.runtime_id,
      adapterVersion: row.adapter_version
    },
    runNo: Number(row.run_no),
    status: row.run_status ?? row.status,
    paymentState: row.payment_state,
    controlState: row.control_state,
    worker: row.worker_id ? {
      id: row.worker_id,
      leaseUntil: iso(row.worker_lease_until)
    } : null,
    automationOwnerId: row.automation_owner_id,
    humanOwnerId: row.human_owner_id,
    selectedLane: row.selected_lane,
    lastCheckpointSequence: Number(row.last_checkpoint_sequence || 0),
    lastCheckpointKind: row.last_checkpoint_kind,
    lastErrorCode: row.last_error_code,
    attemptStatus: row.attempt_status,
    fundsRiskState: row.funds_risk_state,
    orderStatus: row.order_status,
    activeArtifact: row.artifact_id ? {
      id: row.artifact_id,
      kind: row.artifact_kind,
      status: row.artifact_status,
      expiresAt: iso(row.artifact_expires_at)
    } : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    finishedAt: iso(row.finished_at)
  };
}

function normalizeListInput(input = {}) {
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    throw new BrowserAdminError('invalid page', 'INVALID_PAGE');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new BrowserAdminError('invalid page size', 'INVALID_PAGE_SIZE');
  }
  return {
    page,
    pageSize,
    status: optionalEnum(input.status, RUN_STATUSES, 'INVALID_RUN_STATUS'),
    paymentState: optionalEnum(input.paymentState, PAYMENT_STATES, 'INVALID_PAYMENT_STATE'),
    controlState: optionalEnum(input.controlState, CONTROL_STATES, 'INVALID_CONTROL_STATE'),
    publicNo: input.publicNo == null || input.publicNo === ''
      ? null : required(input.publicNo, 'publicNo', 64)
  };
}

async function inTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockRun(connection, runId) {
  const [rows] = await connection.query(
    `SELECT br.*, br.status AS run_status,
            rat.order_id, rat.status AS attempt_status, rat.funds_risk_state,
            o.public_no, o.status AS order_status, o.version AS order_version,
            ep.profile_code, ep.profile_version, ep.runtime_id, ep.adapter_version
     FROM browser_runs br
     INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
     INNER JOIN orders o ON o.id = rat.order_id
     INNER JOIN executor_profiles ep ON ep.id = br.executor_profile_id
     WHERE br.id = ?
     LIMIT 1 FOR UPDATE`,
    [runId]
  );
  if (!rows.length) throw new BrowserAdminError('Browser run not found', 'RUN_NOT_FOUND', 404);
  return rows[0];
}

async function activeIntervention(connection, runId) {
  const [rows] = await connection.query(
    `SELECT * FROM browser_interventions
     WHERE browser_run_id = ? AND status IN ('REQUESTED', 'FROZEN', 'TRANSFERRED')
     LIMIT 1 FOR UPDATE`,
    [runId]
  );
  return rows[0] || null;
}

async function paymentSubmitExists(connection, runId) {
  const [rows] = await connection.query(
    `SELECT id FROM browser_operations
     WHERE browser_run_id = ? AND operation_type = 'PAYMENT_SUBMIT'
       AND status IN ('COMMITTED', 'OUTCOME_UNKNOWN')
     LIMIT 1 FOR UPDATE`,
    [runId]
  );
  return rows.length > 0;
}

async function appendControlCheckpoint(connection, row, {
  action, operationId, actorId, reasonCode, now
}) {
  const sequence = Number(row.last_checkpoint_sequence || 0) + 1;
  const result = {
    runId: row.id,
    action,
    operationId,
    controlState: row.control_state,
    runStatus: row.run_status,
    paymentState: row.payment_state,
    reasonCode: reasonCode || null
  };
  await connection.query(
    `INSERT INTO browser_checkpoints
     (browser_run_id, sequence_no, checkpoint_kind, payment_risk,
      operation_id, evidence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, sequence, `CONTROL_${action}`,
      row.payment_state === 'PAYMENT_UNKNOWN' ? 'UNKNOWN'
        : row.payment_state === 'PAYMENT_SUBMITTING' ? 'SUBMITTING'
          : row.payment_state === 'PAYMENT_ARMED' ? 'ARMED' : 'NONE',
      operationId, json({ action, actorId, reasonCode }), now]
  );
  await connection.query(
    `INSERT INTO browser_operations
     (browser_run_id, operation_id, operation_type, status, result_code,
      public_result_json, prepared_at, completed_at)
     VALUES (?, ?, 'MANUAL_CONTROL', 'COMMITTED', ?, ?, ?, ?)`,
    [row.id, operationId, action, json(result), now, now]
  );
  await connection.query(
    `UPDATE browser_runs
     SET last_checkpoint_sequence = ?, last_checkpoint_kind = ?, updated_at = ?
     WHERE id = ?`,
    [sequence, `CONTROL_${action}`, now, row.id]
  );
  return { sequence, result };
}

export function createBrowserAdminService({
  pool,
  idFactory = randomUUID,
  now = () => new Date()
} = {}) {
  if (!pool?.query || !pool?.getConnection) {
    throw new Error('Browser admin service requires a MySQL pool');
  }

  async function listRuns(input = {}) {
    const { page, pageSize, status, paymentState, controlState, publicNo } = normalizeListInput(input);
    const conditions = [];
    const values = [];
    if (status) { conditions.push('br.status = ?'); values.push(status); }
    if (paymentState) { conditions.push('br.payment_state = ?'); values.push(paymentState); }
    if (controlState) { conditions.push('br.control_state = ?'); values.push(controlState); }
    if (publicNo) { conditions.push('BINARY o.public_no = ?'); values.push(publicNo); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;
    const [rows] = await pool.query(
      `SELECT br.id AS run_id, br.recharge_attempt_id, br.run_no,
              br.status AS run_status, br.payment_state, br.control_state,
              br.worker_id, br.worker_lease_until, br.automation_owner_id,
              br.human_owner_id, br.selected_lane, br.last_checkpoint_sequence,
              br.last_checkpoint_kind, br.last_error_code,
              br.created_at, br.updated_at, br.finished_at,
              rat.status AS attempt_status, rat.funds_risk_state,
              o.public_no, o.status AS order_status,
              ep.profile_code, ep.profile_version, ep.runtime_id, ep.adapter_version,
              ca.id AS artifact_id, ca.artifact_kind, ca.status AS artifact_status,
              ca.expires_at AS artifact_expires_at
       FROM browser_runs br
       INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
       INNER JOIN orders o ON o.id = rat.order_id
       INNER JOIN executor_profiles ep ON ep.id = br.executor_profile_id
       LEFT JOIN checkout_artifacts ca ON ca.browser_run_id = br.id
         AND ca.status IN ('ACTIVE', 'REVIEW_REQUIRED')
       ${where}
       ORDER BY FIELD(br.status, 'RECONCILE_ONLY', 'HUMAN_REQUIRED', 'RUNNING', 'READY',
                      'FAILED_SAFE', 'COMPLETED'), br.updated_at DESC, br.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM browser_runs br
       INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
       INNER JOIN orders o ON o.id = rat.order_id
       ${where}`,
      values
    );
    const total = Number(countRows[0]?.total || 0);
    return {
      page, pageSize, total, hasMore: offset + rows.length < total,
      runs: rows.map(publicRun)
    };
  }

  async function getRun(runId) {
    const run = required(runId, 'runId', 64);
    const [rows] = await pool.query(
      `SELECT br.id AS run_id, br.recharge_attempt_id, br.run_no,
              br.status AS run_status, br.payment_state, br.control_state,
              br.worker_id, br.worker_lease_until, br.automation_owner_id,
              br.human_owner_id, br.selected_lane, br.last_checkpoint_sequence,
              br.last_checkpoint_kind, br.last_error_code,
              br.created_at, br.updated_at, br.finished_at,
              rat.status AS attempt_status, rat.funds_risk_state,
              o.public_no, o.status AS order_status,
              ep.profile_code, ep.profile_version, ep.runtime_id, ep.adapter_version,
              ca.id AS artifact_id, ca.artifact_kind, ca.status AS artifact_status,
              ca.expires_at AS artifact_expires_at
       FROM browser_runs br
       INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
       INNER JOIN orders o ON o.id = rat.order_id
       INNER JOIN executor_profiles ep ON ep.id = br.executor_profile_id
       LEFT JOIN checkout_artifacts ca ON ca.browser_run_id = br.id
         AND ca.status IN ('ACTIVE', 'REVIEW_REQUIRED')
       WHERE br.id = ? LIMIT 1`,
      [run]
    );
    if (!rows.length) throw new BrowserAdminError('Browser run not found', 'RUN_NOT_FOUND', 404);
    const [checkpoints] = await pool.query(
      `SELECT sequence_no, checkpoint_kind, payment_risk, operation_id,
              page_signature_hash, evidence_json, created_at
       FROM browser_checkpoints WHERE browser_run_id = ?
       ORDER BY sequence_no DESC LIMIT 100`, [run]
    );
    const [operations] = await pool.query(
      `SELECT operation_id, operation_type, status, result_code,
              public_result_json, prepared_at, completed_at
       FROM browser_operations WHERE browser_run_id = ?
       ORDER BY prepared_at DESC, id DESC LIMIT 100`, [run]
    );
    const [permits] = await pool.query(
      `SELECT id, status, issued_to, expires_at, issued_at, consumed_at, revoked_at
       FROM payment_permits WHERE browser_run_id = ? ORDER BY issued_at DESC`, [run]
    );
    const [artifacts] = await pool.query(
      `SELECT id, artifact_kind, status, created_at, opened_at,
              expires_at, invalidated_at, destroyed_at
       FROM checkout_artifacts WHERE browser_run_id = ? ORDER BY created_at DESC`, [run]
    );
    const [leases] = await pool.query(
      `SELECT id, resource_type, owner_id, lease_until, acquired_at,
              heartbeat_at, released_at, release_reason
       FROM execution_resource_leases WHERE browser_run_id = ?
       ORDER BY acquired_at DESC`, [run]
    );
    const [interventions] = await pool.query(
      `SELECT id, status, requested_by, automation_owner_id, human_owner_id,
              reason_code, result_code, requested_at, transferred_at, finished_at
       FROM browser_interventions WHERE browser_run_id = ?
       ORDER BY requested_at DESC`, [run]
    );
    const [cases] = await pool.query(
      `SELECT id, case_type, status, severity, assigned_to,
              detected_at, last_seen_at, resolved_at
       FROM reconciliation_cases WHERE recharge_attempt_id = ?
       ORDER BY detected_at DESC`, [rows[0].recharge_attempt_id]
    );
    return {
      run: publicRun(rows[0]),
      checkpoints: checkpoints.map((item) => ({
        sequence: Number(item.sequence_no), kind: item.checkpoint_kind,
        paymentRisk: item.payment_risk, operationId: item.operation_id,
        pageSignatureHash: item.page_signature_hash, evidence: parseJson(item.evidence_json),
        createdAt: iso(item.created_at)
      })),
      operations: operations.map((item) => ({
        operationId: item.operation_id, type: item.operation_type, status: item.status,
        resultCode: item.result_code, result: parseJson(item.public_result_json),
        preparedAt: iso(item.prepared_at), completedAt: iso(item.completed_at)
      })),
      permits: permits.map((item) => ({
        id: item.id, status: item.status, issuedTo: item.issued_to,
        expiresAt: iso(item.expires_at), issuedAt: iso(item.issued_at),
        consumedAt: iso(item.consumed_at), revokedAt: iso(item.revoked_at)
      })),
      artifacts: artifacts.map((item) => ({
        id: item.id, kind: item.artifact_kind, status: item.status,
        createdAt: iso(item.created_at), openedAt: iso(item.opened_at),
        expiresAt: iso(item.expires_at), invalidatedAt: iso(item.invalidated_at),
        destroyedAt: iso(item.destroyed_at)
      })),
      leases: leases.map((item) => ({
        id: item.id, resourceType: item.resource_type, ownerId: item.owner_id,
        leaseUntil: iso(item.lease_until), acquiredAt: iso(item.acquired_at),
        heartbeatAt: iso(item.heartbeat_at), releasedAt: iso(item.released_at),
        releaseReason: item.release_reason
      })),
      interventions: interventions.map((item) => ({
        id: item.id, status: item.status, requestedBy: item.requested_by,
        automationOwnerId: item.automation_owner_id, humanOwnerId: item.human_owner_id,
        reasonCode: item.reason_code, resultCode: item.result_code,
        requestedAt: iso(item.requested_at), transferredAt: iso(item.transferred_at),
        finishedAt: iso(item.finished_at)
      })),
      reconciliationCases: cases.map((item) => ({
        id: item.id, caseType: item.case_type, status: item.status,
        severity: item.severity, assignedTo: item.assigned_to,
        detectedAt: iso(item.detected_at), lastSeenAt: iso(item.last_seen_at),
        resolvedAt: iso(item.resolved_at)
      }))
    };
  }

  async function controlRun(runId, input = {}) {
    const run = required(runId, 'runId', 64);
    const operationId = required(input.operationId, 'operationId', 191);
    const actorId = required(input.actorId || 'admin', 'actorId', 128);
    const action = optionalEnum(input.action, CONTROL_ACTIONS, 'INVALID_CONTROL_ACTION');
    if (!action) throw new BrowserAdminError('action is required', 'INVALID_CONTROL_ACTION');
    const expectedConfirmation = {
      REQUEST: `请求人工接管 ${run}`,
      FREEZE: `冻结自动化 ${run}`,
      TRANSFER: `转交人工 ${run}`,
      RELEASE_SAFE: `确认无付款动作并恢复 ${run}`,
      MARK_PAYMENT_UNKNOWN: `确认付款结果未知 ${run}`,
      CANCEL: `取消接管 ${run}`
    }[action];
    if (String(input.confirmation || '') !== expectedConfirmation) {
      throw new BrowserAdminError('control confirmation mismatch', 'CONTROL_CONFIRMATION_REQUIRED');
    }
    const reasonCode = input.reasonCode == null ? null
      : optionalEnum(input.reasonCode, INTERVENTION_REASONS, 'INVALID_INTERVENTION_REASON');
    if (action === 'REQUEST' && !reasonCode) {
      throw new BrowserAdminError('reasonCode is required', 'INVALID_INTERVENTION_REASON');
    }
    const humanOwnerId = action === 'TRANSFER'
      ? required(input.humanOwnerId, 'humanOwnerId', 128) : null;
    const timestamp = input.now || now();

    return inTransaction(pool, async (connection) => {
      const row = await lockRun(connection, run);
      const [priorOperations] = await connection.query(
        `SELECT operation_type, public_result_json FROM browser_operations
         WHERE browser_run_id = ? AND operation_id = ? LIMIT 1 FOR UPDATE`,
        [run, operationId]
      );
      if (priorOperations.length) {
        if (priorOperations[0].operation_type !== 'MANUAL_CONTROL') {
          throw new BrowserAdminError('operation ID has another type', 'OPERATION_CONFLICT', 409);
        }
        const priorResult = parseJson(priorOperations[0].public_result_json);
        if (priorResult?.action !== action) {
          throw new BrowserAdminError('operation ID belongs to another control action', 'OPERATION_CONFLICT', 409);
        }
        return { ...priorResult, idempotentReplay: true };
      }
      const intervention = await activeIntervention(connection, run);
      let interventionId = intervention?.id || null;

      if (action === 'REQUEST') {
        if (row.control_state !== 'AUTOMATION' || intervention) {
          throw new BrowserAdminError('run is not available for intervention request', 'CONTROL_STATE_CONFLICT', 409);
        }
        if (!['READY', 'RUNNING', 'HUMAN_REQUIRED'].includes(row.run_status)) {
          throw new BrowserAdminError('run is not active', 'RUN_NOT_ACTIVE', 409);
        }
        interventionId = idFactory();
        await connection.query(
          `INSERT INTO browser_interventions
           (id, browser_run_id, status, requested_by, automation_owner_id,
            reason_code, requested_at)
           VALUES (?, ?, 'REQUESTED', ?, ?, ?, ?)`,
          [interventionId, run, actorId, row.automation_owner_id || row.worker_id,
            reasonCode, timestamp]
        );
        await connection.query(
          `UPDATE browser_runs SET control_state = 'REQUESTED', requested_by = ?, updated_at = ?
           WHERE id = ? AND control_state = 'AUTOMATION'`, [actorId, timestamp, run]
        );
        row.control_state = 'REQUESTED';
      } else if (action === 'FREEZE') {
        if (row.control_state !== 'REQUESTED' || intervention?.status !== 'REQUESTED') {
          throw new BrowserAdminError('intervention is not requested', 'CONTROL_STATE_CONFLICT', 409);
        }
        await connection.query(
          `UPDATE browser_interventions SET status = 'FROZEN'
           WHERE id = ? AND status = 'REQUESTED'`, [intervention.id]
        );
        await connection.query(
          `UPDATE browser_runs SET control_state = 'FROZEN', status = 'HUMAN_REQUIRED', updated_at = ?
           WHERE id = ? AND control_state = 'REQUESTED'`, [timestamp, run]
        );
        row.control_state = 'FROZEN';
        row.run_status = 'HUMAN_REQUIRED';
      } else if (action === 'TRANSFER') {
        if (row.control_state !== 'FROZEN' || intervention?.status !== 'FROZEN') {
          throw new BrowserAdminError('intervention is not frozen', 'CONTROL_STATE_CONFLICT', 409);
        }
        await connection.query(
          `UPDATE browser_interventions
           SET status = 'TRANSFERRED', human_owner_id = ?, transferred_at = ?
           WHERE id = ? AND status = 'FROZEN'`, [humanOwnerId, timestamp, intervention.id]
        );
        await connection.query(
          `UPDATE browser_runs
           SET control_state = 'TRANSFERRED', human_owner_id = ?, updated_at = ?
           WHERE id = ? AND control_state = 'FROZEN'`, [humanOwnerId, timestamp, run]
        );
        row.control_state = 'TRANSFERRED';
      } else if (action === 'RELEASE_SAFE') {
        if (row.control_state !== 'TRANSFERRED' || intervention?.status !== 'TRANSFERRED') {
          throw new BrowserAdminError('intervention is not transferred', 'CONTROL_STATE_CONFLICT', 409);
        }
        if (!SAFE_PAYMENT_STATES.has(row.payment_state)
          || !['PREPARED', 'ACTIVE'].includes(row.attempt_status)
          || row.funds_risk_state !== 'ACTIVE'
          || row.order_status !== 'SUBMITTING'
          || await paymentSubmitExists(connection, run)) {
          throw new BrowserAdminError('payment evidence requires reconciliation', 'RECONCILE_ONLY', 409);
        }
        await connection.query(
          `UPDATE browser_interventions
           SET status = 'RELEASED', result_code = 'NO_EXTERNAL_PAYMENT_ACTION', finished_at = ?
           WHERE id = ? AND status = 'TRANSFERRED'`, [timestamp, intervention.id]
        );
        await connection.query(
          `UPDATE browser_runs
           SET control_state = 'AUTOMATION', human_owner_id = NULL, requested_by = NULL,
               status = 'RUNNING', updated_at = ?
           WHERE id = ? AND control_state = 'TRANSFERRED'`, [timestamp, run]
        );
        row.control_state = 'AUTOMATION';
        row.run_status = 'RUNNING';
      } else if (action === 'MARK_PAYMENT_UNKNOWN') {
        if (!['FROZEN', 'TRANSFERRED'].includes(row.control_state)
          || !['FROZEN', 'TRANSFERRED'].includes(intervention?.status)) {
          throw new BrowserAdminError('intervention does not own the run', 'CONTROL_STATE_CONFLICT', 409);
        }
        if (!['NOT_STARTED', 'PAYMENT_ARMED', 'PAYMENT_SUBMITTING'].includes(row.payment_state)) {
          throw new BrowserAdminError('terminal payment state cannot be marked unknown', 'PAYMENT_STATE_CONFLICT', 409);
        }
        await connection.query(
          `UPDATE browser_interventions
           SET status = 'RELEASED', result_code = 'PAYMENT_RESULT_UNKNOWN', finished_at = ?
           WHERE id = ? AND status IN ('FROZEN', 'TRANSFERRED')`, [timestamp, intervention.id]
        );
        await connection.query(
          `UPDATE browser_runs
           SET status = 'RECONCILE_ONLY', payment_state = 'PAYMENT_UNKNOWN',
               control_state = 'RELEASED', last_error_code = 'HUMAN_PAYMENT_UNKNOWN',
               updated_at = ? WHERE id = ?`, [timestamp, run]
        );
        const [attemptUpdate] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'SUBMIT_UNKNOWN', funds_risk_state = 'UNKNOWN',
               result_summary_json = ?, updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER'`,
          [json({ code: 'HUMAN_PAYMENT_UNKNOWN', browserRunId: run }), timestamp,
            row.recharge_attempt_id]
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new BrowserAdminError('funds attempt changed concurrently', 'ATTEMPT_CONFLICT', 409);
        }
        if (row.order_status !== 'SUBMIT_UNKNOWN') {
          const [orderUpdate] = await connection.query(
            `UPDATE orders
             SET status = 'SUBMIT_UNKNOWN', version = version + 1,
                 failure_code = 'HUMAN_PAYMENT_UNKNOWN',
                 failure_reason = 'Human-controlled Browser payment outcome is unknown',
                 updated_at = ? WHERE id = ? AND version = ?`,
            [timestamp, row.order_id, row.order_version]
          );
          if (orderUpdate.affectedRows !== 1) {
            throw new BrowserAdminError('order changed concurrently', 'ORDER_CONFLICT', 409);
          }
          await connection.query(
            `INSERT INTO order_events
             (order_id, from_status, to_status, actor_type, actor_id, reason,
              metadata_json, created_at)
             VALUES (?, ?, 'SUBMIT_UNKNOWN', 'ADMIN', ?,
               'Human-controlled Browser payment outcome is unknown', ?, ?)`,
            [row.order_id, row.order_status, actorId,
              json({ browserRunId: run, attemptId: row.recharge_attempt_id }), timestamp]
          );
        }
        await connection.query(
          `INSERT INTO reconciliation_cases
           (id, case_type, status, severity, dedupe_key, order_id,
            recharge_attempt_id, evidence_json, detected_at, updated_at)
           VALUES (?, 'BROWSER_PAYMENT_UNKNOWN', 'OPEN', 'critical', ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE last_seen_at = VALUES(detected_at),
             evidence_json = VALUES(evidence_json), updated_at = VALUES(updated_at)`,
          [idFactory(), `browser-payment-unknown:${row.recharge_attempt_id}`,
            row.order_id, row.recharge_attempt_id,
            json({ browserRunId: run, reasonCode: 'HUMAN_PAYMENT_UNKNOWN' }),
            timestamp, timestamp]
        );
        row.control_state = 'RELEASED';
        row.run_status = 'RECONCILE_ONLY';
        row.payment_state = 'PAYMENT_UNKNOWN';
      } else if (action === 'CANCEL') {
        if (row.control_state !== 'REQUESTED' || intervention?.status !== 'REQUESTED') {
          throw new BrowserAdminError('only an un-frozen request can be cancelled', 'CONTROL_STATE_CONFLICT', 409);
        }
        await connection.query(
          `UPDATE browser_interventions
           SET status = 'CANCELLED', result_code = 'REQUEST_CANCELLED', finished_at = ?
           WHERE id = ? AND status = 'REQUESTED'`, [timestamp, intervention.id]
        );
        await connection.query(
          `UPDATE browser_runs
           SET control_state = 'AUTOMATION', requested_by = NULL, updated_at = ?
           WHERE id = ? AND control_state = 'REQUESTED'`, [timestamp, run]
        );
        row.control_state = 'AUTOMATION';
      }

      const { sequence } = await appendControlCheckpoint(connection, row, {
        action, operationId, actorId, reasonCode, now: timestamp
      });
      return {
        runId: run, action, operationId, interventionId,
        controlState: row.control_state, runStatus: row.run_status,
        paymentState: row.payment_state, checkpointSequence: sequence,
        idempotentReplay: false
      };
    });
  }

  return { listRuns, getRun, controlRun };
}
