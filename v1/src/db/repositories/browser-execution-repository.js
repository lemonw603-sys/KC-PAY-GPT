import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { redactSensitiveText } from '../../security/redaction.js';
import { transitionCardConsumptionInTransaction } from '../../services/card-consumption-ledger-service.js';

const HEX_64 = /^[a-f0-9]{64}$/i;
const ACTIVE_RUN_STATUSES = new Set(['READY', 'RUNNING', 'RECONCILE_ONLY', 'HUMAN_REQUIRED']);
const PAYMENT_READY_CARD_STATUSES = new Set(['active', 'available', 'usable', 'ready']);
const PAYMENT_SNAPSHOT_MAX_AGE_MS = 15 * 60_000;
const SAFE_ABORT_ORDER_STATUSES = new Set(['WAITING_FOR_SESSION', 'CARD_READY', 'RECHARGE_FAILED']);
const CUSTOMER_SESSION_ACTION_CODES = new Set(['ACCOUNT_ALREADY_PLUS', 'SESSION_INVALID']);

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

function requireCode(value, name) {
  const normalized = required(value, name).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(normalized)) {
    throw new BrowserExecutionError(`${name} must be an uppercase operational code`, 'INVALID_ARGUMENT');
  }
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

function decimalMicros(value, name) {
  const normalized = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) {
    throw new BrowserExecutionError(`${name} is not a valid non-negative DECIMAL(18,6)`, 'CARD_SNAPSHOT_INVALID');
  }
  return (BigInt(match[1]) * 1_000_000n) + BigInt((match[2] || '').padEnd(6, '0'));
}

function timestampIso(value, name) {
  const timestamp = value == null ? NaN : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new BrowserExecutionError(`${name} is missing or invalid`, 'CARD_CHECK_STALE');
  }
  return { timestamp, iso: new Date(timestamp).toISOString() };
}

function cardCredentialsDigest(value) {
  if (value == null) return null;
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest('hex');
}

function authoritativePaymentSnapshot(row, now) {
  if (!row.executor_profile_id || row.executor_profile_id !== row.attempt_profile_id) {
    throw new BrowserExecutionError('run and attempt executor profiles do not match', 'EXECUTOR_PROFILE_CONFLICT');
  }
  if (row.executor_kind !== 'BROWSER' || row.route_executor_kind !== 'BROWSER') {
    throw new BrowserExecutionError('attempt route is not executable by Browser', 'EXECUTOR_KIND_MISMATCH');
  }
  if (!row.attempt_fulfillment_route_id || row.attempt_fulfillment_route_id !== row.order_fulfillment_route_id
    || row.attempt_fulfillment_route_id !== row.route_id) {
    throw new BrowserExecutionError('attempt and order routes do not match', 'ROUTE_BINDING_MISMATCH');
  }
  if (!row.card_id || (row.assigned_card_id
    ? row.assigned_card_id !== row.card_id
    : row.card_order_id !== row.order_id)) {
    throw new BrowserExecutionError('card is not bound to this order', 'CARD_BINDING_MISMATCH');
  }
  if (!row.card_consumption_id
    || row.card_consumption_status !== 'RESERVED'
    || row.card_consumption_attempt_id !== row.recharge_attempt_id
    || row.card_consumption_order_id !== row.order_id
    || row.card_consumption_card_id !== row.card_id) {
    throw new BrowserExecutionError(
      'shared card consumption reservation is missing or no longer active',
      'CARD_CONSUMPTION_NOT_RESERVED'
    );
  }
  if (!row.card_provider_account_id
    || row.card_provider_account_id !== row.frozen_card_provider_account_id) {
    throw new BrowserExecutionError('card provider does not match the frozen route', 'CARD_PROVIDER_MISMATCH');
  }
  if (!row.provider_card_id) {
    throw new BrowserExecutionError('card provider reference is missing', 'CARD_NOT_READY');
  }
  const cardStatus = String(row.card_status || '').trim().toLowerCase();
  if (!PAYMENT_READY_CARD_STATUSES.has(cardStatus)) {
    throw new BrowserExecutionError('card status is not payment-ready', 'CARD_NOT_READY');
  }
  if (!row.card_credentials_ciphertext) {
    throw new BrowserExecutionError('card credentials are missing', 'CARD_NOT_READY');
  }
  const balance = decimalMicros(row.card_current_balance, 'card current balance');
  const minimum = decimalMicros(row.minimum_required_card_balance, 'minimum required card balance');
  if (balance < minimum) {
    throw new BrowserExecutionError('card balance is below the order minimum', 'CARD_BALANCE_INSUFFICIENT');
  }
  const synced = row.sync_tier === 'MANUAL_IMPORT'
    ? { iso: row.card_last_synced_at ? new Date(row.card_last_synced_at).toISOString() : null, timestamp: now.getTime() }
    : timestampIso(row.card_last_synced_at, 'card sync time');
  const ageMs = now.getTime() - synced.timestamp;
  if (row.sync_tier !== 'MANUAL_IMPORT' && (ageMs < 0 || ageMs > PAYMENT_SNAPSHOT_MAX_AGE_MS)) {
    throw new BrowserExecutionError('card verification is stale', 'CARD_CHECK_STALE');
  }
  const transactionSynced = row.sync_tier === 'MANUAL_IMPORT'
    ? null : timestampIso(row.card_last_transaction_synced_at, 'card transaction sync time');
  const transactionAgeMs = transactionSynced ? now.getTime() - transactionSynced.timestamp : null;
  if (transactionSynced && (transactionAgeMs < 0 || transactionAgeMs > PAYMENT_SNAPSHOT_MAX_AGE_MS)) {
    throw new BrowserExecutionError('card transaction evidence is stale', 'CARD_TRANSACTION_CHECK_STALE');
  }
  const facts = {
    executorProfileId: row.executor_profile_id,
    attemptId: row.recharge_attempt_id,
    orderId: row.order_id,
    routeId: row.route_id,
    frozenCardProviderAccountId: row.frozen_card_provider_account_id,
    cardId: row.card_id,
    cardConsumptionId: row.card_consumption_id,
    cardConsumptionStatus: row.card_consumption_status,
    cardProviderAccountId: row.card_provider_account_id,
    providerCardId: row.provider_card_id,
    cardStatus,
    cardBalanceMicros: balance.toString(),
    minimumBalanceMicros: minimum.toString(),
    cardCredentialsDigest: cardCredentialsDigest(row.card_credentials_ciphertext),
    cardLastSyncedAt: synced.iso,
    cardLastTransactionSyncedAt: transactionSynced?.iso || null
  };
  return {
    hash: createHash('sha256').update(JSON.stringify(facts)).digest('hex'),
    facts
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

async function lockRunContext(connection, runId) {
  const [rows] = await connection.query(
    `SELECT br.id AS run_id, br.recharge_attempt_id, br.executor_profile_id,
            br.status AS run_status, br.payment_state, br.post_payment_state,
            br.verification_state, br.verification_started_at,
            br.verification_deadline_at, br.verification_next_check_at,
            br.verification_check_count,
            br.plus_activated_at, br.cancellation_confirmed_at, br.account_key_hmac,
            br.worker_id, br.worker_lease_token_hash, br.worker_lease_until,
            br.control_state, br.automation_owner_id, br.human_owner_id,
            br.last_checkpoint_sequence,
            rat.order_id, rat.status AS attempt_status, rat.funds_risk_state,
            rat.executor_kind, rat.executor_profile_id AS attempt_profile_id,
            rat.authorization_item_id,
            rat.fulfillment_route_id AS attempt_fulfillment_route_id,
            o.status AS order_status, o.version AS order_version,
            o.fulfillment_route_id AS order_fulfillment_route_id,
            o.frozen_card_provider_account_id,
            o.assigned_card_id,
            o.minimum_required_card_balance,
            c.id AS card_id, c.order_id AS card_order_id,
            c.provider_account_id AS card_provider_account_id,
            c.sync_tier,
            c.provider_card_id, c.status AS card_status,
            c.current_balance AS card_current_balance,
            c.card_credentials_ciphertext,
            c.last_synced_at AS card_last_synced_at,
            c.last_transaction_synced_at AS card_last_transaction_synced_at,
            ccl.id AS card_consumption_id,
            ccl.status AS card_consumption_status,
            ccl.recharge_attempt_id AS card_consumption_attempt_id,
            ccl.order_id AS card_consumption_order_id,
            ccl.card_id AS card_consumption_card_id,
            fr.id AS route_id, fr.executor_kind AS route_executor_kind,
            fr.card_provider_account_id AS route_card_provider_account_id
     FROM browser_runs br
     INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
     INNER JOIN orders o ON o.id = rat.order_id
     LEFT JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
     LEFT JOIN card_consumption_ledger ccl
       ON ccl.recharge_attempt_id = rat.id
     LEFT JOIN fulfillment_routes fr ON fr.id = rat.fulfillment_route_id
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
    verificationState: row.verification_state || 'NOT_REQUIRED',
    verificationStartedAt: row.verification_started_at || null,
    verificationDeadlineAt: row.verification_deadline_at || null,
    verificationNextCheckAt: row.verification_next_check_at || null,
    verificationCheckCount: Number(row.verification_check_count || 0),
    postPaymentState: row.post_payment_state,
    attemptStatus: row.attempt_status,
    fundsRiskState: row.funds_risk_state,
    orderStatus: row.order_status,
    ...extra
  };
}

export function createBrowserExecutionRepository(pool) {
  return {
    async listPaymentVerificationsDue({ now = new Date(), limit = 20, orderId = null } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new BrowserExecutionError('limit must be between 1 and 100', 'INVALID_ARGUMENT');
      }
      const approvedOrder = orderId == null ? null : required(orderId, 'orderId');
      const [rows] = await pool.query(
        `SELECT br.id AS run_id, br.verification_state,
                br.verification_deadline_at, br.verification_next_check_at,
                br.verification_check_count, br.payment_state,
                br.post_payment_state,
                rat.order_id, rat.executor_profile_id
         FROM browser_runs br
         INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
         INNER JOIN orders o ON o.id = rat.order_id
         WHERE ((br.status = 'RECONCILE_ONLY' AND br.payment_state = 'PAYMENT_UNKNOWN')
             OR (br.status = 'RUNNING' AND br.payment_state = 'PAYMENT_CONFIRMED'
               AND br.post_payment_state IN ('PLUS_PENDING','CANCELLATION_PENDING')))
           AND br.verification_state = 'VERIFYING_PAYMENT'
           AND (br.verification_next_check_at IS NULL OR br.verification_next_check_at <= ?)
           ${approvedOrder ? 'AND rat.order_id = ?' : ''}
         ORDER BY COALESCE(br.verification_next_check_at, br.verification_started_at), br.id
         LIMIT ?`, [now, ...(approvedOrder ? [approvedOrder] : []), limit]
      );
      return rows.map((row) => ({
        runId: row.run_id,
        verificationState: row.verification_state,
        verificationDeadlineAt: row.verification_deadline_at,
        verificationNextCheckAt: row.verification_next_check_at,
        verificationCheckCount: Number(row.verification_check_count || 0),
        paymentState: row.payment_state,
        postPaymentState: row.post_payment_state,
        orderId: row.order_id,
        executorProfileId: row.executor_profile_id,
      }));
    },

    async schedulePostPaymentVerification({ runId, operationId, reasonCode,
      verificationDeadline, verificationNextCheckAt = null, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const reason = requireCode(reasonCode, 'reasonCode');
      const deadline = new Date(verificationDeadline);
      const nextCheck = verificationNextCheckAt == null ? now : new Date(verificationNextCheckAt);
      if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= now.getTime()
        || !Number.isFinite(nextCheck.getTime()) || nextCheck.getTime() > deadline.getTime()) {
        throw new BrowserExecutionError('post-payment verification schedule is invalid', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) return publicRun(await lockRunContext(connection, run), { idempotentReplay: true });
        const row = await lockRunContext(connection, run);
        if (row.run_status !== 'RUNNING' || row.payment_state !== 'PAYMENT_CONFIRMED'
          || !['PLUS_PENDING', 'CANCELLATION_PENDING'].includes(row.post_payment_state)) {
          throw new BrowserExecutionError('post-payment lifecycle is not pending', 'POST_PAYMENT_NOT_PENDING');
        }
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'POST_PAYMENT_VERIFICATION_SCHEDULED', 'COMMITTED', ?, ?, ?, ?)`,
          [run, operation, reason, json({ reasonCode: reason }), now, now]
        );
        await connection.query(
          `UPDATE browser_runs
           SET verification_state='VERIFYING_PAYMENT',
               verification_started_at=COALESCE(verification_started_at, ?),
               verification_deadline_at=?, verification_next_check_at=?,
               last_error_code=?, updated_at=?
           WHERE id=? AND status='RUNNING' AND payment_state='PAYMENT_CONFIRMED'`,
          [now, deadline, nextCheck, reason, now, run]
        );
        return publicRun({ ...row, verification_state: 'VERIFYING_PAYMENT',
          verification_started_at: row.verification_started_at || now,
          verification_deadline_at: deadline, verification_next_check_at: nextCheck },
        { idempotentReplay: false });
      });
    },
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
           LEFT JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
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
        if (context.order_status !== 'RECHARGE_PROCESSING') {
          throw new BrowserExecutionError('order is not in RECHARGE_PROCESSING', 'ORDER_NOT_READY');
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
      permitId = randomUUID(),
      ttlSeconds = 60,
      now = new Date()
    }) {
      const run = required(runId, 'runId');
      const worker = required(workerId, 'workerId');
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
          || row.funds_risk_state !== 'ACTIVE' || row.order_status !== 'RECHARGE_PROCESSING') {
          throw new BrowserExecutionError('funds attempt is not eligible for payment', 'ATTEMPT_NOT_READY');
        }
        const snapshot = authoritativePaymentSnapshot(row, now).hash;

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
          || row.order_status !== 'RECHARGE_PROCESSING') {
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
        const currentSnapshot = authoritativePaymentSnapshot(row, now).hash;
        if (!hashesEqual(currentSnapshot, permit.snapshot_hash)) {
          throw new BrowserExecutionError(
            'authoritative card or route facts changed after the permit was issued',
            'PAYMENT_SNAPSHOT_CHANGED'
          );
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

    async abortBeforePayment({
      runId,
      workerId,
      leaseToken,
      operationId,
      targetOrderStatus,
      reasonCode,
      failureReason,
      customerActionCode = null,
      now = new Date()
    }) {
      const run = required(runId, 'runId');
      const worker = required(workerId, 'workerId');
      const operation = required(operationId, 'operationId');
      const target = required(targetOrderStatus, 'targetOrderStatus').toUpperCase();
      const reason = requireCode(reasonCode, 'reasonCode');
      const publicReason = redactSensitiveText(required(failureReason, 'failureReason'));
      const actionCode = customerActionCode == null
        ? null : requireCode(customerActionCode, 'customerActionCode');
      if (!SAFE_ABORT_ORDER_STATUSES.has(target)) {
        throw new BrowserExecutionError('targetOrderStatus is not safe for pre-payment abort', 'INVALID_ARGUMENT');
      }
      if (target === 'WAITING_FOR_SESSION' && !CUSTOMER_SESSION_ACTION_CODES.has(actionCode)) {
        throw new BrowserExecutionError(
          'customerActionCode must describe an actionable Session problem',
          'INVALID_ARGUMENT'
        );
      }
      if (target !== 'WAITING_FOR_SESSION' && actionCode) {
        throw new BrowserExecutionError(
          'customerActionCode is only valid when waiting for Session replacement',
          'INVALID_ARGUMENT'
        );
      }

      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) {
          if (prior.operation_type !== 'PRE_PAYMENT_ABORT') {
            throw new BrowserExecutionError('operation ID has another type', 'OPERATION_CONFLICT');
          }
          const replay = await lockRunContext(connection, run);
          return publicRun(replay, { idempotentReplay: true });
        }

        const row = await lockRunContext(connection, run);
        assertRunLease(row, { workerId: worker, leaseToken, now });
        if (row.run_status !== 'RUNNING'
          || !['NOT_STARTED', 'PAYMENT_ARMED'].includes(row.payment_state)) {
          throw new BrowserExecutionError('run can no longer abort safely before payment', 'RECONCILE_ONLY');
        }
        if (row.control_state !== 'AUTOMATION' || row.automation_owner_id !== worker) {
          throw new BrowserExecutionError('automation does not own Browser control', 'CONTROL_NOT_OWNED');
        }
        if (row.executor_kind !== 'BROWSER' || row.attempt_status !== 'PREPARED'
          || row.funds_risk_state !== 'ACTIVE' || row.order_status !== 'RECHARGE_PROCESSING') {
          throw new BrowserExecutionError('funds attempt cannot be cleared safely', 'RECONCILE_ONLY');
        }

        const [paymentSubmits] = await connection.query(
          `SELECT id FROM browser_operations
           WHERE browser_run_id = ? AND operation_type = 'PAYMENT_SUBMIT'
             AND status IN ('COMMITTED', 'OUTCOME_UNKNOWN')
           LIMIT 1 FOR UPDATE`,
          [run]
        );
        const [permits] = await connection.query(
          `SELECT id, status FROM payment_permits
           WHERE browser_run_id = ? AND recharge_attempt_id = ?
           FOR UPDATE`,
          [run, row.recharge_attempt_id]
        );
        if (paymentSubmits.length || permits.some((permit) => permit.status === 'CONSUMED')) {
          throw new BrowserExecutionError('payment evidence requires reconciliation', 'RECONCILE_ONLY');
        }

        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PRE_PAYMENT_ABORT', risk: 'NONE', operationId: operation,
          now, evidence: { reasonCode: reason, targetOrderStatus: target }
        });
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PRE_PAYMENT_ABORT', 'COMMITTED', ?, ?, ?, ?)`,
          [run, operation, reason,
            json({ reasonCode: reason, targetOrderStatus: target }), now, now]
        );
        await connection.query(
          `UPDATE payment_permits SET status = 'REVOKED', revoked_at = ?
           WHERE browser_run_id = ? AND recharge_attempt_id = ? AND status = 'ISSUED'`,
          [now, run, row.recharge_attempt_id]
        );
        await connection.query(
          `UPDATE checkout_artifacts
           SET status = 'INVALIDATED', invalidated_at = COALESCE(invalidated_at, ?)
           WHERE browser_run_id = ? AND status IN ('ACTIVE', 'REVIEW_REQUIRED')`,
          [now, run]
        );
        await connection.query(
          `UPDATE browser_artifact_secrets
           SET iv = NULL, auth_tag = NULL, ciphertext = NULL,
               destroyed_at = COALESCE(destroyed_at, ?)
           WHERE browser_run_id = ? AND destroyed_at IS NULL`,
          [now, run]
        );
        await connection.query(
          `UPDATE execution_resource_leases
           SET released_at = COALESCE(released_at, ?),
               release_reason = COALESCE(release_reason, ?)
           WHERE browser_run_id = ? AND released_at IS NULL`,
          [now, `pre-payment abort: ${reason}`.slice(0, 255), run]
        );
        await connection.query(
          `UPDATE browser_dispatch_jobs
           SET status = 'CANCELLED', last_error_code = ?, completed_at = ?,
               lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL, updated_at = ?
           WHERE recharge_attempt_id = ? AND status IN ('QUEUED', 'CLAIMED')`,
          [reason, now, now, row.recharge_attempt_id]
        );
        const [runUpdate] = await connection.query(
          `UPDATE browser_runs
           SET status = 'FAILED_SAFE', control_state = 'RELEASED',
               last_checkpoint_sequence = ?, last_checkpoint_kind = 'PRE_PAYMENT_ABORT',
               last_error_code = ?, worker_lease_until = NULL, finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'RUNNING'
             AND payment_state IN ('NOT_STARTED', 'PAYMENT_ARMED')`,
          [sequence, reason, now, now, run]
        );
        if (runUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        const [attemptUpdate] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'CLEARED', funds_risk_state = 'CLEARED',
               result_summary_json = ?, finished_at = ?, updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER'
             AND status = 'PREPARED' AND funds_risk_state = 'ACTIVE'`,
          [json({ code: reason, browserRunId: run, noExternalPaymentAction: true }),
            now, now, row.recharge_attempt_id]
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('funds attempt changed concurrently', 'ATTEMPT_CONFLICT');
        }
        await transitionCardConsumptionInTransaction(connection, {
          orderId: row.order_id,
          rechargeAttemptId: row.recharge_attempt_id,
          targetStatus: 'RELEASED',
          reason: `Browser pre-payment abort: ${reason}`,
          allowedCurrentStatuses: ['RESERVED', 'RECONCILIATION'],
          requireActive: false,
          evidence: { source: 'browser_pre_payment_abort', browserRunId: run }
        });
        if (row.authorization_item_id) {
          const [authorizationUpdate] = await connection.query(
            `UPDATE recharge_authorization_items SET status = 'RELEASED'
             WHERE id = ? AND consumed_attempt_id = ? AND status = 'CONSUMED'`,
            [row.authorization_item_id, row.recharge_attempt_id]
          );
          if (authorizationUpdate.affectedRows !== 1) {
            throw new BrowserExecutionError('consumed authorization could not be released', 'AUTHORIZATION_CONFLICT');
          }
        }

        let sessionWindowHours = null;
        if (target === 'WAITING_FOR_SESSION') {
          const [settings] = await connection.query(
            `SELECT setting_value FROM app_settings
             WHERE setting_key = 'session_replacement_window_hours' LIMIT 1 FOR UPDATE`
          );
          sessionWindowHours = Math.max(1, Math.min(168, Number(settings[0]?.setting_value || 72)));
        }
        const finishedAt = target === 'RECHARGE_FAILED' ? now : null;
        const [orderUpdate] = await connection.query(
          `UPDATE orders
           SET status = ?, version = version + 1,
               failure_code = ?, failure_reason = ?, customer_action_code = ?,
               session_repair_started_at = CASE WHEN ? = 'WAITING_FOR_SESSION'
                 THEN COALESCE(session_repair_started_at, ?) ELSE session_repair_started_at END,
               session_repair_expires_at = CASE WHEN ? = 'WAITING_FOR_SESSION'
                 THEN COALESCE(session_repair_expires_at, DATE_ADD(?, INTERVAL ? HOUR))
                 ELSE session_repair_expires_at END,
               finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'RECHARGE_PROCESSING' AND version = ?`,
          [target, reason, publicReason, actionCode,
            target, now, target, now, sessionWindowHours, finishedAt, now,
            row.order_id, row.order_version]
        );
        if (orderUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('order changed concurrently', 'ORDER_CONFLICT');
        }
        if (target === 'CARD_READY') {
          await connection.query(
            `UPDATE tasks SET status = 'PENDING', attempts = 0, available_at = ?,
               leased_by = NULL, leased_until = NULL, last_error_code = NULL,
               last_error_message = NULL, completed_at = NULL, updated_at = ?
             WHERE order_id = ? AND task_type = 'SUBMIT_RECHARGE'`,
            [now, now, row.order_id]
          );
        } else if (target === 'RECHARGE_FAILED') {
          await connection.query(
            `UPDATE tasks SET status = 'DEAD', leased_by = NULL, leased_until = NULL,
               last_error_code = ?, last_error_message = ?, updated_at = ?
             WHERE order_id = ? AND task_type = 'SUBMIT_RECHARGE'`,
            [reason, publicReason, now, row.order_id]
          );
        }
        await connection.query(
          `INSERT INTO order_events
           (order_id, from_status, to_status, actor_type, actor_id, reason,
            metadata_json, created_at)
           VALUES (?, 'RECHARGE_PROCESSING', ?, 'WORKER', ?, ?, ?, ?)`,
          [row.order_id, target, worker, publicReason,
            json({ browserRunId: run, attemptId: row.recharge_attempt_id,
              reasonCode: reason, noExternalPaymentAction: true,
              sessionReplacementWindowHours: sessionWindowHours }), now]
        );
        return publicRun({
          ...row, run_status: 'FAILED_SAFE', attempt_status: 'CLEARED',
          funds_risk_state: 'CLEARED', order_status: target
        }, { idempotentReplay: false });
      });
    },

    async markPaymentUnknown({ runId, operationId, reasonCode,
      verificationDeadline, verificationNextCheckAt = null, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const reason = required(reasonCode, 'reasonCode');
      // Repository callers may be recovery/admin code without a scheduler
      // config object; retain a bounded default while normal workers pass the
      // configured deadline explicitly.
      const deadline = verificationDeadline == null
        ? new Date(now.getTime() + 5 * 60_000)
        : new Date(verificationDeadline);
      if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= now.getTime()) {
        throw new BrowserExecutionError('verificationDeadline must be after now', 'INVALID_ARGUMENT');
      }
      const nextCheck = verificationNextCheckAt == null ? now : new Date(verificationNextCheckAt);
      if (!Number.isFinite(nextCheck.getTime()) || nextCheck.getTime() > deadline.getTime()) {
        throw new BrowserExecutionError('verificationNextCheckAt must not exceed the deadline', 'INVALID_ARGUMENT');
      }

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
               verification_state = 'VERIFYING_PAYMENT', verification_started_at = ?,
               verification_deadline_at = ?, verification_next_check_at = ?,
               verification_check_count = 0,
               last_checkpoint_sequence = ?, last_checkpoint_kind = 'PAYMENT_UNKNOWN',
               last_error_code = ?, updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND payment_state = 'PAYMENT_SUBMITTING'`,
          [now, deadline, nextCheck, sequence, reason, now, run]
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
        await transitionCardConsumptionInTransaction(connection, {
          orderId: row.order_id,
          rechargeAttemptId: row.recharge_attempt_id,
          targetStatus: 'RECONCILIATION',
          requireActive: false,
          evidence: { source: 'browser_payment_unknown', browserRunId: run, reasonCode: reason }
        });
        const [orderUpdate] = await connection.query(
          `UPDATE orders
           SET status = 'SUBMIT_UNKNOWN', version = version + 1,
               failure_code = ?, failure_reason = ?, updated_at = ?
           WHERE id = ? AND status = 'RECHARGE_PROCESSING' AND version = ?`,
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
           VALUES (?, 'RECHARGE_PROCESSING', 'SUBMIT_UNKNOWN', 'SYSTEM', NULL,
             'Browser payment submission outcome is unknown', ?, ?)`,
          [row.order_id, json({ browserRunId: run, attemptId: row.recharge_attempt_id, reasonCode: reason }), now]
        );
        return publicRun({
          ...row,
          run_status: 'RECONCILE_ONLY',
          payment_state: 'PAYMENT_UNKNOWN',
          verification_state: 'VERIFYING_PAYMENT',
          verification_started_at: now,
          verification_deadline_at: deadline,
          verification_next_check_at: nextCheck,
          verification_check_count: 0,
          attempt_status: 'SUBMIT_UNKNOWN',
          funds_risk_state: 'UNKNOWN',
          order_status: 'SUBMIT_UNKNOWN'
        }, { idempotentReplay: false });
      });
    },

    async markPaymentConfirmed({ runId, operationId, evidenceHash,
      verificationDeadline = null, verificationNextCheckAt = null, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const evidence = requireHash(evidenceHash, 'evidenceHash');
      const deadline = verificationDeadline == null
        ? new Date(now.getTime() + 5 * 60_000) : new Date(verificationDeadline);
      const nextCheck = verificationNextCheckAt == null ? now : new Date(verificationNextCheckAt);
      if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= now.getTime()
        || !Number.isFinite(nextCheck.getTime()) || nextCheck.getTime() > deadline.getTime()) {
        throw new BrowserExecutionError('post-payment verification schedule is invalid', 'INVALID_ARGUMENT');
      }

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
        const confirmingUnknown = row.payment_state === 'PAYMENT_UNKNOWN'
          && row.verification_state === 'VERIFYING_PAYMENT'
          && row.attempt_status === 'SUBMIT_UNKNOWN'
          && row.funds_risk_state === 'UNKNOWN';
        if (!confirmingUnknown && (row.payment_state !== 'PAYMENT_SUBMITTING'
          || row.attempt_status !== 'SUBMITTING'
          || row.funds_risk_state !== 'ACTIVE')) {
          throw new BrowserExecutionError('payment is not awaiting confirmation', 'PAYMENT_NOT_CONFIRMABLE');
        }
        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PAYMENT_CONFIRMED', risk: 'SETTLED', operationId: operation,
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
           SET status = 'RUNNING', payment_state = 'PAYMENT_CONFIRMED',
               verification_state = 'VERIFYING_PAYMENT',
               verification_started_at = COALESCE(verification_started_at, ?),
               verification_deadline_at = ?, verification_next_check_at = ?,
               post_payment_state = 'PLUS_PENDING',
               last_checkpoint_sequence = ?, last_checkpoint_kind = 'PAYMENT_CONFIRMED',
               updated_at = ?
           WHERE id = ? AND ((status = 'RUNNING' AND payment_state = 'PAYMENT_SUBMITTING')
             OR (status = 'RECONCILE_ONLY' AND payment_state = 'PAYMENT_UNKNOWN'
               AND verification_state = 'VERIFYING_PAYMENT'))`,
          [now, deadline, nextCheck, sequence, now, run]
        );
        if (updated.affectedRows !== 1) {
          throw new BrowserExecutionError('Browser run changed concurrently', 'RUN_CONFLICT');
        }
        if (confirmingUnknown) {
          await connection.query(
            `UPDATE recharge_attempts
             SET status='SUBMITTING', funds_risk_state='ACTIVE', updated_at=?
             WHERE id=? AND status='SUBMIT_UNKNOWN' AND funds_risk_state='UNKNOWN'`,
            [now, row.recharge_attempt_id]
          );
          await connection.query(
            `UPDATE orders
             SET status='RECHARGE_PROCESSING', version=version+1,
                 failure_code=NULL, failure_reason=NULL, updated_at=?
             WHERE id=? AND status='SUBMIT_UNKNOWN' AND version=?`,
            [now, row.order_id, row.order_version]
          );
          await connection.query(
            `INSERT INTO order_events
             (order_id, from_status, to_status, actor_type, actor_id, reason,
              metadata_json, created_at)
             VALUES (?, 'SUBMIT_UNKNOWN', 'RECHARGE_PROCESSING', 'SYSTEM', NULL,
               'Browser payment confirmed by bounded verification', ?, ?)`,
            [row.order_id, json({ browserRunId: run, evidenceHash: evidence }), now]
          );
        }
        await transitionCardConsumptionInTransaction(connection, {
          orderId: row.order_id,
          rechargeAttemptId: row.recharge_attempt_id,
          targetStatus: 'CONSUMED',
          allowedCurrentStatuses: ['RESERVED', 'RECONCILIATION'],
          requireActive: false,
          evidence: { source: 'browser_payment_confirmed', browserRunId: run, evidenceHash: evidence }
        });
        await connection.query(
          `UPDATE card_assignment_history SET status='RELEASED', released_by='browser:payment-confirmed',
             release_reason='payment confirmed; capacity ledger retains consumption', released_at=?
           WHERE order_id=? AND status='ACTIVE'`, [now, row.order_id]
        );
        await connection.query(
          `UPDATE cards c INNER JOIN orders o ON o.assigned_card_id=c.id
           SET c.inventory_status='DEPLETED', c.current_balance=NULL,
               c.last_transaction_synced_at=NULL, c.updated_at=?
           WHERE o.id=?`, [now, row.order_id]
        );
        return publicRun({ ...row, payment_state: 'PAYMENT_CONFIRMED' }, {
          runStatus: 'RUNNING', verificationState: 'VERIFYING_PAYMENT',
          verificationStartedAt: row.verification_started_at || now,
          verificationDeadlineAt: deadline, verificationNextCheckAt: nextCheck,
          attemptStatus: confirmingUnknown ? 'SUBMITTING' : row.attempt_status,
          fundsRiskState: confirmingUnknown ? 'ACTIVE' : row.funds_risk_state,
          orderStatus: confirmingUnknown ? 'RECHARGE_PROCESSING' : row.order_status,
          postPaymentState: 'PLUS_PENDING', idempotentReplay: false
        });
      });
    },

    async recordPaymentVerificationObservation({ runId, operationId, outcome,
      evidenceHash, nextCheckAt = null, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const result = requireCode(outcome, 'outcome');
      if (!['UNKNOWN', 'CONFIRMED', 'DECLINED', 'CONFLICT'].includes(result)) {
        throw new BrowserExecutionError('unsupported verification outcome', 'INVALID_ARGUMENT');
      }
      const evidence = requireHash(evidenceHash, 'evidenceHash');
      const nextCheck = nextCheckAt == null ? null : new Date(nextCheckAt);
      if (nextCheck && !Number.isFinite(nextCheck.getTime())) {
        throw new BrowserExecutionError('nextCheckAt is invalid', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) return { runId: run, outcome: result, idempotentReplay: true };
        const row = await lockRunContext(connection, run);
        if (!['PAYMENT_UNKNOWN', 'PAYMENT_CONFIRMED'].includes(row.payment_state)
          || row.verification_state !== 'VERIFYING_PAYMENT') {
          throw new BrowserExecutionError('payment is not being verified', 'PAYMENT_NOT_VERIFYING');
        }
        await connection.query(
          `INSERT INTO browser_post_payment_observations
           (browser_run_id, observation_kind, observation_status, evidence_hash,
            evidence_json, observed_at)
           VALUES (?, 'PAYMENT_VERIFICATION', ?, ?, ?, ?)`,
          [run, result, evidence, json({ evidenceHash: evidence }), now]
        );
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PAYMENT_VERIFICATION', 'COMMITTED', ?, ?, ?, ?)`,
          [run, operation, result, json({ evidenceHash: evidence }), now, now]
        );
        await connection.query(
          `UPDATE browser_runs
           SET verification_check_count=verification_check_count+1,
               verification_next_check_at=?, updated_at=?
           WHERE id=? AND verification_state='VERIFYING_PAYMENT'`,
          [nextCheck, now, run]
        );
        return { runId: run, outcome: result,
          verificationCheckCount: Number(row.verification_check_count || 0) + 1,
          idempotentReplay: false };
      });
    },

    async escalatePaymentVerification({ runId, operationId, reasonCode,
      evidenceHash, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const reason = requireCode(reasonCode, 'reasonCode');
      const evidence = requireHash(evidenceHash, 'evidenceHash');
      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) return publicRun(await lockRunContext(connection, run), { idempotentReplay: true });
        const row = await lockRunContext(connection, run);
        if (!['PAYMENT_UNKNOWN', 'PAYMENT_CONFIRMED'].includes(row.payment_state)
          || row.verification_state !== 'VERIFYING_PAYMENT') {
          throw new BrowserExecutionError('payment is not being verified', 'PAYMENT_NOT_VERIFYING');
        }
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PAYMENT_VERIFICATION_ESCALATED', 'COMMITTED', ?, ?, ?, ?)`,
          [run, operation, reason, json({ evidenceHash: evidence }), now, now]
        );
        await connection.query(
          `UPDATE browser_runs SET status='HUMAN_REQUIRED',
             verification_state='HUMAN_REQUIRED', verification_next_check_at=NULL,
             last_error_code=?, updated_at=?
           WHERE id=? AND status IN ('RECONCILE_ONLY','RUNNING')
             AND payment_state IN ('PAYMENT_UNKNOWN','PAYMENT_CONFIRMED')
             AND verification_state='VERIFYING_PAYMENT'`, [reason, now, run]
        );
        await connection.query(
          `INSERT INTO reconciliation_cases
           (id, case_type, status, severity, dedupe_key, order_id,
            recharge_attempt_id, evidence_json, detected_at, updated_at)
           VALUES (?, 'BROWSER_PAYMENT_UNKNOWN', 'OPEN', 'critical', ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE last_seen_at=VALUES(detected_at),
             evidence_json=VALUES(evidence_json), updated_at=VALUES(updated_at)`,
          [randomUUID(), `browser-payment-unknown:${row.recharge_attempt_id}`,
            row.order_id, row.recharge_attempt_id,
            json({ browserRunId: run, reasonCode: reason, evidenceHash: evidence }), now, now]
        );
        return publicRun({ ...row, run_status: 'HUMAN_REQUIRED',
          verification_state: 'HUMAN_REQUIRED' }, { idempotentReplay: false });
      });
    },

    async markPaymentDeclinedAfterVerification({ runId, operationId, reasonCode,
      evidenceHash, now = new Date() }) {
      const run = required(runId, 'runId');
      const operation = required(operationId, 'operationId');
      const reason = requireCode(reasonCode, 'reasonCode');
      const evidence = requireHash(evidenceHash, 'evidenceHash');
      return inTransaction(pool, async (connection) => {
        const prior = await existingOperation(connection, run, operation);
        if (prior) return publicRun(await lockRunContext(connection, run), { idempotentReplay: true });
        const row = await lockRunContext(connection, run);
        if (row.payment_state !== 'PAYMENT_UNKNOWN'
          || row.verification_state !== 'VERIFYING_PAYMENT'
          || row.attempt_status !== 'SUBMIT_UNKNOWN'
          || row.funds_risk_state !== 'UNKNOWN') {
          throw new BrowserExecutionError('payment is not being verified', 'PAYMENT_NOT_VERIFYING');
        }
        const sequence = await appendCheckpoint(connection, row, {
          kind: 'PAYMENT_DECLINED_VERIFIED', risk: 'NONE', operationId: operation,
          now, evidence: { reasonCode: reason, evidenceHash: evidence }
        });
        await connection.query(
          `INSERT INTO browser_operations
           (browser_run_id, operation_id, operation_type, status, result_code,
            public_result_json, prepared_at, completed_at)
           VALUES (?, ?, 'PAYMENT_DECLINED_VERIFIED', 'COMMITTED', ?, ?, ?, ?)`,
          [run, operation, reason, json({ evidenceHash: evidence }), now, now]
        );
        await connection.query(
          `UPDATE browser_runs SET status='FAILED_SAFE', payment_state='PAYMENT_DECLINED',
             verification_state='RESOLVED', verification_next_check_at=NULL,
             last_checkpoint_sequence=?, last_checkpoint_kind='PAYMENT_DECLINED_VERIFIED',
             last_error_code=?, finished_at=?, updated_at=?
           WHERE id=? AND status='RECONCILE_ONLY'
             AND payment_state='PAYMENT_UNKNOWN' AND verification_state='VERIFYING_PAYMENT'`,
          [sequence, reason, now, now, run]
        );
        await connection.query(
          `UPDATE recharge_attempts SET status='FAILED', funds_risk_state='CLEARED',
             result_summary_json=?, finished_at=?, updated_at=?
           WHERE id=? AND status='SUBMIT_UNKNOWN' AND funds_risk_state='UNKNOWN'`,
          [json({ code: reason, browserRunId: run, evidenceHash: evidence }),
            now, now, row.recharge_attempt_id]
        );
        await transitionCardConsumptionInTransaction(connection, {
          orderId: row.order_id,
          rechargeAttemptId: row.recharge_attempt_id,
          targetStatus: 'RELEASED',
          allowedCurrentStatuses: ['RECONCILIATION'],
          requireActive: false,
          evidence: { source: 'browser_payment_declined_verified', browserRunId: run,
            reasonCode: reason, evidenceHash: evidence }
        });
        await connection.query(
          `UPDATE card_assignment_history SET status='RELEASED',
             released_by='browser:payment-verification', release_reason=?, released_at=?
           WHERE order_id=? AND status='ACTIVE'`,
          ['payment decline verified with account still free', now, row.order_id]
        );
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status='RECHARGE_FAILED', version=version+1,
             failure_code=?, failure_reason='Browser payment was definitively declined',
             finished_at=?, updated_at=?
           WHERE id=? AND status='SUBMIT_UNKNOWN' AND version=?`,
          [reason, now, now, row.order_id, row.order_version]
        );
        if (orderUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('order changed concurrently', 'ORDER_CONFLICT');
        }
        await connection.query(
          `INSERT INTO order_events
           (order_id, from_status, to_status, actor_type, actor_id, reason,
            metadata_json, created_at)
           VALUES (?, 'SUBMIT_UNKNOWN', 'RECHARGE_FAILED', 'SYSTEM', NULL,
             'Browser payment decline verified; account remains free', ?, ?)`,
          [row.order_id, json({ browserRunId: run, evidenceHash: evidence }), now]
        );
        return publicRun({ ...row, run_status: 'FAILED_SAFE',
          payment_state: 'PAYMENT_DECLINED', verification_state: 'RESOLVED',
          attempt_status: 'FAILED', funds_risk_state: 'CLEARED',
          order_status: 'RECHARGE_FAILED' }, { idempotentReplay: false });
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
          kind: 'PLUS_ACTIVATED', risk: 'SETTLED', operationId: operation,
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
          kind: 'CANCELLATION_CONFIRMED', risk: 'SETTLED', operationId: operation,
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
               verification_state = 'RESOLVED', verification_next_check_at = NULL,
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
           SET status = 'SUCCESS', funds_risk_state = 'SETTLED', finished_at = ?, updated_at = ?
           WHERE id = ? AND executor_kind = 'BROWSER' AND status = 'SUBMITTING' AND funds_risk_state = 'ACTIVE'`,
          [now, now, row.recharge_attempt_id]
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('funds attempt changed concurrently', 'ATTEMPT_CONFLICT');
        }
        const [orderUpdate] = await connection.query(
          `UPDATE orders
           SET status = 'RECHARGE_SUCCESS', version = version + 1, finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'RECHARGE_PROCESSING' AND version = ?`,
          [now, now, row.order_id, row.order_version]
        );
        if (orderUpdate.affectedRows !== 1) {
          throw new BrowserExecutionError('order changed concurrently', 'ORDER_CONFLICT');
        }
        await connection.query(
          `INSERT INTO order_events
           (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json, created_at)
           VALUES (?, 'RECHARGE_PROCESSING', 'RECHARGE_SUCCESS', 'SYSTEM', NULL,
             'Browser Plus activation and cancellation confirmed', ?, ?)`,
          [row.order_id, json({ browserRunId: run, attemptId: row.recharge_attempt_id, evidenceHash: evidence }), now]
        );
        await connection.query(
          `UPDATE browser_dispatch_jobs
           SET status='COMPLETED', completed_at=COALESCE(completed_at, ?),
               lease_owner=NULL, lease_token_hash=NULL, lease_until=NULL, updated_at=?
           WHERE recharge_attempt_id=? AND status IN ('QUEUED','CLAIMED')`,
          [now, now, row.recharge_attempt_id]
        );
        return publicRun({
          ...row, run_status: 'COMPLETED', payment_state: 'PAYMENT_CONFIRMED',
          attempt_status: 'SUCCESS', funds_risk_state: 'SETTLED', order_status: 'RECHARGE_SUCCESS'
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
