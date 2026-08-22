import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const HEX_64 = /^[a-f0-9]{64}$/i;
const ACTIVE_RUN_STATUSES = new Set(['READY', 'RUNNING', 'RECONCILE_ONLY', 'HUMAN_REQUIRED']);

export class BrowserExecutionError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'BrowserExecutionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BrowserExecutionError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

function requireHash(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (!HEX_64.test(normalized)) {
    throw new BrowserExecutionError(`${name} must be a 64-character hex digest`, 'INVALID_ARGUMENT');
  }
  return normalized;
}

function hashSecret(value) {
  return createHash('sha256').update(required(value, 'secret')).digest('hex');
}

function hashesEqual(left, right) {
  if (!HEX_64.test(String(left || '')) || !HEX_64.test(String(right || ''))) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
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

async function lockRunContext(connection, runId) {
  const [rows] = await connection.query(
    `SELECT br.id AS run_id, br.recharge_attempt_id, br.executor_profile_id,
            br.status AS run_status, br.payment_state, br.post_payment_state,
            br.plus_activated_at, br.cancellation_confirmed_at, br.account_key_hmac,
            br.worker_id, br.worker_lease_token_hash, br.worker_lease_until,
            br.control_state, br.automation_owner_id, br.human_owner_id,
            br.last_checkpoint_sequence,
            rat.order_id, rat.status AS attempt_status, rat.funds_risk_state,
            rat.executor_kind, rat.executor_profile_id AS attempt_profile_id,
            o.status AS order_status, o.version AS order_version
     FROM browser_runs br
     INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
     INNER JOIN orders o ON o.id = rat.order_id
     WHERE br.id = ?
     FOR UPDATE`,
    [runId]
  );
  if (rows.length !== 1) throw new BrowserExecutionError('browser run not found', 'RUN_NOT_FOUND');
  return rows[0];
}

function assertRunLease(row, { workerId, leaseToken, now }) {
  if (row.worker_id !== workerId) {
    throw new BrowserExecutionError('browser run is owned by another worker', 'LEASE_NOT_OWNED');
  }
  if (!hashesEqual(row.worker_lease_token_hash, hashSecret(leaseToken))) {
    throw new BrowserExecutionError('browser run lease token is invalid', 'LEASE_NOT_OWNED');
  }
  if (!row.worker_lease_until || new Date(row.worker_lease_until).getTime() <= now.getTime()) {
    throw new BrowserExecutionError('browser run lease expired', 'LEASE_EXPIRED');
  }
}

async function assertPaymentWritesEnabled(connection) {
  const [rows] = await connection.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key = 'browser_payment_writes_enabled'
     FOR UPDATE`
  );
  if (rows.length !== 1 || String(rows[0].setting_value).toLowerCase() !== 'true') {
    throw new BrowserExecutionError('Browser payment writes are disabled', 'BROWSER_PAYMENT_WRITES_DISABLED');
  }
}

async function existingOperation(connection, runId, operationId) {
  const [rows] = await connection.query(
    `SELECT operation_type, status, result_code, public_result_json
     FROM browser_operations
     WHERE browser_run_id = ? AND operation_id = ?
     FOR UPDATE`,
    [runId, operationId]
  );
  return rows[0] || null;
}

async function appendCheckpoint(connection, row, {
  kind, risk, operationId, now, evidence = null
}) {
  const sequence = Number(row.last_checkpoint_sequence) + 1;
  await connection.query(
    `INSERT INTO browser_checkpoints
     (browser_run_id, sequence_no, checkpoint_kind, payment_risk,
      operation_id, evidence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.run_id, sequence, kind, risk, operationId, json(evidence), now]
  );
  return sequence;
}

function publicRun(row, extra = {}) {
  return {
    runId: row.run_id,
    attemptId: row.recharge_attempt_id,
    orderId: row.order_id,
    runStatus: row.run_status,
    paymentState: row.payment_state,
    postPaymentState: row.post_payment_state,
    attemptStatus: row.attempt_status,
    fundsRiskState: row.funds_risk_state,
    orderStatus: row.order_status,
    ...extra
  };
}

export function createBrowserExecutionRepository(pool) {
  return {
    async beginRun({
      attemptId,
      executorProfileId,
      accountKeyHmac,
      workerId,
      startOperationKey,
      runId = randomUUID(),
      runNo = 1,
      leaseSeconds = 60,
      now = new Date()
    }) {
      const attempt = required(attemptId, 'attemptId');
      const profile = required(executorProfileId, 'executorProfileId');
      const account = requireHash(accountKeyHmac, 'accountKeyHmac');
      const worker = required(workerId, 'workerId');
      const startKey = required(startOperationKey, 'startOperationKey');
      const run = required(runId, 'runId');
      if (!Number.isInteger(runNo) || runNo < 1) {
        throw new BrowserExecutionError('runNo must be a positive integer', 'INVALID_ARGUMENT');
      }
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
        throw new BrowserExecutionError('leaseSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }

      return inTransaction(pool, async (connection) => {
        const [replays] = await connection.query(
          `SELECT br.id AS run_id, br.recharge_attempt_id, rat.order_id,
                  br.status AS run_status, br.payment_state,
                  rat.status AS attempt_status, rat.funds_risk_state,
                  o.status AS order_status
           FROM browser_runs br
           INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
           INNER JOIN orders o ON o.id = rat.order_id
           WHERE br.start_operation_key = ?`,
          [startKey]
        );
        if (replays.length) {
          const replay = replays[0];
          if (replay.recharge_attempt_id !== attempt) {
            throw new BrowserExecutionError('start operation key belongs to another attempt', 'START_KEY_CONFLICT');
          }
          return publicRun(replay, { idempotentReplay: true, leaseToken: null });
        }

        const [contexts] = await connection.query(
          `SELECT rat.id AS recharge_attempt_id, rat.order_id,
                  rat.status AS attempt_status, rat.funds_risk_state,
                  rat.executor_kind, rat.executor_profile_id AS attempt_profile_id,
                  rat.fulfillment_route_id,
                  o.status AS order_status, o.version AS order_version,
                  c.id AS card_id
           FROM recharge_attempts rat
           INNER JOIN orders o ON o.id = rat.order_id
           LEFT JOIN cards c ON c.order_id = o.id
           WHERE rat.id = ?
           FOR UPDATE`,
          [attempt]
        );
        if (contexts.length !== 1) {
          throw new BrowserExecutionError('browser attempt context not found', 'ATTEMPT_NOT_FOUND');
        }
        const context = contexts[0];
        const [executionBindings] = await connection.query(
          `SELECT fr.executor_kind AS route_executor_kind,
                  ep.status AS profile_status,
                  ep.executor_kind AS profile_executor_kind
           FROM fulfillment_routes fr
           CROSS JOIN executor_profiles ep
           WHERE fr.id = ? AND ep.id = ?
           FOR SHARE`,
          [context.fulfillment_route_id, profile]
        );
        if (executionBindings.length !== 1) {
          throw new BrowserExecutionError('Browser route or profile not found', 'EXECUTOR_PROFILE_DISABLED');
        }
        const binding = executionBindings[0];
        if (context.executor_kind !== 'BROWSER' || binding.route_executor_kind !== 'BROWSER') {
          throw new BrowserExecutionError('attempt is not routed to Browser', 'EXECUTOR_KIND_MISMATCH');
        }
        if (binding.profile_executor_kind !== 'BROWSER' || binding.profile_status !== 'ACTIVE') {
          throw new BrowserExecutionError('Browser executor profile is not active', 'EXECUTOR_PROFILE_DISABLED');
        }
        if (context.attempt_profile_id && context.attempt_profile_id !== profile) {
          throw new BrowserExecutionError('attempt executor profile is already frozen', 'EXECUTOR_PROFILE_CONFLICT');
        }
        if (context.attempt_status !== 'PREPARED' || context.funds_risk_state !== 'ACTIVE') {
          throw new BrowserExecutionError('attempt is not ready to start a Browser run', 'ATTEMPT_NOT_READY');
        }
        if (context.order_status !== 'SUBMITTING') {
          throw new BrowserExecutionError('order is not in SUBMITTING', 'ORDER_NOT_READY');
        }
        if (!context.card_id) {
          throw new BrowserExecutionError('order has no assigned card', 'CARD_NOT_READY');
        }

        const leaseToken = randomBytes(32).toString('hex');
        const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
        await connection.query(
          `UPDATE recharge_attempts
           SET executor_profile_id = ?, updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER'
             AND (executor_profile_id IS NULL OR executor_profile_id = ?)`,
          [profile, now, attempt, profile]
        );
        await connection.query(
          `INSERT INTO browser_runs
           (id, recharge_attempt_id, executor_profile_id, run_no, start_operation_key,
            status, payment_state, account_key_hmac, worker_id,
            worker_lease_token_hash, worker_lease_until, control_state,
            automation_owner_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'RUNNING', 'NOT_STARTED', ?, ?, ?, ?,
             'AUTOMATION', ?, ?, ?)`,
          [run, attempt, profile, runNo, startKey, account, worker,
            hashSecret(leaseToken), leaseUntil, worker, now, now]
        );
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'BEGIN_RUN', 'COMMITTED', 'RUN_STARTED', ?, ?, ?)`,
          [run, startKey, json({ executorProfileId: profile, runNo }), now, now]
        );
        return {
          runId: run,
          attemptId: attempt,
          orderId: context.order_id,
          runStatus: 'RUNNING',
          paymentState: 'NOT_STARTED',
          attemptStatus: context.attempt_status,
          fundsRiskState: context.funds_risk_state,
          orderStatus: context.order_status,
          leaseToken,
          leaseUntil,
          idempotentReplay: false
        };
      });
    },

    async issuePaymentPermit({
      runId,
      workerId,
      leaseToken,
      snapshotHash,
      permitId = randomUUID(),
      ttlSeconds = 60,
      now = new Date()
    }) {
      const run = required(runId, 'runId');
      const worker = required(workerId, 'workerId');
      const snapshot = requireHash(snapshotHash, 'snapshotHash');
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300) {
        throw new BrowserExecutionError('ttlSeconds must be between 5 and 300', 'INVALID_ARGUMENT');
      }

      return inTransaction(pool, async (connection) => {
        await assertPaymentWritesEnabled(connection);
        const row = await lockRunContext(connection, run);
        assertRunLease(row, { workerId: worker, leaseToken, now });
        if (row.run_status !== 'RUNNING' || row.payment_state !== 'NOT_STARTED') {
          throw new BrowserExecutionError('run is not eligible for a payment permit', 'PAYMENT_NOT_ARMABLE');
        }
        if (row.control_state !== 'AUTOMATION' || row.automation_owner_id !== worker) {
          throw new BrowserExecutionError('automation does not own Browser control', 'CONTROL_NOT_OWNED');
        }
        if (row.executor_kind !== 'BROWSER' || row.attempt_status !== 'PREPARED'
          || row.funds_risk_state !== 'ACTIVE' || row.order_status !== 'SUBMITTING') {
          throw new BrowserExecutionError('funds attempt is not eligible for payment', 'ATTEMPT_NOT_READY');
        }

        const nonce = randomBytes(32).toString('hex');
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
        await connection.query(
          `INSERT INTO payment_permits
           (id, recharge_attempt_id, browser_run_id, status, nonce_hash,
            snapshot_hash, issued_to, expires_at, issued_at)
           VALUES (?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?)`,
          [permitId, row.recharge_attempt_id, run, hashSecret(nonce), snapshot,
            worker, expiresAt, now]
        );
        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PAYMENT_ARMED', risk: 'ARMED', operationId: `permit:${permitId}`,
          now, evidence: { snapshotHash: snapshot, permitId }
        });
        await connection.query(
          `UPDATE browser_runs
           SET payment_state = 'PAYMENT_ARMED', last_checkpoint_sequence = ?,
               last_checkpoint_kind = 'PAYMENT_ARMED', updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND payment_state = 'NOT_STARTED'`,
          [sequence, now, run]
        );
        return { permitId, permitNonce: nonce, expiresAt, snapshotHash: snapshot };
      });
    },

    async commitPaymentSubmissionIntent({
      runId,
      workerId,
      leaseToken,
      permitNonce,
      operationId,
      now = new Date()
    }) {
      const run = required(runId, 'runId');
      const worker = required(workerId, 'workerId');
      const operation = required(operationId, 'operationId');

      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) {
          if (prior.operation_type !== 'PAYMENT_SUBMIT') {
            throw new BrowserExecutionError('operation ID has another type', 'OPERATION_CONFLICT');
          }
          return { executeExternal: false, idempotentReplay: true, resultCode: prior.result_code };
        }
        await assertPaymentWritesEnabled(connection);

        const row = await lockRunContext(connection, run);
        assertRunLease(row, { workerId: worker, leaseToken, now });
        if (row.run_status !== 'RUNNING' || row.payment_state !== 'PAYMENT_ARMED') {
          throw new BrowserExecutionError('run is not armed for payment', 'PAYMENT_NOT_ARMED');
        }
        if (row.control_state !== 'AUTOMATION' || row.automation_owner_id !== worker) {
          throw new BrowserExecutionError('automation does not own Browser control', 'CONTROL_NOT_OWNED');
        }
        if (row.attempt_status !== 'PREPARED' || row.funds_risk_state !== 'ACTIVE'
          || row.order_status !== 'SUBMITTING') {
          throw new BrowserExecutionError('funds attempt is not ready for payment', 'ATTEMPT_NOT_READY');
        }

        const [permits] = await connection.query(
          `SELECT id, status, nonce_hash, snapshot_hash, issued_to, expires_at
           FROM payment_permits
           WHERE recharge_attempt_id = ? AND browser_run_id = ? AND status = 'ISSUED'
           FOR UPDATE`,
          [row.recharge_attempt_id, run]
        );
        if (permits.length !== 1) {
          throw new BrowserExecutionError('active payment permit not found', 'PAYMENT_PERMIT_NOT_FOUND');
        }
        const permit = permits[0];
        if (permit.issued_to !== worker || !hashesEqual(permit.nonce_hash, hashSecret(permitNonce))) {
          throw new BrowserExecutionError('payment permit is not owned by this worker', 'PAYMENT_PERMIT_INVALID');
        }
        if (new Date(permit.expires_at).getTime() <= now.getTime()) {
          throw new BrowserExecutionError('payment permit expired', 'PAYMENT_PERMIT_EXPIRED');
        }

        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PAYMENT_SUBMITTING', risk: 'SUBMITTING', operationId: operation,
          now, evidence: { permitId: permit.id, snapshotHash: permit.snapshot_hash }
        });
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PAYMENT_SUBMIT', 'COMMITTED', 'EXTERNAL_ACTION_AUTHORIZED', ?, ?, ?)`,
          [run, operation, json({ permitId: permit.id, snapshotHash: permit.snapshot_hash }), now, now]
        );
        const [consumed] = await connection.query(
          `UPDATE payment_permits
           SET status = 'CONSUMED', consumed_at = ?
           WHERE id = ? AND status = 'ISSUED'`,
          [now, permit.id]
        );
        if (consumed.affectedRows !== 1) {
          throw new BrowserExecutionError('payment permit changed concurrently', 'PAYMENT_PERMIT_CONFLICT');
        }
        const [runUpdate] = await connection.query(
          `UPDATE browser_runs
           SET payment_state = 'PAYMENT_SUBMITTING', last_checkpoint_sequence = ?,
               last_checkpoint_kind = 'PAYMENT_SUBMITTING', updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND payment_state = 'PAYMENT_ARMED'`,
          [sequence, now, run]
        );
        if (runUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        const [attemptUpdate] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'SUBMITTING', funds_risk_state = 'ACTIVE',
               submit_intent_at = COALESCE(submit_intent_at, ?), updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER'
             AND status = 'PREPARED' AND funds_risk_state = 'ACTIVE'`,
          [now, now, row.recharge_attempt_id]
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('funds attempt changed concurrently', 'ATTEMPT_CONFLICT');
        }
        return {
          executeExternal: true,
          idempotentReplay: false,
          operationId: operation,
          checkpointSequence: sequence,
          snapshotHash: permit.snapshot_hash
        };
      });
    },

    async markPaymentUnknown({ runId, operationId, reasonCode, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const reason = required(reasonCode, 'reasonCode');

      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) {
          if (prior.operation_type !== 'PAYMENT_UNKNOWN') {
            throw new BrowserExecutionError('operation ID has another type', 'OPERATION_CONFLICT');
          }
          const replay = await lockRunContext(connection, run);
          return publicRun(replay, { idempotentReplay: true });
        }
        const row = await lockRunContext(connection, run);
        if (row.payment_state !== 'PAYMENT_SUBMITTING'
          || row.attempt_status !== 'SUBMITTING'
          || row.funds_risk_state !== 'ACTIVE') {
          throw new BrowserExecutionError('payment is not in a submitting state', 'PAYMENT_NOT_SUBMITTING');
        }

        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PAYMENT_UNKNOWN', risk: 'UNKNOWN', operationId: operation,
          now, evidence: { reasonCode: reason }
        });
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PAYMENT_UNKNOWN', 'COMMITTED', ?, ?, ?, ?)`,
          [run, operation, reason, json({ reasonCode: reason }), now, now]
        );
        const [runUpdate] = await connection.query(
          `UPDATE browser_runs
           SET status = 'RECONCILE_ONLY', payment_state = 'PAYMENT_UNKNOWN',
               last_checkpoint_sequence = ?, last_checkpoint_kind = 'PAYMENT_UNKNOWN',
               last_error_code = ?, updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND payment_state = 'PAYMENT_SUBMITTING'`,
          [sequence, reason, now, run]
        );
        if (runUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        const [attemptUpdate] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'SUBMIT_UNKNOWN', funds_risk_state = 'UNKNOWN',
               result_summary_json = ?, updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER'
             AND status = 'SUBMITTING' AND funds_risk_state = 'ACTIVE'`,
          [json({ code: reason, browserRunId: run }), now, row.recharge_attempt_id]
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('funds attempt changed concurrently', 'ATTEMPT_CONFLICT');
        }
        const [orderUpdate] = await connection.query(
          `UPDATE orders
           SET status = 'SUBMIT_UNKNOWN', version = version + 1,
               failure_code = ?, failure_reason = ?, updated_at = ?
           WHERE id = ? AND status = 'SUBMITTING' AND version = ?`,
          [reason, 'Browser payment submission outcome is unknown', now,
            row.order_id, row.order_version]
        );
        if (orderUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('order changed concurrently', 'ORDER_CONFLICT');
        }
        await connection.query(
          `INSERT INTO order_events
           (order_id, from_status, to_status, actor_type, actor_id, reason,
            metadata_json, created_at)
           VALUES (?, 'SUBMITTING', 'SUBMIT_UNKNOWN', 'SYSTEM', NULL,
             'Browser payment submission outcome is unknown', ?, ?)`,
          [row.order_id, json({ browserRunId: run, attemptId: row.recharge_attempt_id, reasonCode: reason }), now]
        );
        await connection.query(
          `INSERT INTO reconciliation_cases
           (id, case_type, status, severity, dedupe_key, order_id,
            recharge_attempt_id, evidence_json, detected_at, updated_at)
           VALUES (?, 'BROWSER_PAYMENT_UNKNOWN', 'OPEN', 'critical', ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE last_seen_at = VALUES(detected_at),
             evidence_json = VALUES(evidence_json), updated_at = VALUES(updated_at)`,
          [randomUUID(), `browser-payment-unknown:${row.recharge_attempt_id}`,
            row.order_id, row.recharge_attempt_id,
            json({ browserRunId: run, reasonCode: reason }), now, now]
        );
        return publicRun({
          ...row,
          run_status: 'RECONCILE_ONLY',
          payment_state: 'PAYMENT_UNKNOWN',
          attempt_status: 'SUBMIT_UNKNOWN',
          funds_risk_state: 'UNKNOWN',
          order_status: 'SUBMIT_UNKNOWN'
        }, { idempotentReplay: false });
      });
    },

    async markPaymentConfirmed({ runId, operationId, evidenceHash, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const evidence = requireHash(evidenceHash, 'evidenceHash');

      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) {
          if (prior.operation_type !== 'PAYMENT_CONFIRMED') {
            throw new BrowserExecutionError('operation ID has another type', 'OPERATION_CONFLICT');
          }
          const replay = await lockRunContext(connection, run);
          return publicRun(replay, { idempotentReplay: true });
        }
        const row = await lockRunContext(connection, run);
        if (row.payment_state !== 'PAYMENT_SUBMITTING'
          || row.attempt_status !== 'SUBMITTING'
          || row.funds_risk_state !== 'ACTIVE') {
          throw new BrowserExecutionError('payment is not awaiting confirmation', 'PAYMENT_NOT_CONFIRMABLE');
        }
        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PAYMENT_CONFIRMED', risk: 'CONFIRMED', operationId: operation,
          now, evidence: { evidenceHash: evidence }
        });
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PAYMENT_CONFIRMED', 'COMMITTED', 'PAYMENT_CONFIRMED', ?, ?, ?)`,
          [run, operation, json({ evidenceHash: evidence }), now, now]
        );
        const [updated] = await connection.query(
          `UPDATE browser_runs
           SET payment_state = 'PAYMENT_CONFIRMED', post_payment_state = 'PLUS_PENDING',
               last_checkpoint_sequence = ?, last_checkpoint_kind = 'PAYMENT_CONFIRMED',
               updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND payment_state = 'PAYMENT_SUBMITTING'`,
          [sequence, now, run]
        );
        if (updated.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        return publicRun({ ...row, payment_state: 'PAYMENT_CONFIRMED' }, {
          postPaymentState: 'PLUS_PENDING', idempotentReplay: false
        });
      });
    },

    async recordPlusActivation({ runId, operationId, evidenceHash, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const evidence = requireHash(evidenceHash, 'evidenceHash');
      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) {
          if (prior.operation_type !== 'PLUS_ACTIVATED') {
            throw new BrowserExecutionError('operation ID has another type', 'OPERATION_CONFLICT');
          }
          const replay = await lockRunContext(connection, run);
          return publicRun(replay, { idempotentReplay: true });
        }
        const row = await lockRunContext(connection, run);
        if (row.payment_state !== 'PAYMENT_CONFIRMED'
          || !['PLUS_PENDING', 'CANCELLATION_PENDING'].includes(row.post_payment_state)) {
          throw new BrowserExecutionError('Plus activation is not observable yet', 'PLUS_NOT_PENDING');
        }
        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PLUS_ACTIVATED', risk: 'CONFIRMED', operationId: operation,
          now, evidence: { evidenceHash: evidence }
        });
        await connection.query(
          `INSERT INTO browser_post_payment_observations
           (browser_run_id, observation_kind, observation_status, evidence_hash, evidence_json, observed_at)
           VALUES (?, 'PLUS_ACTIVATION', 'CONFIRMED', ?, ?, ?)`,
          [run, evidence, json({ evidenceHash: evidence }), now]
        );
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PLUS_ACTIVATED', 'COMMITTED', 'PLUS_ACTIVE', ?, ?, ?)`,
          [run, operation, json({ evidenceHash: evidence }), now, now]
        );
        const [updated] = await connection.query(
          `UPDATE browser_runs
           SET post_payment_state = 'CANCELLATION_PENDING', plus_activated_at = ?,
               last_checkpoint_sequence = ?, last_checkpoint_kind = 'PLUS_ACTIVATED', updated_at = ?
           WHERE id = ? AND payment_state = 'PAYMENT_CONFIRMED'
             AND post_payment_state IN ('PLUS_PENDING', 'CANCELLATION_PENDING')`,
          [now, sequence, now, run]
        );
        if (updated.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        return publicRun({ ...row, payment_state: 'PAYMENT_CONFIRMED' }, {
          postPaymentState: 'CANCELLATION_PENDING', plusActivatedAt: now, idempotentReplay: false
        });
      });
    },

    async recordCancellationConfirmed({ runId, operationId, evidenceHash, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const evidence = requireHash(evidenceHash, 'evidenceHash');
      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) {
          if (prior.operation_type !== 'CANCELLATION_CONFIRMED') {
            throw new BrowserExecutionError('operation ID has another type', 'OPERATION_CONFLICT');
          }
          const replay = await lockRunContext(connection, run);
          return publicRun(replay, { idempotentReplay: true });
        }
        const row = await lockRunContext(connection, run);
        if (row.payment_state !== 'PAYMENT_CONFIRMED'
          || row.post_payment_state !== 'CANCELLATION_PENDING'
          || row.attempt_status !== 'SUBMITTING'
          || row.funds_risk_state !== 'ACTIVE') {
          throw new BrowserExecutionError('cancellation is not confirmable', 'CANCELLATION_NOT_PENDING');
        }
        const sequence = await appendCheckpoint(connection, row, {
          kind: 'CANCELLATION_CONFIRMED', risk: 'CONFIRMED', operationId: operation,
          now, evidence: { evidenceHash: evidence }
        });
        await connection.query(
          `INSERT INTO browser_post_payment_observations
           (browser_run_id, observation_kind, observation_status, evidence_hash, evidence_json, observed_at)
           VALUES (?, 'CANCELLATION', 'CONFIRMED', ?, ?, ?)`,
          [run, evidence, json({ evidenceHash: evidence }), now]
        );
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'CANCELLATION_CONFIRMED', 'COMMITTED', 'RECHARGE_SUCCESS', ?, ?, ?)`,
          [run, operation, json({ evidenceHash: evidence }), now, now]
        );
        const [runUpdate] = await connection.query(
          `UPDATE browser_runs
           SET status = 'COMPLETED', post_payment_state = 'CANCELLATION_CONFIRMED',
               cancellation_confirmed_at = ?, last_checkpoint_sequence = ?,
               last_checkpoint_kind = 'CANCELLATION_CONFIRMED', finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND post_payment_state = 'CANCELLATION_PENDING'`,
          [now, sequence, now, now, run]
        );
        if (runUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        const [attemptUpdate] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'CLEARED', funds_risk_state = 'CLEARED', finished_at = ?, updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER' AND status = 'SUBMITTING' AND funds_risk_state = 'ACTIVE'`,
          [now, now, row.recharge_attempt_id]
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('funds attempt changed concurrently', 'ATTEMPT_CONFLICT');
        }
        const [orderUpdate] = await connection.query(
          `UPDATE orders
           SET status = 'RECHARGE_SUCCESS', version = version + 1, finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'SUBMITTING' AND version = ?`,
          [now, now, row.order_id, row.order_version]
        );
        if (orderUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('order changed concurrently', 'ORDER_CONFLICT');
        }
        await connection.query(
          `INSERT INTO order_events
           (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json, created_at)
           VALUES (?, 'SUBMITTING', 'RECHARGE_SUCCESS', 'SYSTEM', NULL,
             'Browser Plus activation and cancellation confirmed', ?, ?)`,
          [row.order_id, json({ browserRunId: run, attemptId: row.recharge_attempt_id, evidenceHash: evidence }), now]
        );
        return publicRun({
          ...row, run_status: 'COMPLETED', payment_state: 'PAYMENT_CONFIRMED',
          attempt_status: 'CLEARED', funds_risk_state: 'CLEARED', order_status: 'RECHARGE_SUCCESS'
        }, { postPaymentState: 'CANCELLATION_CONFIRMED', idempotentReplay: false });
      });
    },

    async getRecoveryState(runId) {
      const run = required(runId, 'runId');
      const [rows] = await pool.query(
        `SELECT br.id AS run_id, br.recharge_attempt_id, rat.order_id,
                br.status AS run_status, br.payment_state,
                rat.status AS attempt_status, rat.funds_risk_state,
                o.status AS order_status,
                EXISTS (
                  SELECT 1 FROM browser_operations bo
                  WHERE bo.browser_run_id = br.id
                    AND bo.operation_type = 'PAYMENT_SUBMIT'
                    AND bo.status IN ('COMMITTED', 'OUTCOME_UNKNOWN')
                ) AS payment_submit_committed
         FROM browser_runs br
         INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
         INNER JOIN orders o ON o.id = rat.order_id
         WHERE br.id = ?`,
        [run]
      );
      if (rows.length !== 1) throw new BrowserExecutionError('browser run not found', 'RUN_NOT_FOUND');
      const row = rows[0];
      const reconcileOnly = Number(row.payment_submit_committed) === 1
        || row.payment_state === 'PAYMENT_SUBMITTING'
        || row.payment_state === 'PAYMENT_UNKNOWN'
        || row.funds_risk_state === 'UNKNOWN';
      return publicRun(row, {
        recoveryMode: reconcileOnly ? 'RECONCILE_ONLY'
          : ACTIVE_RUN_STATUSES.has(row.run_status) ? 'RESUMABLE' : 'TERMINAL'
      });
    }
  };
}
