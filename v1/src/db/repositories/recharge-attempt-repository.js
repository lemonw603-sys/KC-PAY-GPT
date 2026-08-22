import { randomUUID } from 'node:crypto';

export class RechargeAttemptError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'RechargeAttemptError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
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

function required(value, name, code = 'INVALID_ARGUMENT') {
  const normalized = String(value || '').trim();
  if (!normalized) throw new RechargeAttemptError(`${name} is required`, code);
  return normalized;
}

function safeSummary(value) {
  return value == null ? null : JSON.stringify(value);
}

async function insertEvent(connection, {
  orderId, fromStatus, toStatus, reason, now, metadata = null
}) {
  await connection.query(
    `INSERT INTO order_events
     (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, 'SYSTEM', NULL, ?, ?, ?)`,
    [orderId, fromStatus, toStatus, reason, safeSummary(metadata), now]
  );
}

async function lockAttemptContext(connection, attemptId) {
  const [rows] = await connection.query(
    `SELECT rat.id, rat.order_id, rat.authorization_item_id, rat.provider_account_id,
            rat.status AS attempt_status, rat.funds_risk_state,
            o.status AS order_status, o.version AS order_version
     FROM recharge_attempts rat
     INNER JOIN orders o ON o.id = rat.order_id
     WHERE rat.id = ?
     FOR UPDATE`,
    [attemptId]
  );
  if (rows.length !== 1) throw new RechargeAttemptError('recharge attempt not found', 'ATTEMPT_NOT_FOUND');
  return rows[0];
}

async function updateOrder(connection, row, toStatus, now, extraSql = '', extraValues = []) {
  if (row.order_status === toStatus) return;
  const [result] = await connection.query(
    `UPDATE orders
     SET status = ?, version = version + 1, updated_at = ?${extraSql}
     WHERE id = ? AND status = ? AND version = ?`,
    [toStatus, now, ...extraValues, row.order_id, row.order_status, row.order_version]
  );
  if (result.affectedRows !== 1) {
    throw new RechargeAttemptError('order changed concurrently', 'ORDER_CONFLICT');
  }
}

export function createRechargeAttemptRepository(pool) {
  return {
    async beginAuthorizedAttempt({
      orderId,
      taskId,
      authorizationItemId,
      attemptId = randomUUID(),
      now = new Date()
    }) {
      const order = required(orderId, 'orderId');
      const task = required(taskId, 'taskId');
      const requestedItem = authorizationItemId == null
        ? null : required(authorizationItemId, 'authorizationItemId');
      const attempt = required(attemptId, 'attemptId');

      return inTransaction(pool, async (connection) => {
        const [tasks] = await connection.query(
          `SELECT id, order_id, status, attempts
           FROM tasks
           WHERE id = ? AND order_id = ? AND task_type = 'SUBMIT_RECHARGE'
           FOR UPDATE`,
          [task, order]
        );
        if (tasks.length !== 1) throw new RechargeAttemptError('submit task not found', 'TASK_NOT_FOUND');
        if (tasks[0].status !== 'RUNNING') {
          throw new RechargeAttemptError('submit task is not running', 'TASK_NOT_RUNNING');
        }

        const [orders] = await connection.query(
          `SELECT o.id, o.status, o.version, o.fulfillment_route_id,
                  o.minimum_required_card_balance,
                  fr.executor_kind, fr.recharge_provider_account_id,
                  pa.provider_code, pa.write_enabled,
                  c.status AS card_status, c.current_balance AS card_balance,
                  c.card_credentials_ciphertext,
                  c.last_synced_at AS card_last_synced_at,
                  EXISTS (
                    SELECT 1 FROM tasks prepared
                    WHERE prepared.order_id = o.id
                      AND prepared.task_type = 'PREPARE_RECHARGE'
                      AND prepared.status = 'COMPLETED'
                  ) AS prepayment_ready
           FROM orders o
           LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
           LEFT JOIN provider_accounts pa ON pa.id = fr.recharge_provider_account_id
           LEFT JOIN cards c ON c.order_id = o.id
           WHERE o.id = ?
           FOR UPDATE`,
          [order]
        );
        if (orders.length !== 1) throw new RechargeAttemptError('order not found', 'ORDER_NOT_FOUND');
        const orderRow = orders[0];
        const [runtimeSettings] = await connection.query(
          `SELECT setting_key, setting_value
           FROM app_settings
           WHERE setting_key IN ('dispatch_new_recharges', 'recharge_dispatch_mode')
           ORDER BY setting_key
           FOR UPDATE`
        );
        const settings = Object.fromEntries(
          runtimeSettings.map((row) => [row.setting_key, row.setting_value])
        );
        if (settings.dispatch_new_recharges !== 'true') {
          throw new RechargeAttemptError('recharge dispatch is disabled', 'DISPATCH_DISABLED');
        }
        const dispatchMode = String(settings.recharge_dispatch_mode || '').trim().toUpperCase();
        if (!['AUTOMATIC', 'MANUAL'].includes(dispatchMode)) {
          throw new RechargeAttemptError('recharge dispatch mode is invalid', 'DISPATCH_MODE_INVALID');
        }
        if (orderRow.status !== 'CARD_READY') {
          throw new RechargeAttemptError('order is not ready for recharge', 'ORDER_NOT_READY');
        }
        const isBrowserRoute = String(orderRow.executor_kind || '').toUpperCase() === 'BROWSER';
        if (!orderRow.fulfillment_route_id
          || (!isBrowserRoute && (!orderRow.recharge_provider_account_id || !orderRow.provider_code))) {
          throw new RechargeAttemptError('order has no executable recharge route', 'ROUTE_NOT_EXECUTABLE');
        }
        if (!isBrowserRoute && !Number(orderRow.write_enabled)) {
          throw new RechargeAttemptError('recharge provider account is write-disabled', 'PROVIDER_WRITE_DISABLED');
        }
        if (!Number(orderRow.prepayment_ready)) {
          throw new RechargeAttemptError('recharge preparation is not complete', 'PREPAYMENT_NOT_READY');
        }
        const cardSyncedAt = orderRow.card_last_synced_at
          ? new Date(orderRow.card_last_synced_at).getTime() : NaN;
        if (!Number.isFinite(cardSyncedAt) || now.getTime() - cardSyncedAt > 15 * 60_000) {
          throw new RechargeAttemptError('card verification is stale', 'CARD_CHECK_STALE');
        }
        const cardActive = ['active', 'available', 'usable', 'ready']
          .includes(String(orderRow.card_status || '').toLowerCase());
        if (!cardActive
          || Number(orderRow.card_balance) < Number(orderRow.minimum_required_card_balance)
          || !orderRow.card_credentials_ciphertext) {
          throw new RechargeAttemptError('card is not ready for recharge', 'CARD_NOT_READY');
        }

        const [existingAttempts] = await connection.query(
          `SELECT id, funds_risk_state
           FROM recharge_attempts
           WHERE order_id = ? AND funds_risk_state IN ('ACTIVE', 'UNKNOWN', 'SETTLED')
           FOR UPDATE`,
          [order]
        );
        if (existingAttempts.length) {
          throw new RechargeAttemptError('order already has a funds-risk attempt', 'FUNDS_FENCE_EXISTS');
        }

        const [legacyCalls] = await connection.query(
          `SELECT id
           FROM provider_calls
           WHERE order_id = ? AND recharge_attempt_id IS NULL
             AND LOWER(provider) = 'zzshu' AND operation = 'create_direct'
           FOR UPDATE`,
          [order]
        );
        if (legacyCalls.length) {
          throw new RechargeAttemptError('legacy provider create call already exists', 'LEGACY_CREATE_ALREADY_ATTEMPTED');
        }

        let [authorizationItems] = await connection.query(
          `SELECT rai.id, rai.order_id, rai.status AS item_status,
                  ra.id AS authorization_id, ra.authorization_mode,
                  ra.status AS authorization_status, ra.expires_at
           FROM recharge_authorization_items rai
           INNER JOIN recharge_authorizations ra ON ra.id = rai.authorization_id
           WHERE ${requestedItem ? 'rai.id = ? AND ' : ''}rai.order_id = ?
             ${requestedItem ? '' : "AND rai.status = 'PENDING' AND ra.status = 'ACTIVE' AND ra.expires_at > ?"}
             ${dispatchMode === 'MANUAL' ? "AND ra.authorization_mode IN ('SINGLE', 'BATCH')" : ''}
           ORDER BY rai.created_at DESC
           LIMIT 1 FOR UPDATE`,
          requestedItem ? [requestedItem, order] : [order, now]
        );

        if (!requestedItem && authorizationItems.length === 0 && dispatchMode === 'MANUAL') {
          throw new RechargeAttemptError(
            'manual dispatch mode requires an explicit authorization',
            'MANUAL_AUTHORIZATION_REQUIRED'
          );
        }

        if (!requestedItem && authorizationItems.length === 0) {
          // Expired/revoked manual items must not keep the generated protected
          // order key occupied.  This cleanup and the automatic authorization
          // are committed in the same transaction as the funds fence.
          await connection.query(
            `UPDATE recharge_authorization_items rai
             INNER JOIN recharge_authorizations ra ON ra.id = rai.authorization_id
             SET rai.status = 'EXPIRED'
             WHERE rai.order_id = ? AND rai.status = 'PENDING'
               AND (ra.status <> 'ACTIVE' OR ra.expires_at <= ?)`,
            [order, now]
          );
          const automaticAuthorizationId = randomUUID();
          const automaticItemId = randomUUID();
          const expiresAt = new Date(now.getTime() + (15 * 60 * 1_000));
          await connection.query(
            `INSERT INTO recharge_authorizations
             (id, authorization_mode, status, authorized_by, reason, max_orders, expires_at, created_at)
             VALUES (?, 'AUTOMATIC', 'ACTIVE', 'system:worker',
               'Automatic fulfillment after order and funds-fence checks', 1, ?, ?)`,
            [automaticAuthorizationId, expiresAt, now]
          );
          await connection.query(
            `INSERT INTO recharge_authorization_items
             (id, authorization_id, order_id, status, created_at)
             VALUES (?, ?, ?, 'PENDING', ?)`,
            [automaticItemId, automaticAuthorizationId, order, now]
          );
          authorizationItems = [{
            id: automaticItemId,
            order_id: order,
            item_status: 'PENDING',
            authorization_id: automaticAuthorizationId,
            authorization_mode: 'AUTOMATIC',
            authorization_status: 'ACTIVE',
            expires_at: expiresAt
          }];
        }

        if (authorizationItems.length !== 1) {
          throw new RechargeAttemptError('authorization item not found', 'AUTHORIZATION_NOT_FOUND');
        }
        const authorization = authorizationItems[0];
        if (dispatchMode === 'MANUAL'
          && !['SINGLE', 'BATCH'].includes(authorization.authorization_mode)) {
          throw new RechargeAttemptError(
            'manual dispatch mode requires a single or batch authorization',
            'MANUAL_AUTHORIZATION_REQUIRED'
          );
        }
        const item = authorization.id;
        // A cleared attempt remains in the immutable funds ledger.  The key
        // therefore belongs to the single-use authorization item, not to the
        // order: retrying the same item stays idempotent, while a newly
        // authorized attempt after Session replacement receives a fresh key.
        const idempotencyKey = `recharge-auth-item:${item}`.slice(0, 191);
        if (authorization.item_status !== 'PENDING' || authorization.authorization_status !== 'ACTIVE') {
          throw new RechargeAttemptError('authorization is not active', 'AUTHORIZATION_NOT_ACTIVE');
        }
        if (new Date(authorization.expires_at).getTime() <= now.getTime()) {
          throw new RechargeAttemptError('authorization has expired', 'AUTHORIZATION_EXPIRED');
        }

        await connection.query(
          `INSERT INTO recharge_attempts
           (id, order_id, fulfillment_route_id, provider_account_id, authorization_item_id,
            executor_kind, status, funds_risk_state, idempotency_key, submit_intent_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'PREPARED', 'ACTIVE', ?, ?, ?, ?)`,
          [attempt, order, orderRow.fulfillment_route_id, orderRow.recharge_provider_account_id,
            item, orderRow.executor_kind, idempotencyKey,
            now, now, now]
        );

        const [itemUpdate] = await connection.query(
          `UPDATE recharge_authorization_items
           SET status = 'CONSUMED', consumed_attempt_id = ?, consumed_at = ?
           WHERE id = ? AND order_id = ? AND status = 'PENDING'`,
          [attempt, now, item, order]
        );
        if (itemUpdate.affectedRows !== 1) {
          throw new RechargeAttemptError('authorization changed concurrently', 'AUTHORIZATION_CONFLICT');
        }
        if (authorization.authorization_mode === 'AUTOMATIC') {
          const [authorizationUpdate] = await connection.query(
            `UPDATE recharge_authorizations
             SET status = 'CONSUMED'
             WHERE id = ? AND authorization_mode = 'AUTOMATIC' AND status = 'ACTIVE'`,
            [authorization.authorization_id]
          );
          if (authorizationUpdate.affectedRows !== 1) {
            throw new RechargeAttemptError('automatic authorization changed concurrently', 'AUTHORIZATION_CONFLICT');
          }
        }

        await updateOrder(connection, {
          ...orderRow,
          order_id: orderRow.id,
          order_status: orderRow.status,
          order_version: orderRow.version
        }, 'SUBMITTING', now);
        await insertEvent(connection, {
          orderId: order,
          fromStatus: 'CARD_READY',
          toStatus: 'SUBMITTING',
          reason: 'Recharge authorization consumed; recharge submit intent persisted',
          now,
          metadata: {
            attemptId: attempt,
            executorKind: orderRow.executor_kind,
            authorizationMode: authorization.authorization_mode,
            dispatchMode
          }
        });

        let providerCallId = null;
        if (!isBrowserRoute) {
          const [providerCall] = await connection.query(
            `INSERT INTO provider_calls
             (order_id, recharge_attempt_id, provider, provider_account_id, operation,
              request_key, attempt_no, outcome, started_at)
             VALUES (?, ?, ?, ?, 'create_direct', ?, 1, 'STARTED', ?)`,
            [order, attempt, orderRow.provider_code, orderRow.recharge_provider_account_id,
              idempotencyKey, now]
          );
          providerCallId = providerCall.insertId;
        }

        return {
          id: attempt,
          orderId: order,
          authorizationItemId: item,
          authorizationMode: authorization.authorization_mode,
          dispatchMode,
          providerAccountId: orderRow.recharge_provider_account_id,
          executorKind: orderRow.executor_kind,
          status: 'PREPARED',
          fundsRiskState: 'ACTIVE',
          providerCallId,
          idempotencyKey,
          startedAt: now
        };
      });
    },

    markAttemptSubmitted(input) {
      const externalOrderId = required(input?.externalOrderId, 'externalOrderId');
      const externalReference = required(input?.externalReference, 'externalReference');
      return transitionAttempt(pool, {
        ...input,
        externalOrderId,
        externalReference,
        targetAttemptStatus: 'PROCESSING',
        targetFundsState: 'ACTIVE',
        targetOrderStatus: 'RECHARGE_PROCESSING',
        providerOutcome: 'SUCCESS',
        reason: 'recharge submission acknowledged by executor',
        allowedAttemptStatuses: ['PREPARED'],
        allowedFundsStates: ['ACTIVE'],
        setSubmittedAt: true,
        persistSubmission: true
      });
    },

    markAttemptUnknown(input) {
      return transitionAttempt(pool, {
        ...input,
        targetAttemptStatus: 'SUBMIT_UNKNOWN',
        targetFundsState: 'UNKNOWN',
        targetOrderStatus: 'SUBMIT_UNKNOWN',
        providerOutcome: 'UNCERTAIN',
        reason: 'recharge submission outcome is unknown',
        allowedAttemptStatuses: ['PREPARED', 'PROCESSING'],
        allowedFundsStates: ['ACTIVE']
      });
    },

    markAttemptCleared(input) {
      return transitionAttempt(pool, {
        ...input,
        targetAttemptStatus: 'CLEARED',
        targetFundsState: 'CLEARED',
        targetOrderStatus: 'CARD_READY',
        providerOutcome: 'FAILED',
        reason: 'recharge attempt proven to have no funds impact; authorization released',
        allowedAttemptStatuses: ['PREPARED', 'PROCESSING', 'SUBMIT_UNKNOWN'],
        allowedFundsStates: ['ACTIVE', 'UNKNOWN'],
        releaseAuthorization: true,
        resetSubmitTask: input?.resetSubmitTask !== false,
        setFinishedAt: true
      });
    },

    markAttemptRejected(input) {
      return transitionAttempt(pool, {
        ...input,
        targetAttemptStatus: 'CLEARED',
        targetFundsState: 'CLEARED',
        targetOrderStatus: 'RECHARGE_FAILED',
        providerOutcome: 'FAILED',
        reason: 'recharge submission was definitively rejected before funds impact',
        allowedAttemptStatuses: ['PREPARED', 'PROCESSING'],
        allowedFundsStates: ['ACTIVE'],
        releaseAuthorization: true,
        resetSubmitTask: false,
        setFinishedAt: true,
        orderExtraSql: `, failure_code = 'RECHARGE_SUBMIT_REJECTED',
          failure_reason = 'Recharge provider rejected submission',
          customer_action_code = NULL, finished_at = ?`,
        orderExtraValues: [input?.now || new Date()]
      });
    }
  };
}

async function transitionAttempt(pool, {
  attemptId,
  externalOrderId = undefined,
  externalReference = undefined,
  resultSummary = null,
  now = new Date(),
  targetAttemptStatus,
  targetFundsState,
  targetOrderStatus,
  providerOutcome,
  reason,
  allowedAttemptStatuses,
  allowedFundsStates,
  setSubmittedAt = false,
  setFinishedAt = false,
  releaseAuthorization = false,
  resetSubmitTask = false,
  persistSubmission = false,
  orderExtraSql = '',
  orderExtraValues = []
}) {
  const id = required(attemptId, 'attemptId');
  return inTransaction(pool, async (connection) => {
    const row = await lockAttemptContext(connection, id);

    if (row.attempt_status === targetAttemptStatus
      && row.funds_risk_state === targetFundsState
      && row.order_status === targetOrderStatus) {
      return {
        id,
        orderId: row.order_id,
        status: targetAttemptStatus,
        fundsRiskState: targetFundsState,
        orderStatus: targetOrderStatus
      };
    }
    if (!allowedAttemptStatuses.includes(row.attempt_status)
      || !allowedFundsStates.includes(row.funds_risk_state)) {
      throw new RechargeAttemptError(
        `invalid recharge attempt transition from ${row.attempt_status}/${row.funds_risk_state}`,
        'INVALID_ATTEMPT_TRANSITION'
      );
    }

    const assignments = ['status = ?', 'funds_risk_state = ?', 'result_summary_json = ?', 'updated_at = ?'];
    const values = [targetAttemptStatus, targetFundsState, safeSummary(resultSummary), now];
    if (externalOrderId !== undefined) {
      assignments.push('external_order_id = ?');
      values.push(externalOrderId == null ? null : String(externalOrderId).slice(0, 191));
    }
    if (externalReference !== undefined) {
      assignments.push('external_reference = ?');
      values.push(externalReference == null ? null : String(externalReference).slice(0, 255));
    }
    if (setSubmittedAt) {
      assignments.push('submitted_at = COALESCE(submitted_at, ?)');
      values.push(now);
    }
    if (setFinishedAt) {
      assignments.push('finished_at = COALESCE(finished_at, ?)');
      values.push(now);
    }
    values.push(id);
    await connection.query(
      `UPDATE recharge_attempts SET ${assignments.join(', ')} WHERE id = ?`,
      values
    );

    if (releaseAuthorization && row.authorization_item_id) {
      const [released] = await connection.query(
        `UPDATE recharge_authorization_items
         SET status = 'RELEASED'
         WHERE id = ? AND consumed_attempt_id = ? AND status = 'CONSUMED'`,
        [row.authorization_item_id, id]
      );
      if (released.affectedRows !== 1) {
        throw new RechargeAttemptError('consumed authorization could not be released', 'AUTHORIZATION_CONFLICT');
      }
      if (resetSubmitTask) {
        const [taskReset] = await connection.query(
          `UPDATE tasks
           SET status = 'PENDING', attempts = 0, available_at = ?, leased_until = NULL,
               leased_by = NULL, last_error_code = NULL, last_error_message = NULL,
               completed_at = NULL, updated_at = ?
           WHERE order_id = ? AND task_type = 'SUBMIT_RECHARGE'`,
          [now, now, row.order_id]
        );
        if (taskReset.affectedRows !== 1) {
          throw new RechargeAttemptError('submit task could not be reset for re-authorization', 'TASK_RESET_FAILED');
        }
      }
    }

    const submissionSql = persistSubmission ? ', recharge_order_no = ?, recharge_card_key = ?' : '';
    const submissionValues = persistSubmission ? [externalOrderId, externalReference] : [];
    await updateOrder(connection, row, targetOrderStatus, now,
      `${submissionSql}${orderExtraSql}`, [...submissionValues, ...orderExtraValues]);
    if (persistSubmission) {
      await connection.query(
        `UPDATE cards SET card_credentials_ciphertext = NULL,
           updated_at = CURRENT_TIMESTAMP(3) WHERE order_id = ?`,
        [row.order_id]
      );
      await connection.query(
        `INSERT INTO tasks
         (order_id, task_type, status, dedupe_key, max_attempts, available_at)
         VALUES (?, 'POLL_RECHARGE', 'PENDING', ?, 720,
                 DATE_ADD(?, INTERVAL 3 SECOND))
         ON DUPLICATE KEY UPDATE id = id`,
        [row.order_id, `poll-recharge:${row.order_id}`, now]
      );
    }
    await insertEvent(connection, {
      orderId: row.order_id,
      fromStatus: row.order_status,
      toStatus: targetOrderStatus,
      reason,
      now,
      metadata: { attemptId: id, fundsRiskState: targetFundsState }
    });
    await connection.query(
      `UPDATE provider_calls
       SET outcome = ?, response_summary_json = ?, finished_at = COALESCE(finished_at, ?),
           duration_ms = COALESCE(duration_ms, TIMESTAMPDIFF(MICROSECOND, started_at, ?) DIV 1000)
       WHERE recharge_attempt_id = ? AND outcome = 'STARTED'`,
      [providerOutcome, safeSummary(resultSummary), now, now, id]
    );

    return {
      id,
      orderId: row.order_id,
      status: targetAttemptStatus,
      fundsRiskState: targetFundsState,
      orderStatus: targetOrderStatus
    };
  });
}
