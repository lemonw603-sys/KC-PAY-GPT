import { PublicApiError } from '../domain/public-api-error.js';
import crypto from 'node:crypto';
import { decryptSecret } from '../security/secret-box.js';
import { validateChatGptSession } from '../domain/session-validation.js';

const ORDER_STATUSES = new Set([
  'CREATED',
  'CARD_PURCHASING',
  'CARD_PROVISIONING',
  'CARD_READY',
  'CARD_FAILED',
  'SUBMITTING',
  'SUBMIT_UNKNOWN',
  'RECHARGE_PROCESSING',
  'RECHARGE_SUCCESS',
  'RECHARGE_FAILED',
  'RECONCILIATION_REQUIRED',
  'CLOSED'
]);
const REVIEW_STATUSES = ['CARD_FAILED', 'SUBMIT_UNKNOWN', 'RECHARGE_FAILED', 'RECONCILIATION_REQUIRED'];
const PROCESSING_STATUSES = ['CREATED', 'CARD_PURCHASING', 'CARD_PROVISIONING', 'SUBMITTING', 'RECHARGE_PROCESSING'];
const VIRTUAL_FILTERS = new Set(['TODAY', 'PROCESSING', 'AWAITING_CONFIRMATION', 'REVIEW_REQUIRED']);

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function decimal(value) {
  return value == null ? null : String(value);
}

function parseListQuery(input = {}) {
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  const status = String(input.status || '').trim();
  const query = String(input.q || '').trim();
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    throw new PublicApiError('Invalid page', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new PublicApiError('Invalid page size', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  if (status && !VIRTUAL_FILTERS.has(status) && !ORDER_STATUSES.has(status)) {
    throw new PublicApiError('Invalid status', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  if (query.length > 191) {
    throw new PublicApiError('Query too long', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  return { page, pageSize, status, query };
}

function sessionSafety(row, key, now) {
  if (!Buffer.isBuffer(key) || !row.session_ciphertext) {
    return { valid: false, code: 'SESSION_UNAVAILABLE', sessionExpiresAt: null, accessTokenExpiresAt: null };
  }
  try {
    const session = JSON.parse(decryptSecret(row.session_ciphertext, key));
    const validated = validateChatGptSession(session, { now, minimumAccessTokenLifetimeSeconds: 300 });
    return {
      valid: true,
      code: null,
      sessionExpiresAt: session.expires,
      accessTokenExpiresAt: validated.accessTokenExpiresAt.toISOString()
    };
  } catch (error) {
    return { valid: false, code: error?.code || 'SESSION_INVALID', sessionExpiresAt: null, accessTokenExpiresAt: null };
  }
}

function cardNumber(row, key) {
  if (!Buffer.isBuffer(key)) return null;
  try {
    if (row.card_number_ciphertext) return decryptSecret(row.card_number_ciphertext, key);
    if (!row.card_credentials_ciphertext) return null;
    return JSON.parse(decryptSecret(row.card_credentials_ciphertext, key)).cardNumber || null;
  } catch {
    return null;
  }
}

export function createAdminReadService({ pool, sessionEncryptionKey = null, now = () => Date.now() }) {
  async function requestCardTransactionSync(publicNo) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new PublicApiError('Invalid public number', { code: 'INVALID_ADMIN_QUERY', status: 400 });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [settings] = await connection.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = 'sync_card_transactions' LIMIT 1`
      );
      if (settings.length !== 1 || settings[0].setting_value !== 'true') {
        throw new PublicApiError('Transaction sync is disabled', { code: 'ADMIN_SYNC_DISABLED', status: 409 });
      }
      const [rows] = await connection.query(
        `SELECT o.id, c.id AS card_id FROM orders o LEFT JOIN cards c ON c.order_id = o.id
         WHERE BINARY o.public_no = ? LIMIT 1 FOR UPDATE`, [publicNo]
      );
      if (rows.length !== 1) throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
      if (!rows[0].card_id) throw new PublicApiError('Order has no bound card', { code: 'ADMIN_CARD_NOT_BOUND', status: 409 });
      const [active] = await connection.query(
        `SELECT status FROM tasks WHERE order_id = ? AND task_type = 'SYNC_CARD_TRANSACTIONS'
         AND status IN ('PENDING', 'RUNNING') ORDER BY id DESC LIMIT 1`, [rows[0].id]
      );
      if (active.length) {
        await connection.commit();
        return { queued: false, taskStatus: active[0].status };
      }
      await connection.query(
        `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
         VALUES (?, 'SYNC_CARD_TRANSACTIONS', 'PENDING', ?, 5)`,
        [rows[0].id, `manual-sync:${rows[0].id}:${crypto.randomUUID()}`]
      );
      await connection.commit();
      return { queued: true, taskStatus: 'PENDING' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  async function getOverview() {
    const [[orderCounts], [statusRows], [cdkRows], [settingsRows], [refundRows], [alertRows], [stockRows], [stockSettingRows]] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) AS total,
        SUM(o.created_at >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) - INTERVAL 8 HOUR) AS today,
        SUM(o.status = 'RECHARGE_SUCCESS' OR (o.status = 'CLOSED' AND EXISTS (
          SELECT 1 FROM order_events oe
          WHERE oe.order_id = o.id AND oe.to_status = 'RECHARGE_SUCCESS'
        ))) AS successful,
        SUM(o.status IN ('CARD_FAILED','RECHARGE_FAILED') OR (o.status = 'CLOSED' AND NOT EXISTS (
          SELECT 1 FROM order_events oe
          WHERE oe.order_id = o.id AND oe.to_status = 'RECHARGE_SUCCESS'
        ))) AS completed_failed,
        SUM(o.status IN ('CREATED','CARD_PURCHASING','CARD_PROVISIONING','SUBMITTING','RECHARGE_PROCESSING')) AS processing,
        SUM(o.status = 'CARD_READY' AND EXISTS (
          SELECT 1 FROM tasks pt WHERE pt.order_id = o.id
            AND pt.task_type = 'PREPARE_RECHARGE' AND pt.status = 'COMPLETED'
        ) AND EXISTS (
          SELECT 1 FROM tasks st WHERE st.order_id = o.id
            AND st.task_type = 'SUBMIT_RECHARGE' AND st.status = 'PENDING' AND st.attempts = 0
        )) AS awaiting_confirmation,
        SUM(o.status IN ('CARD_FAILED','SUBMIT_UNKNOWN','RECHARGE_FAILED','RECONCILIATION_REQUIRED')
            OR o.cancellation_review_required = 1) AS reviewing
        FROM orders o`),
      pool.query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY status'),
      pool.query('SELECT status, COUNT(*) AS count FROM cdks GROUP BY status ORDER BY status'),
      pool.query(`SELECT setting_key, setting_value, updated_at FROM app_settings
        WHERE setting_key IN ('accept_new_orders','dispatch_new_recharges','poll_existing_orders','sync_card_transactions')
        ORDER BY setting_key`),
      pool.query(`SELECT status, COUNT(*) AS count FROM refund_cases
        WHERE status <> 'WITHDRAWN' GROUP BY status ORDER BY status`)
      ,pool.query(`SELECT COUNT(*) AS count FROM operator_alerts WHERE status = 'OPEN'`)
      ,pool.query(`SELECT
          SUM(order_id IS NULL AND inventory_status = 'AVAILABLE'
            AND LOWER(status) IN ('active','available','usable','ready')
            AND card_credentials_ciphertext IS NOT NULL
            AND current_balance >= COALESCE((SELECT CAST(setting_value AS DECIMAL(18,6))
              FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1), 999999999)) AS available,
          SUM(order_id IS NULL AND inventory_status = 'PROVISIONING') AS provisioning,
          SUM(order_id IS NOT NULL OR inventory_status = 'ASSIGNED') AS assigned,
          SUM(order_id IS NULL AND inventory_status = 'DEPLETED') AS depleted
        FROM cards`)
      ,pool.query(`SELECT setting_value FROM app_settings
        WHERE setting_key = 'card_stock_low_threshold' LIMIT 1`)
    ]);
    const count = (value) => Number(value || 0);
    const total = count(orderCounts[0]?.total);
    const successful = count(orderCounts[0]?.successful);
    const completed = successful + count(orderCounts[0]?.completed_failed);
    return {
      metrics: {
        totalOrders: total,
        todayOrders: count(orderCounts[0]?.today),
        successfulOrders: successful,
        processingOrders: count(orderCounts[0]?.processing),
        awaitingConfirmationOrders: count(orderCounts[0]?.awaiting_confirmation),
        reviewingOrders: count(orderCounts[0]?.reviewing),
        successRate: completed === 0 ? null : Number(((successful / completed) * 100).toFixed(1))
      },
      orderStatuses: statusRows.map((row) => ({ status: row.status, count: count(row.count) })),
      cdkStatuses: cdkRows.map((row) => ({ status: row.status, count: count(row.count) })),
      refundStatuses: refundRows.map((row) => ({ status: row.status, count: count(row.count) })),
      openAlertCount: count(alertRows[0]?.count),
      cardStock: {
        available: count(stockRows[0]?.available),
        provisioning: count(stockRows[0]?.provisioning),
        assigned: count(stockRows[0]?.assigned),
        depleted: count(stockRows[0]?.depleted),
        lowThreshold: count(stockSettingRows[0]?.setting_value || 5),
        low: count(stockRows[0]?.available) <= count(stockSettingRows[0]?.setting_value || 5)
      },
      settings: settingsRows.map((row) => ({
        key: row.setting_key,
        value: row.setting_value,
        updatedAt: iso(row.updated_at)
      }))
    };
  }

  async function listAlerts(input = {}) {
    const limit = Math.min(100, Math.max(1, Number(input.limit || 50)));
    const [rows] = await pool.query(
      `SELECT a.id, a.alert_type, a.severity, a.title, a.message, a.status,
              a.created_at, a.acknowledged_at, o.public_no, o.customer_email,
              o.recharge_order_no
       FROM operator_alerts a LEFT JOIN orders o ON o.id = a.order_id
       WHERE a.status = 'OPEN' ORDER BY a.created_at DESC LIMIT ?`, [limit]
    );
    return { alerts: rows.map((row) => ({
      id: row.id, type: row.alert_type, severity: row.severity, title: row.title,
      message: row.message, status: row.status, publicNo: row.public_no,
      customerEmail: row.customer_email, rechargeOrderNo: row.recharge_order_no,
      createdAt: iso(row.created_at), acknowledgedAt: iso(row.acknowledged_at)
    })) };
  }

  async function listOrders(input) {
    const { page, pageSize, status, query } = parseListQuery(input);
    const conditions = [];
    const values = [];
    if (status === 'REVIEW_REQUIRED') {
      conditions.push(`(o.status IN (${REVIEW_STATUSES.map(() => '?').join(', ')})
        OR o.cancellation_review_required = 1)`);
      values.push(...REVIEW_STATUSES);
    } else if (status === 'PROCESSING') {
      conditions.push(`o.status IN (${PROCESSING_STATUSES.map(() => '?').join(', ')})`);
      values.push(...PROCESSING_STATUSES);
    } else if (status === 'AWAITING_CONFIRMATION') {
      conditions.push(`o.status = 'CARD_READY' AND EXISTS (
        SELECT 1 FROM tasks pt WHERE pt.order_id = o.id
          AND pt.task_type = 'PREPARE_RECHARGE' AND pt.status = 'COMPLETED'
      ) AND EXISTS (
        SELECT 1 FROM tasks st WHERE st.order_id = o.id
          AND st.task_type = 'SUBMIT_RECHARGE' AND st.status = 'PENDING' AND st.attempts = 0
      )`);
    } else if (status === 'TODAY') {
      conditions.push(`o.created_at >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) - INTERVAL 8 HOUR`);
    } else if (status) {
      conditions.push('o.status = ?');
      values.push(status);
    }
    if (query) {
      conditions.push(`(o.public_no LIKE ? OR o.customer_email LIKE ? OR
        o.chatgpt_account_id LIKE ? OR o.recharge_order_no LIKE ?)`);
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM orders o ${where}`, values),
      pool.query(`SELECT o.public_no, o.status, o.customer_email, o.chatgpt_account_id,
          o.recharge_order_no, o.failure_code, o.created_at, o.updated_at, o.finished_at,
          o.actual_payment_amount, o.actual_payment_currency,
          o.subscription_cancelled, o.cancellation_checked_at, o.cancellation_review_required,
          c.last4, c.current_balance, c.currency, c.refund_status,
          c.card_number_ciphertext, c.card_credentials_ciphertext,
          (o.status = 'CARD_READY' AND EXISTS (
            SELECT 1 FROM tasks pt WHERE pt.order_id = o.id
              AND pt.task_type = 'PREPARE_RECHARGE' AND pt.status = 'COMPLETED'
          ) AND EXISTS (
            SELECT 1 FROM tasks st WHERE st.order_id = o.id
              AND st.task_type = 'SUBMIT_RECHARGE' AND st.status = 'PENDING' AND st.attempts = 0
          )) AS requires_recharge_confirmation,
          (SELECT pt.completed_at FROM tasks pt WHERE pt.order_id = o.id
            AND pt.task_type = 'PREPARE_RECHARGE' ORDER BY pt.id DESC LIMIT 1) AS confirmation_ready_at
        FROM orders o LEFT JOIN cards c ON c.order_id = o.id
        ${where}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize])
    ]);
    return {
      page,
      pageSize,
      total: Number(countRows[0]?.total || 0),
      orders: rows.map((row) => ({
        publicNo: row.public_no,
        status: row.status,
        customerEmail: row.customer_email,
        chatgptAccountId: row.chatgpt_account_id,
        rechargeOrderNo: row.recharge_order_no,
        actualPaymentAmount: decimal(row.actual_payment_amount),
        actualPaymentCurrency: row.actual_payment_currency,
        failureCode: row.failure_code,
        subscriptionCancelled: row.subscription_cancelled == null ? null : Number(row.subscription_cancelled),
        cancellationCheckedAt: iso(row.cancellation_checked_at),
        cancellationReviewRequired: Boolean(row.cancellation_review_required),
        requiresRechargeConfirmation: Boolean(row.requires_recharge_confirmation),
        confirmationReadyAt: iso(row.confirmation_ready_at),
        card: row.last4 ? {
          cardNumber: cardNumber(row, sessionEncryptionKey),
          last4: row.last4,
          currentBalance: decimal(row.current_balance),
          currency: row.currency,
          refundStatus: row.refund_status
        } : null,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        finishedAt: iso(row.finished_at)
      }))
    };
  }

  async function getOrder(publicNo) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new PublicApiError('Invalid public number', { code: 'INVALID_ADMIN_QUERY', status: 400 });
    }
    const [[orderRows], [eventRows], [taskRows], [callRows], [refundRows], [transactionRows], [compensationRows]] = await Promise.all([
      pool.query(`SELECT o.id, o.public_no, o.status, o.plan_type, o.customer_email,
          o.chatgpt_account_id, o.card_type_id, o.open_card_amount,
          o.minimum_required_card_balance, o.actual_payment_amount, o.actual_payment_currency,
          o.recharge_order_no, o.failure_code, o.failure_reason,
          o.subscription_cancelled, o.cancellation_checked_at, o.cancellation_review_required,
          o.created_at, o.updated_at, o.finished_at, o.session_ciphertext,
          c.provider_card_id, c.last4, c.status AS card_status, c.funded_amount,
          c.current_balance, c.currency, c.refund_status, c.last_synced_at,
          c.card_number_ciphertext, c.card_credentials_ciphertext
        FROM orders o LEFT JOIN cards c ON c.order_id = o.id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo]),
      pool.query(`SELECT oe.from_status, oe.to_status, oe.actor_type, oe.actor_id,
          oe.reason, oe.created_at FROM order_events oe
        INNER JOIN orders o ON o.id = oe.order_id
        WHERE BINARY o.public_no = ? ORDER BY oe.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT t.task_type, t.status, t.attempts, t.max_attempts,
          t.available_at, t.leased_until, t.last_error_code, t.last_error_message,
          t.created_at, t.updated_at, t.completed_at,
          JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.rechargePermit.status')) AS permit_status,
          JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.rechargePermit.expiresAt')) AS permit_expires_at
        FROM tasks t
        INNER JOIN orders o ON o.id = t.order_id
        WHERE BINARY o.public_no = ? ORDER BY t.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT pc.provider, pc.operation, pc.attempt_no, pc.http_status,
          pc.business_code, pc.outcome, pc.started_at, pc.finished_at, pc.duration_ms
        FROM provider_calls pc INNER JOIN orders o ON o.id = pc.order_id
        WHERE BINARY o.public_no = ? ORDER BY pc.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT r.status, r.expected_amount, r.confirmed_amount, r.currency,
          r.detected_at, r.confirmed_at, r.withdrawn_at, r.operator_note, r.updated_at
        FROM refund_cases r INNER JOIN orders o ON o.id = r.order_id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo]),
      pool.query(`SELECT ct.provider_transaction_id, ct.transaction_type, ct.status,
          ct.amount, ct.currency, ct.fee, ct.trade_time_raw, ct.related_txn_id,
          ct.settlement_status, ct.original_amount, ct.original_currency,
          ct.merchant_name, ct.merchant_country, ct.merchant_mcc,
          ct.first_seen_at, ct.last_seen_at
        FROM card_transactions ct
        INNER JOIN cards c ON c.id = ct.card_id
        INNER JOIN orders o ON o.id = c.order_id
        WHERE BINARY o.public_no = ? ORDER BY ct.id DESC LIMIT 200`, [publicNo]),
      pool.query(`SELECT oc.created_at, c.status AS replacement_status
        FROM order_compensations oc
        INNER JOIN orders o ON o.id = oc.original_order_id
        INNER JOIN cdks c ON c.id = oc.replacement_cdk_id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo])
    ]);
    const row = orderRows[0];
    if (!row) throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
    const prepareTask = taskRows.find((task) => task.task_type === 'PREPARE_RECHARGE');
    const submitTask = taskRows.find((task) => task.task_type === 'SUBMIT_RECHARGE');
    const session = sessionSafety(row, sessionEncryptionKey, now);
    const lastCardSync = row.last_synced_at ? new Date(row.last_synced_at).getTime() : NaN;
    const cardCheckFresh = Number.isFinite(lastCardSync) && now() - lastCardSync <= 15 * 60_000;
    const cardReady = ['active', 'available', 'usable', 'ready'].includes(String(row.card_status || '').toLowerCase())
      && Number(row.current_balance) >= Number(row.minimum_required_card_balance)
      && Boolean(row.card_credentials_ciphertext);
    const compensationRecord = compensationRows[0];
    const hasActiveTask = taskRows.some((task) => ['PENDING', 'RUNNING'].includes(task.status));
    const hasDeadTask = taskRows.some((task) => task.status === 'DEAD');
    let compensationCode = 'COMPENSATION_SIDE_EFFECT_RISK';
    if (compensationRecord) compensationCode = 'COMPENSATION_ALREADY_ISSUED';
    else if (row.status === 'CREATED' && !row.provider_card_id && callRows.length === 0 && hasActiveTask) {
      compensationCode = 'COMPENSATION_ORDER_STILL_ACTIVE';
    } else if (row.status === 'CREATED' && !row.provider_card_id && callRows.length === 0 && !hasDeadTask) {
      compensationCode = 'COMPENSATION_NOT_TERMINALLY_FAILED';
    } else if (row.status === 'CREATED' && !row.provider_card_id && callRows.length === 0 && hasDeadTask) {
      compensationCode = 'COMPENSATION_ELIGIBLE';
    }
    return {
      order: {
        publicNo: row.public_no,
        status: row.status,
        planType: row.plan_type,
        customerEmail: row.customer_email,
        chatgptAccountId: row.chatgpt_account_id,
        cardTypeId: row.card_type_id,
        openCardAmount: decimal(row.open_card_amount),
        minimumRequiredCardBalance: decimal(row.minimum_required_card_balance),
        actualPaymentAmount: decimal(row.actual_payment_amount),
        actualPaymentCurrency: row.actual_payment_currency,
        rechargeOrderNo: row.recharge_order_no,
        failureCode: row.failure_code,
        failureReason: row.failure_reason,
        subscriptionCancelled: row.subscription_cancelled == null ? null : Number(row.subscription_cancelled),
        cancellationCheckedAt: iso(row.cancellation_checked_at),
        cancellationReviewRequired: Boolean(row.cancellation_review_required),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        finishedAt: iso(row.finished_at)
      },
      card: row.provider_card_id ? {
        providerCardId: row.provider_card_id,
        cardNumber: cardNumber(row, sessionEncryptionKey),
        last4: row.last4,
        status: row.card_status,
        fundedAmount: decimal(row.funded_amount),
        currentBalance: decimal(row.current_balance),
        currency: row.currency,
        refundStatus: row.refund_status,
        lastSyncedAt: iso(row.last_synced_at)
      } : null,
      paymentGate: {
        prepaymentReady: prepareTask?.status === 'COMPLETED',
        submissionLocked: submitTask?.permit_status !== 'ARMED',
        permitStatus: submitTask?.permit_status || 'LOCKED',
        permitExpiresAt: submitTask?.permit_expires_at || null,
        submissionTaskStatus: submitTask?.status || null,
        submissionAttempts: submitTask ? Number(submitTask.attempts) : 0,
        sessionValid: session.valid,
        sessionCode: session.code,
        sessionExpiresAt: session.sessionExpiresAt,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        cardReady,
        cardCheckFresh
      },
      compensation: {
        eligible: compensationCode === 'COMPENSATION_ELIGIBLE',
        alreadyIssued: Boolean(compensationRecord),
        code: compensationCode,
        issuedAt: iso(compensationRecord?.created_at),
        replacementStatus: compensationRecord?.replacement_status || null
      },
      events: eventRows.map((event) => ({
        fromStatus: event.from_status,
        toStatus: event.to_status,
        actorType: event.actor_type,
        actorId: event.actor_id,
        reason: event.reason,
        createdAt: iso(event.created_at)
      })),
      tasks: taskRows.map((task) => ({
        type: task.task_type,
        status: task.status,
        attempts: Number(task.attempts),
        maxAttempts: Number(task.max_attempts),
        availableAt: iso(task.available_at),
        leasedUntil: iso(task.leased_until),
        lastErrorCode: task.last_error_code,
        lastErrorMessage: task.last_error_message,
        createdAt: iso(task.created_at),
        updatedAt: iso(task.updated_at),
        completedAt: iso(task.completed_at)
      })),
      providerCalls: callRows.map((call) => ({
        provider: call.provider,
        operation: call.operation,
        attemptNo: Number(call.attempt_no),
        httpStatus: call.http_status == null ? null : Number(call.http_status),
        businessCode: call.business_code,
        outcome: call.outcome,
        startedAt: iso(call.started_at),
        finishedAt: iso(call.finished_at),
        durationMs: call.duration_ms == null ? null : Number(call.duration_ms)
      })),
      transactions: transactionRows.map((transaction) => ({
        providerTransactionId: transaction.provider_transaction_id,
        type: transaction.transaction_type,
        status: transaction.status,
        amount: decimal(transaction.amount),
        currency: transaction.currency,
        fee: decimal(transaction.fee),
        tradeTimeRaw: transaction.trade_time_raw,
        relatedTransactionId: transaction.related_txn_id,
        settlementStatus: transaction.settlement_status,
        originalAmount: decimal(transaction.original_amount),
        originalCurrency: transaction.original_currency,
        merchantName: transaction.merchant_name,
        merchantCountry: transaction.merchant_country,
        merchantMcc: transaction.merchant_mcc,
        firstSeenAt: iso(transaction.first_seen_at),
        lastSeenAt: iso(transaction.last_seen_at)
      })),
      refund: refundRows[0] ? {
        status: refundRows[0].status,
        expectedAmount: decimal(refundRows[0].expected_amount),
        confirmedAmount: decimal(refundRows[0].confirmed_amount),
        currency: refundRows[0].currency,
        detectedAt: iso(refundRows[0].detected_at),
        confirmedAt: iso(refundRows[0].confirmed_at),
        withdrawnAt: iso(refundRows[0].withdrawn_at),
        operatorNote: refundRows[0].operator_note,
        updatedAt: iso(refundRows[0].updated_at)
      } : null
    };
  }

  return { getOrder, getOverview, listOrders, listAlerts, requestCardTransactionSync };
}
