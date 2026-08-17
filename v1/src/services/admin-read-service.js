import { PublicApiError } from '../domain/public-api-error.js';

const ORDER_STATUSES = new Set([
  'CREATED',
  'CARD_PURCHASING',
  'CARD_READY',
  'SUBMITTING',
  'SUBMIT_UNKNOWN',
  'RECHARGE_PROCESSING',
  'RECHARGE_SUCCESS',
  'RECHARGE_FAILED',
  'RECONCILIATION_REQUIRED',
  'CLOSED'
]);
const REVIEW_STATUSES = ['SUBMIT_UNKNOWN', 'RECHARGE_FAILED', 'RECONCILIATION_REQUIRED'];

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
  if (status && status !== 'REVIEW_REQUIRED' && !ORDER_STATUSES.has(status)) {
    throw new PublicApiError('Invalid status', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  if (query.length > 191) {
    throw new PublicApiError('Query too long', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  return { page, pageSize, status, query };
}

export function createAdminReadService({ pool }) {
  async function getOverview() {
    const [[orderCounts], [statusRows], [cdkRows], [settingsRows], [refundRows]] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) AS total,
        SUM(o.created_at >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) - INTERVAL 8 HOUR) AS today,
        SUM(o.status = 'RECHARGE_SUCCESS' OR (o.status = 'CLOSED' AND EXISTS (
          SELECT 1 FROM order_events oe
          WHERE oe.order_id = o.id AND oe.to_status = 'RECHARGE_SUCCESS'
        ))) AS successful,
        SUM(o.status IN ('CREATED','CARD_PURCHASING','CARD_READY','SUBMITTING','RECHARGE_PROCESSING')) AS processing,
        SUM(o.status IN ('SUBMIT_UNKNOWN','RECHARGE_FAILED','RECONCILIATION_REQUIRED')) AS reviewing
        FROM orders o`),
      pool.query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY status'),
      pool.query('SELECT status, COUNT(*) AS count FROM cdks GROUP BY status ORDER BY status'),
      pool.query(`SELECT setting_key, setting_value, updated_at FROM app_settings
        WHERE setting_key IN ('accept_new_orders','dispatch_new_recharges','poll_existing_orders','sync_card_transactions')
        ORDER BY setting_key`),
      pool.query(`SELECT status, COUNT(*) AS count FROM refund_cases
        WHERE status <> 'WITHDRAWN' GROUP BY status ORDER BY status`)
    ]);
    const count = (value) => Number(value || 0);
    const total = count(orderCounts[0]?.total);
    const successful = count(orderCounts[0]?.successful);
    return {
      metrics: {
        totalOrders: total,
        todayOrders: count(orderCounts[0]?.today),
        successfulOrders: successful,
        processingOrders: count(orderCounts[0]?.processing),
        reviewingOrders: count(orderCounts[0]?.reviewing),
        successRate: total === 0 ? null : Number(((successful / total) * 100).toFixed(1))
      },
      orderStatuses: statusRows.map((row) => ({ status: row.status, count: count(row.count) })),
      cdkStatuses: cdkRows.map((row) => ({ status: row.status, count: count(row.count) })),
      refundStatuses: refundRows.map((row) => ({ status: row.status, count: count(row.count) })),
      settings: settingsRows.map((row) => ({
        key: row.setting_key,
        value: row.setting_value,
        updatedAt: iso(row.updated_at)
      }))
    };
  }

  async function listOrders(input) {
    const { page, pageSize, status, query } = parseListQuery(input);
    const conditions = [];
    const values = [];
    if (status === 'REVIEW_REQUIRED') {
      conditions.push(`o.status IN (${REVIEW_STATUSES.map(() => '?').join(', ')})`);
      values.push(...REVIEW_STATUSES);
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
          c.last4, c.current_balance, c.currency, c.refund_status
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
        failureCode: row.failure_code,
        card: row.last4 ? {
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
    const [[orderRows], [eventRows], [taskRows], [callRows], [refundRows]] = await Promise.all([
      pool.query(`SELECT o.id, o.public_no, o.status, o.plan_type, o.customer_email,
          o.chatgpt_account_id, o.card_type_id, o.open_card_amount,
          o.recharge_order_no, o.failure_code, o.failure_reason,
          o.created_at, o.updated_at, o.finished_at,
          c.provider_card_id, c.last4, c.status AS card_status, c.funded_amount,
          c.current_balance, c.currency, c.refund_status, c.last_synced_at
        FROM orders o LEFT JOIN cards c ON c.order_id = o.id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo]),
      pool.query(`SELECT oe.from_status, oe.to_status, oe.actor_type, oe.actor_id,
          oe.reason, oe.created_at FROM order_events oe
        INNER JOIN orders o ON o.id = oe.order_id
        WHERE BINARY o.public_no = ? ORDER BY oe.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT t.task_type, t.status, t.attempts, t.max_attempts,
          t.available_at, t.leased_until, t.last_error_code, t.last_error_message,
          t.created_at, t.updated_at, t.completed_at FROM tasks t
        INNER JOIN orders o ON o.id = t.order_id
        WHERE BINARY o.public_no = ? ORDER BY t.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT pc.provider, pc.operation, pc.attempt_no, pc.http_status,
          pc.business_code, pc.outcome, pc.started_at, pc.finished_at, pc.duration_ms
        FROM provider_calls pc INNER JOIN orders o ON o.id = pc.order_id
        WHERE BINARY o.public_no = ? ORDER BY pc.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT r.status, r.expected_amount, r.confirmed_amount, r.currency,
          r.detected_at, r.confirmed_at, r.withdrawn_at, r.operator_note, r.updated_at
        FROM refund_cases r INNER JOIN orders o ON o.id = r.order_id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo])
    ]);
    const row = orderRows[0];
    if (!row) throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
    return {
      order: {
        publicNo: row.public_no,
        status: row.status,
        planType: row.plan_type,
        customerEmail: row.customer_email,
        chatgptAccountId: row.chatgpt_account_id,
        cardTypeId: row.card_type_id,
        openCardAmount: decimal(row.open_card_amount),
        rechargeOrderNo: row.recharge_order_no,
        failureCode: row.failure_code,
        failureReason: row.failure_reason,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        finishedAt: iso(row.finished_at)
      },
      card: row.provider_card_id ? {
        providerCardId: row.provider_card_id,
        last4: row.last4,
        status: row.card_status,
        fundedAmount: decimal(row.funded_amount),
        currentBalance: decimal(row.current_balance),
        currency: row.currency,
        refundStatus: row.refund_status,
        lastSyncedAt: iso(row.last_synced_at)
      } : null,
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

  return { getOrder, getOverview, listOrders };
}
