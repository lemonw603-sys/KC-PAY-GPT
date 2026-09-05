import { createHash } from 'node:crypto';

import { decryptSecret } from '../../v1/src/security/secret-box.js';
import { validateChatGptSession } from '../../v1/src/domain/session-validation.js';
import { assertRef, assertSafeObject } from './contracts.js';
import { BrowserExecutionService } from './executor.js';
import { CookieSessionBootstrapAdapter } from './session-bootstrap.js';

const TASK_TYPE = 'BROWSER_PREFLIGHT';
const ORDER_REF_PREFIX = 'browser-order:';
const ELIGIBLE_ORDER_STATUSES = Object.freeze(['CREATED', 'WAITING_FOR_CARD', 'CARD_READY']);
const CUSTOMER_ACTION_CODES = new Map([
  ['SESSION_INVALID', 'SESSION_INVALID'],
  ['SESSION_IDENTITY_MISMATCH', 'SESSION_INVALID'],
  ['ACCOUNT_ALREADY_PLUS', 'ACCOUNT_ALREADY_PLUS'],
]);

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeCode(error) {
  const value = String(error?.reason || error?.code || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : 'BROWSER_PREFLIGHT_FAILED';
}

function diagnosticDetails(error) {
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth += 1) {
    if (current?.details && typeof current.details === 'object') {
      return Object.fromEntries(Object.entries(current.details).filter(([key]) => (
        ['stage', 'httpStatus', 'contentType', 'server', 'hasCfRay'].includes(key)
      )));
    }
  }
  return null;
}

function orderIdFromRef(ref) {
  assertRef(ref, 'orderRef');
  if (!ref.startsWith(ORDER_REF_PREFIX)) throw new TypeError(`orderRef must use ${ORDER_REF_PREFIX}`);
  return assertRef(ref.slice(ORDER_REF_PREFIX.length), 'orderId');
}

function queryRunner(db) {
  if (!db || (typeof db.query !== 'function' && typeof db.execute !== 'function')) {
    throw new TypeError('db must expose query or execute');
  }
  return db.execute?.bind(db) || db.query.bind(db);
}

/** Session source scoped to a Browser order before any card/funds attempt exists. */
export class BrowserOrderEncryptedSessionSource {
  constructor({ db, encryptionKey, now = () => Date.now() } = {}) {
    if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
      throw new TypeError('encryptionKey must be a 32-byte Buffer');
    }
    this.runQuery = queryRunner(db);
    this.encryptionKey = Buffer.from(encryptionKey);
    this.now = now;
  }

  async load(orderRef) {
    const orderId = orderIdFromRef(orderRef);
    let rows;
    try {
      [rows] = await this.runQuery(
        `SELECT o.status, o.session_ciphertext, fr.executor_kind
         FROM orders o
         INNER JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
         WHERE o.id = ? LIMIT 1`,
        [orderId],
      );
    } catch (cause) {
      const error = new Error('Browser preflight Session source is temporarily unavailable', { cause });
      error.code = 'BROWSER_PREFLIGHT_SOURCE_UNAVAILABLE';
      throw error;
    }
    const row = rows?.[0];
    if (!row || row.executor_kind !== 'BROWSER' || !ELIGIBLE_ORDER_STATUSES.includes(row.status)) {
      const error = new Error('order is not available for Browser preflight');
      error.code = 'BROWSER_PREFLIGHT_CONTEXT_UNAVAILABLE';
      throw error;
    }
    if (!row.session_ciphertext) {
      const error = new Error('stored Browser Session is unavailable');
      error.code = 'SESSION_INVALID';
      throw error;
    }
    try {
      const stored = JSON.parse(decryptSecret(row.session_ciphertext, this.encryptionKey));
      const validated = validateChatGptSession(stored, { now: this.now });
      return { sessionToken: validated.session.sessionToken };
    } catch (error) {
      const wrapped = new Error('stored Browser Session is unavailable or invalid', { cause: error });
      wrapped.code = 'SESSION_INVALID';
      throw wrapped;
    }
  }
}

export function browserOrderMaterialRef(orderId) {
  return `${ORDER_REF_PREFIX}${assertRef(orderId, 'orderId')}`;
}

export function summarizeBrowserPreflight(result) {
  const summary = {
    schemaVersion: 1,
    outcome: 'PASSED',
    observedAt: new Date().toISOString(),
    account: {
      loggedIn: result?.sessionIdentity?.loggedIn === true,
      identityMatched: result?.sessionIdentity?.identityMatched === true,
      subscriptionStatus: result?.sessionIdentity?.subscriptionStatus || null,
      alreadyPlus: result?.sessionIdentity?.alreadyPlus === true,
      httpStatus: result?.sessionIdentity?.httpStatus ?? null,
      subscriptionHttpStatus: result?.sessionIdentity?.subscriptionHttpStatus ?? null,
    },
    checkout: {
      recognized: result?.checkout?.recognized === true,
      currency: result?.checkout?.currency || null,
      amount: result?.checkout?.amount || null,
      estimatedTax: result?.checkout?.estimatedTax || null,
      paymentFormPresent: result?.checkout?.paymentFormPresent === true,
      submitControlPresent: result?.checkout?.submitControlPresent === true,
      secureCardFieldsPresent: result?.checkout?.cardFieldsPresent || null,
    },
    navigation: {
      plusEntryPresent: result?.checkoutNavigation?.plusEntryPresent === true,
      checkoutCreated: result?.checkoutNavigation?.checkoutCreated === true,
      questionnaireSkipped: result?.checkoutNavigation?.questionnaireSkipped === true,
    },
    submitCalls: Number(result?.submitCalls || 0),
  };
  assertSafeObject(summary, 'Browser preflight summary');
  if (summary.submitCalls !== 0) throw new Error('Browser preflight observed a payment submit call');
  return summary;
}

export class BrowserOrderPreflightRepository {
  constructor({ pool, workerId, executorProfileId, leaseSeconds = 120 } = {}) {
    if (!pool?.getConnection || !pool?.query) throw new TypeError('mysql2-like pool is required');
    this.pool = pool;
    this.workerId = required(workerId, 'workerId');
    this.executorProfileId = required(executorProfileId, 'executorProfileId');
    this.leaseSeconds = leaseSeconds;
  }

  async claim() {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT t.id AS task_id, t.order_id, t.attempts, t.max_attempts
         FROM tasks t
         INNER JOIN orders o ON o.id = t.order_id
         INNER JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
         INNER JOIN executor_profiles ep ON ep.id = ?
         WHERE t.task_type = ?
           AND t.available_at <= CURRENT_TIMESTAMP(3)
           AND (t.status = 'PENDING'
             OR (t.status = 'RUNNING' AND t.leased_until < CURRENT_TIMESTAMP(3)))
           AND o.status IN ('CREATED','WAITING_FOR_CARD','CARD_READY')
           AND fr.executor_kind = 'BROWSER'
           AND ep.executor_kind = 'BROWSER' AND ep.status = 'ACTIVE'
         ORDER BY t.available_at ASC, t.id ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [this.executorProfileId, TASK_TYPE],
      );
      if (rows.length === 0) {
        await connection.commit();
        return null;
      }
      const task = rows[0];
      const [updated] = await connection.query(
        `UPDATE tasks SET status='RUNNING', leased_by=?,
           leased_until=DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
           attempts=attempts+1, updated_at=CURRENT_TIMESTAMP(3)
         WHERE id=? AND (status='PENDING'
           OR (status='RUNNING' AND leased_until < CURRENT_TIMESTAMP(3)))`,
        [this.workerId, this.leaseSeconds, task.task_id],
      );
      if (Number(updated.affectedRows) !== 1) throw new Error('Browser preflight task claim raced');
      await connection.commit();
      return { ...task, attempts: Number(task.attempts) + 1 };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async loadIdentity(orderId) {
    const [[row]] = await this.pool.query(
      `SELECT NULLIF(TRIM(chatgpt_account_id), '') AS account_id,
              NULLIF(LOWER(TRIM(customer_email)), '') AS email
       FROM orders WHERE id=? LIMIT 1`,
      [orderId],
    );
    const identity = {
      ...(row?.account_id ? { accountIdDigest: sha256(row.account_id) } : {}),
      ...(row?.email ? { emailDigest: sha256(row.email) } : {}),
    };
    if (Object.keys(identity).length === 0) throw new Error('order has no Browser identity digest');
    return identity;
  }

  async assertAndRenew(taskId) {
    const [result] = await this.pool.query(
      `UPDATE tasks SET leased_until=DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
         updated_at=CURRENT_TIMESTAMP(3)
       WHERE id=? AND task_type=? AND status='RUNNING' AND leased_by=?
         AND leased_until >= CURRENT_TIMESTAMP(3)`,
      [this.leaseSeconds, taskId, TASK_TYPE, this.workerId],
    );
    return Number(result.affectedRows) === 1;
  }

  async complete(task, summary) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[order]] = await connection.query(
        `SELECT status FROM orders WHERE id=? FOR UPDATE`, [task.order_id],
      );
      if (!order || !ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
        throw new Error('order left Browser preflight state before completion');
      }
      const [updated] = await connection.query(
        `UPDATE tasks SET status='COMPLETED', payload_json=?, leased_by=NULL,
           leased_until=NULL, last_error_code=NULL, last_error_message=NULL,
           completed_at=CURRENT_TIMESTAMP(3), updated_at=CURRENT_TIMESTAMP(3)
         WHERE id=? AND task_type=? AND status='RUNNING' AND leased_by=?`,
        [JSON.stringify(summary), task.task_id, TASK_TYPE, this.workerId],
      );
      if (Number(updated.affectedRows) !== 1) throw new Error('Browser preflight lease lost before completion');
      await connection.query(
        `INSERT INTO order_events
         (order_id,from_status,to_status,actor_type,actor_id,reason,metadata_json)
         VALUES (?,?,?,'WORKER',?,'Browser Session and Checkout preflight passed before card assignment',?)`,
        [task.order_id, order.status, order.status, this.workerId,
          JSON.stringify({ taskId: task.task_id, ...summary })],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async fail(task, error) {
    const code = normalizeCode(error);
    const customerActionCode = CUSTOMER_ACTION_CODES.get(code) || null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[order]] = await connection.query(
        `SELECT status,version FROM orders WHERE id=? FOR UPDATE`, [task.order_id],
      );
      const [[leased]] = await connection.query(
        `SELECT attempts,max_attempts FROM tasks
         WHERE id=? AND task_type=? AND status='RUNNING' AND leased_by=? FOR UPDATE`,
        [task.task_id, TASK_TYPE, this.workerId],
      );
      if (!order || !leased) throw new Error('Browser preflight lease or order was lost');
      if (customerActionCode && ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
        const diagnostic = diagnosticDetails(error);
        const [[setting]] = await connection.query(
          `SELECT setting_value FROM app_settings
           WHERE setting_key='session_replacement_window_hours' LIMIT 1`,
        );
        const hours = Math.max(1, Math.min(168, Number(setting?.setting_value || 72)));
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status='WAITING_FOR_SESSION', failure_code=?,
             failure_reason='Browser preflight requires a replacement Session',
             customer_action_code=?,
             session_repair_started_at=COALESCE(session_repair_started_at,CURRENT_TIMESTAMP(3)),
             session_repair_expires_at=COALESCE(session_repair_expires_at,
               DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)),
             version=version+1, updated_at=CURRENT_TIMESTAMP(3)
           WHERE id=? AND version=?`,
          [code, customerActionCode, hours, task.order_id, order.version],
        );
        if (Number(orderUpdate.affectedRows) !== 1) throw new Error('Browser preflight order transition raced');
        const payload = { schemaVersion: 1, outcome: 'CUSTOMER_ACTION_REQUIRED', reasonCode: code };
        await connection.query(
          `UPDATE tasks SET status='COMPLETED',payload_json=?,leased_by=NULL,leased_until=NULL,
             last_error_code=?,last_error_message='Browser preflight requires customer action',
             completed_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3)
           WHERE id=?`,
          [JSON.stringify(payload), code, task.task_id],
        );
        await connection.query(
          `INSERT INTO order_events
           (order_id,from_status,to_status,actor_type,actor_id,reason,metadata_json)
           VALUES (?,?,'WAITING_FOR_SESSION','WORKER',?,
             'Browser preflight requires a replacement Session',?)`,
          [task.order_id, order.status, this.workerId,
            JSON.stringify({ taskId: task.task_id, reasonCode: code, customerActionCode, ...(diagnostic ? { diagnostic } : {}) })],
        );
        await connection.commit();
        return { status: 'CUSTOMER_ACTION_REQUIRED', reasonCode: code };
      }
      const exhausted = Number(leased.attempts) >= Number(leased.max_attempts);
      const nextStatus = exhausted ? 'DEAD' : 'PENDING';
      await connection.query(
        `UPDATE tasks SET status=?,available_at=IF(?='PENDING',
             DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 30 SECOND),available_at),
           leased_by=NULL,leased_until=NULL,last_error_code=?,
           last_error_message='Browser preflight stopped safely before payment',
           updated_at=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [nextStatus, nextStatus, code, task.task_id],
      );
      if (exhausted) {
        await connection.query(
          `INSERT INTO order_events
           (order_id,from_status,to_status,actor_type,actor_id,reason,metadata_json)
           VALUES (?,?,?,'WORKER',?,'Browser preflight exhausted without payment',?)`,
          [task.order_id, order.status, order.status, this.workerId,
            JSON.stringify({ taskId: task.task_id, reasonCode: code })],
        );
      }
      await connection.commit();
      return { status: nextStatus, reasonCode: code };
    } catch (failure) {
      await connection.rollback();
      throw failure;
    } finally {
      connection.release();
    }
  }
}

export function createBrowserOrderPreflightWorker({
  pool,
  workerId,
  executorProfileId,
  runtimeAdapter,
  manifest,
  observation,
  encryptionKey,
  evidenceSink,
  leaseSeconds = 120,
  executionTimeoutMs = 30_000,
} = {}) {
  const repository = new BrowserOrderPreflightRepository({
    pool, workerId, executorProfileId, leaseSeconds,
  });
  const sessionProvider = new CookieSessionBootstrapAdapter({
    source: new BrowserOrderEncryptedSessionSource({ db: pool, encryptionKey }),
  });
  const executor = new BrowserExecutionService({
    runtimeAdapter, sessionProvider, evidenceSink, timeoutMs: executionTimeoutMs,
  });
  return Object.freeze({
    async runOnce() {
      const task = await repository.claim();
      if (!task) return { status: 'IDLE', externalPaymentCalls: 0 };
      try {
        const job = {
          schemaVersion: 1,
          jobId: `brpreflight:${task.order_id}:${task.task_id}`,
          orderRef: `order:${task.order_id}`,
          attemptRef: `preflight:${task.task_id}`,
          profileRef: `profile:${executorProfileId}`,
          state: 'RUNNING',
          manifest,
          metadata: {
            ...observation,
            sessionRef: browserOrderMaterialRef(task.order_id),
            sessionIdentity: await repository.loadIdentity(task.order_id),
          },
        };
        const result = await executor.execute(job, {
          assertLease: () => repository.assertAndRenew(task.task_id),
        });
        const summary = summarizeBrowserPreflight(result);
        await repository.complete(task, summary);
        return { status: 'COMPLETED', taskId: task.task_id, summary, externalPaymentCalls: 0 };
      } catch (error) {
        const outcome = await repository.fail(task, error);
        return { ...outcome, taskId: task.task_id, externalPaymentCalls: 0 };
      }
    },
  });
}

export { TASK_TYPE as BROWSER_PREFLIGHT_TASK_TYPE };
