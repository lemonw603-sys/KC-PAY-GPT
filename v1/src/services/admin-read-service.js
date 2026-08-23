import { PublicApiError } from '../domain/public-api-error.js';
import crypto from 'node:crypto';
import { decryptSecret } from '../security/secret-box.js';
import { validateChatGptSession } from '../domain/session-validation.js';
import { reconcileOrderEvidence } from '../domain/order-reconciliation.js';
import { createCdkLookup } from '../security/cdk-code.js';
import { eligibleInventoryCardSql } from './card-inventory-eligibility.js';

const ORDER_STATUSES = new Set([
  'CREATED',
  'CARD_PURCHASING',
  'CARD_PROVISIONING',
  'CARD_READY',
  'WAITING_FOR_CARD',
  'CARD_FAILED',
  'WAITING_FOR_SESSION',
  'SUBMITTING',
  'SUBMIT_UNKNOWN',
  'RECHARGE_PROCESSING',
  'RECHARGE_SUCCESS',
  'RECHARGE_FAILED',
  'CANCELLATION_PENDING',
  'CANCELLATION_REVIEW_REQUIRED',
  'RECONCILIATION_REQUIRED',
  'CLOSED'
]);
const REVIEW_STATUSES = ['CARD_FAILED', 'WAITING_FOR_SESSION', 'SUBMIT_UNKNOWN', 'RECHARGE_FAILED',
  'CANCELLATION_REVIEW_REQUIRED', 'RECONCILIATION_REQUIRED'];
const PROCESSING_STATUSES = ['CREATED', 'WAITING_FOR_CARD', 'CARD_PURCHASING', 'CARD_PROVISIONING', 'SUBMITTING',
  'RECHARGE_PROCESSING', 'CANCELLATION_PENDING'];
const VIRTUAL_FILTERS = new Set([
  'TODAY', 'PROCESSING', 'AWAITING_CONFIRMATION', 'REVIEW_REQUIRED', 'RECONCILIATION_ISSUES'
]);
const TIME_FIELDS = new Set(['CREATED', 'UPDATED', 'FINISHED', 'PAID', 'RECHARGE']);

const CREATE_ATTEMPTED_SQL = `EXISTS (SELECT 1 FROM provider_calls rpc
  WHERE rpc.order_id = o.id AND rpc.provider = 'zzshu' AND rpc.operation = 'create_direct')`;
const STALE_CREATE_ATTEMPT_SQL = `EXISTS (SELECT 1 FROM provider_calls rpcs
  WHERE rpcs.order_id = o.id AND rpcs.provider = 'zzshu' AND rpcs.operation = 'create_direct'
    AND rpcs.outcome = 'STARTED' AND rpcs.started_at < UTC_TIMESTAMP(3) - INTERVAL 2 MINUTE)`;
const SUCCESS_EVENT_SQL = `EXISTS (SELECT 1 FROM order_events roe
  WHERE roe.order_id = o.id AND roe.to_status = 'RECHARGE_SUCCESS')`;
const TRANSACTION_SYNCED_SQL = `EXISTS (SELECT 1 FROM cards rsc
  WHERE rsc.order_id = o.id AND rsc.last_transaction_synced_at IS NOT NULL)`;
const SUCCESSFUL_PURCHASE_SQL = `EXISTS (SELECT 1 FROM cards rpcard
  INNER JOIN card_transactions rpt ON rpt.card_id = rpcard.id
  WHERE rpcard.order_id = o.id AND LOWER(rpt.transaction_type) = 'purchase'
    AND LOWER(rpt.status) = 'success')`;
const PAYMENT_MATCH_SQL = `EXISTS (SELECT 1 FROM cards rmcard
  INNER JOIN card_transactions rmt ON rmt.card_id = rmcard.id
  WHERE rmcard.order_id = o.id AND LOWER(rmt.transaction_type) = 'purchase'
    AND LOWER(rmt.status) = 'success' AND (
      (UPPER(rmt.original_currency) = UPPER(o.actual_payment_currency)
        AND ABS(ABS(rmt.original_amount) - o.actual_payment_amount) <= 0.01)
      OR (UPPER(rmt.currency) = UPPER(o.actual_payment_currency)
        AND ABS(ABS(rmt.amount) - o.actual_payment_amount) <= 0.01)
    ))`;
const PAYMENT_SETTLED_SQL = `EXISTS (SELECT 1 FROM cards rsetcard
  INNER JOIN card_transactions rsett ON rsett.card_id = rsetcard.id
  WHERE rsetcard.order_id = o.id AND LOWER(rsett.transaction_type) = 'purchase'
    AND LOWER(rsett.status) = 'success' AND LOWER(COALESCE(rsett.settlement_status, '')) = 'settled'
    AND ((UPPER(rsett.original_currency) = UPPER(o.actual_payment_currency)
      AND ABS(ABS(rsett.original_amount) - o.actual_payment_amount) <= 0.01)
      OR (UPPER(rsett.currency) = UPPER(o.actual_payment_currency)
      AND ABS(ABS(rsett.amount) - o.actual_payment_amount) <= 0.01)))`;
const RECONCILIATION_ISSUE_SQL = `(o.status IN ('SUBMIT_UNKNOWN','RECONCILIATION_REQUIRED')
  OR (${STALE_CREATE_ATTEMPT_SQL})
  OR ((${CREATE_ATTEMPTED_SQL}) AND o.recharge_order_no IS NULL AND o.status <> 'SUBMITTING')
  OR (NOT (${CREATE_ATTEMPTED_SQL}) AND o.recharge_order_no IS NULL AND (${SUCCESSFUL_PURCHASE_SQL}))
  OR ((o.status = 'RECHARGE_SUCCESS' OR (${SUCCESS_EVENT_SQL})) AND (
    o.recharge_order_no IS NULL OR o.actual_payment_amount IS NULL OR o.actual_payment_currency IS NULL
    OR ((${TRANSACTION_SYNCED_SQL}) AND NOT (${PAYMENT_MATCH_SQL}))
  ))
  OR ((o.status = 'RECHARGE_FAILED' OR (o.status = 'CLOSED' AND NOT (${SUCCESS_EVENT_SQL})))
    AND (${SUCCESSFUL_PURCHASE_SQL})))`;

function reconciliationFromRow(row) {
  return reconcileOrderEvidence({
    orderStatus: row.status,
    rechargeOrderNo: row.recharge_order_no,
    createAttempted: Boolean(row.create_attempted),
    createAttemptStalled: Boolean(row.create_attempt_stalled),
    hasRechargeSuccessEvent: Boolean(row.has_recharge_success_event),
    actualPaymentAmount: row.actual_payment_amount,
    actualPaymentCurrency: row.actual_payment_currency,
    transactionEvidenceSynced: Boolean(row.transaction_evidence_synced),
    successfulPurchaseExists: Boolean(row.successful_purchase_exists),
    paymentMatched: Boolean(row.payment_matched),
    paymentSettled: Boolean(row.payment_settled)
  });
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function decimal(value) {
  return value == null ? null : String(value);
}

function transactionMatchesPayment(transaction, amount, currency) {
  const expected = Number(amount);
  const expectedCurrency = String(currency || '').toUpperCase();
  if (!Number.isFinite(expected) || !expectedCurrency) return false;
  const candidates = [
    [transaction.original_amount, transaction.original_currency],
    [transaction.amount, transaction.currency]
  ];
  return candidates.some(([candidateAmount, candidateCurrency]) =>
    String(candidateCurrency || '').toUpperCase() === expectedCurrency
      && Number.isFinite(Number(candidateAmount))
      && Math.abs(Math.abs(Number(candidateAmount)) - expected) <= 0.01);
}

function sumByCurrency(rows, amountField = 'amount', currencyField = 'currency') {
  const totals = new Map();
  for (const row of rows) {
    const raw = String(row[amountField] ?? '').trim();
    const currency = String(row[currencyField] || '').toUpperCase();
    const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
    if (!match || !currency) continue;
    const units = BigInt(`${match[1]}${match[2]}${(match[3] || '').padEnd(6, '0')}`);
    totals.set(currency, (totals.get(currency) || 0n) + units);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, units]) => {
      const sign = units < 0n ? '-' : '';
      const digits = (units < 0n ? -units : units).toString().padStart(7, '0');
      return { currency, amount: `${sign}${digits.slice(0, -6)}.${digits.slice(-6)}` };
    });
}

function parseListQuery(input = {}) {
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  const status = String(input.status || '').trim();
  const query = String(input.q || '').trim();
  const tag = String(input.tag || '').trim();
  const from = String(input.from || '').trim();
  const to = String(input.to || '').trim();
  const timeField = String(input.timeField || 'CREATED').trim().toUpperCase();
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
  if (tag.length > 64) {
    throw new PublicApiError('Tag too long', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  if (!TIME_FIELDS.has(timeField)) {
    throw new PublicApiError('Invalid time field', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  const parseBoundary = (value, name) => {
    if (!value) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new PublicApiError(`Invalid ${name}`, { code: 'INVALID_ADMIN_QUERY', status: 400 });
    }
    return new Date(timestamp);
  };
  const fromDate = parseBoundary(from, 'from');
  const toDate = parseBoundary(to, 'to');
  if (fromDate && toDate && fromDate > toDate) {
    throw new PublicApiError('Invalid time range', { code: 'INVALID_ADMIN_QUERY', status: 400 });
  }
  return { page, pageSize, status, query, tag, fromDate, toDate, timeField };
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

export function createAdminReadService({ pool, sessionEncryptionKey = null, cdkHashKey = null,
  panHmacKey = null, deliveryTrackingEnabled = false, now = () => Date.now() }) {
  async function getCard(providerCardId, input = {}) {
    const cardId = String(providerCardId || '').trim();
    if (!cardId || cardId.length > 128) {
      throw new PublicApiError('Invalid card ID', { code: 'INVALID_ADMIN_QUERY', status: 400 });
    }
    const providerAccountId = String(input.providerAccountId || '').trim();
    if (providerAccountId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(providerAccountId)) {
      throw new PublicApiError('Invalid provider account ID', { code: 'INVALID_ADMIN_QUERY', status: 400 });
    }
    const [cardRows] = await pool.query(`SELECT c.id, c.provider_account_id,
          c.provider_card_id, c.card_type_id, c.last4, c.status,
          c.inventory_status, c.funded_amount, c.current_balance, c.currency,
          c.refund_status, c.last_synced_at, c.last_transaction_synced_at,
          c.card_number_ciphertext, c.card_credentials_ciphertext,
          o.public_no, o.status AS order_status, o.customer_email
        FROM cards c LEFT JOIN orders o ON o.id = c.order_id
        WHERE BINARY c.provider_card_id = BINARY ?
          ${providerAccountId ? 'AND c.provider_account_id = ?' : ''}
        LIMIT 2`, providerAccountId ? [cardId, providerAccountId] : [cardId]);
    if (!cardRows.length) {
      throw new PublicApiError('Card not found', { code: 'ADMIN_CARD_NOT_FOUND', status: 404 });
    }
    if (cardRows.length > 1) {
      throw new PublicApiError('Card ID is ambiguous across provider accounts', {
        code: 'ADMIN_CARD_ID_AMBIGUOUS', status: 409
      });
    }
    const row = cardRows[0];
    const localCardId = row.id;
    const [[transactionRows], [eventRows], [jobRows], [assignmentRows]] = await Promise.all([
      pool.query(`SELECT ct.provider_transaction_id, ct.transaction_type, ct.status,
          ct.amount, ct.currency, ct.fee, ct.trade_time_raw, ct.related_txn_id,
          ct.settlement_status, ct.merchant_name, ct.merchant_country,
          ct.first_seen_at, ct.last_seen_at
        FROM card_transactions ct
        WHERE ct.card_id = ? ORDER BY ct.id DESC LIMIT 200`, [localCardId]),
      pool.query(`SELECT cse.event_type, cse.source, cse.previous_json,
          cse.current_json, cse.created_at
        FROM card_state_events cse
        WHERE cse.card_id = ? ORDER BY cse.id DESC LIMIT 100`, [localCardId]),
      pool.query(`SELECT csj.status, csj.attempts, csj.max_attempts,
          csj.error_code, csj.error_message, csj.created_at,
          csj.updated_at, csj.completed_at
        FROM card_sync_jobs csj
        WHERE csj.card_id = ? ORDER BY csj.created_at DESC LIMIT 20`, [localCardId])
      ,pool.query(`SELECT ah.assignment_kind, ah.status, ah.assigned_by,
          ah.assignment_reason, ah.assigned_at, ah.released_by, ah.release_reason,
          ah.released_at, o.public_no, o.status AS order_status, o.customer_email
        FROM card_assignment_history ah
        INNER JOIN orders o ON o.id = ah.order_id
        WHERE ah.card_id = ? ORDER BY ah.assigned_at DESC`, [localCardId])
    ]);
    return {
      card: {
        providerAccountId: row.provider_account_id,
        providerCardId: row.provider_card_id,
        cardTypeId: row.card_type_id,
        cardNumber: cardNumber(row, sessionEncryptionKey),
        last4: row.last4,
        status: row.status,
        inventoryStatus: row.inventory_status,
        fundedAmount: decimal(row.funded_amount),
        currentBalance: decimal(row.current_balance),
        currency: row.currency,
        refundStatus: row.refund_status,
        lastSyncedAt: iso(row.last_synced_at),
        lastTransactionSyncedAt: iso(row.last_transaction_synced_at)
      },
      order: row.public_no ? {
        publicNo: row.public_no, status: row.order_status,
        customerEmail: row.customer_email
      } : null,
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
        merchantName: transaction.merchant_name,
        merchantCountry: transaction.merchant_country,
        firstSeenAt: iso(transaction.first_seen_at),
        lastSeenAt: iso(transaction.last_seen_at)
      })),
      events: eventRows.map((event) => ({
        type: event.event_type, source: event.source,
        previous: event.previous_json, current: event.current_json,
        createdAt: iso(event.created_at)
      })),
      syncJobs: jobRows.map((job) => ({
        status: job.status, attempts: Number(job.attempts), maxAttempts: Number(job.max_attempts),
        errorCode: job.error_code, errorMessage: job.error_message,
        createdAt: iso(job.created_at), updatedAt: iso(job.updated_at),
        completedAt: iso(job.completed_at)
      })),
      assignmentHistory: assignmentRows.map((assignment) => ({
        kind: assignment.assignment_kind, status: assignment.status,
        publicNo: assignment.public_no, orderStatus: assignment.order_status,
        customerEmail: assignment.customer_email, assignedBy: assignment.assigned_by,
        assignmentReason: assignment.assignment_reason, assignedAt: iso(assignment.assigned_at),
        releasedBy: assignment.released_by, releaseReason: assignment.release_reason,
        releasedAt: iso(assignment.released_at)
      }))
    };
  }

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
    const [[orderCounts], [statusRows], [cdkRows], [settingsRows], [refundRows], [alertRows], [stockRows], [stockSettingRows], [backlogRows]] = await Promise.all([
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
        SUM(o.status IN ('CREATED','WAITING_FOR_CARD','CARD_PURCHASING','CARD_PROVISIONING','SUBMITTING','RECHARGE_PROCESSING','CANCELLATION_PENDING')) AS processing,
        (SELECT COUNT(*) FROM tasks rt
          WHERE rt.status = 'RUNNING' AND rt.leased_until < UTC_TIMESTAMP(3)) AS expired_task_leases,
        (SELECT COUNT(*) FROM provider_calls rp
          WHERE rp.outcome = 'STARTED' AND rp.started_at < UTC_TIMESTAMP(3) - INTERVAL 2 MINUTE) AS stalled_provider_calls,
        SUM(o.status = 'CARD_READY' AND EXISTS (
          SELECT 1 FROM tasks pt WHERE pt.order_id = o.id
            AND pt.task_type = 'PREPARE_RECHARGE' AND pt.status = 'COMPLETED'
        ) AND EXISTS (
          SELECT 1 FROM tasks st WHERE st.order_id = o.id
            AND st.task_type = 'SUBMIT_RECHARGE' AND st.status = 'PENDING' AND st.attempts = 0
        )) AS awaiting_confirmation,
        SUM(o.status IN ('CARD_FAILED','SUBMIT_UNKNOWN','RECHARGE_FAILED','RECONCILIATION_REQUIRED')
            OR o.cancellation_review_required = 1 OR (${STALE_CREATE_ATTEMPT_SQL})) AS reviewing
        ,SUM(o.status = 'WAITING_FOR_SESSION') AS waiting_for_session
        ,SUM(o.status = 'WAITING_FOR_CARD') AS waiting_for_card
        ,SUM(o.status = 'CANCELLATION_PENDING') AS cancellation_pending
        ,SUM(o.status = 'CANCELLATION_REVIEW_REQUIRED' OR o.cancellation_review_required = 1) AS cancellation_review
        ,SUM(${RECONCILIATION_ISSUE_SQL}) AS reconciliation_issues
        FROM orders o`),
      pool.query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY status'),
      pool.query('SELECT status, COUNT(*) AS count FROM cdks GROUP BY status ORDER BY status'),
      pool.query(`SELECT setting_key, setting_value, updated_at FROM app_settings
        WHERE setting_key IN ('accept_new_orders','dispatch_new_recharges','recharge_dispatch_mode','poll_existing_orders','sync_card_transactions','worker_heartbeat_at')
        ORDER BY setting_key`),
      pool.query(`SELECT status, COUNT(*) AS count FROM refund_cases
        WHERE status <> 'WITHDRAWN' GROUP BY status ORDER BY status`)
      ,pool.query(`SELECT COUNT(*) AS count FROM operator_alerts WHERE status = 'OPEN'`)
      ,pool.query(`SELECT
          SUM(${eligibleInventoryCardSql('cards', `COALESCE((SELECT CAST(setting_value AS DECIMAL(18,6))
              FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1), 999999999)`)}) AS available,
          SUM(order_id IS NULL AND inventory_status = 'PROVISIONING') AS provisioning,
          SUM(order_id IS NOT NULL OR inventory_status = 'ASSIGNED') AS assigned,
          SUM(order_id IS NULL AND inventory_status = 'DEPLETED') AS depleted,
          SUM(order_id IS NULL AND inventory_status = 'HELD_FOR_REVIEW') AS held,
          (SELECT synced_at FROM card_provider_snapshots WHERE provider = 'hnskj' LIMIT 1) AS provider_synced_at,
          (SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.accountBalance'))
             FROM card_provider_snapshots WHERE provider = 'hnskj' LIMIT 1) AS provider_account_balance,
          (SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.currency'))
             FROM card_provider_snapshots WHERE provider = 'hnskj' LIMIT 1) AS provider_currency,
          (SELECT fr.route_code
             FROM fulfillment_routes fr INNER JOIN products p ON p.id = fr.product_id
            WHERE p.product_code = 'chatgpt_plus' AND p.status = 'ACTIVE'
              AND fr.accepts_new_orders = 1 AND fr.retired_at IS NULL
            ORDER BY fr.route_version DESC, fr.created_at DESC LIMIT 1) AS provider_route_code,
          (SELECT pa.account_code
             FROM fulfillment_routes fr INNER JOIN products p ON p.id = fr.product_id
             INNER JOIN provider_accounts pa ON pa.id = fr.card_provider_account_id
            WHERE p.product_code = 'chatgpt_plus' AND p.status = 'ACTIVE'
              AND fr.accepts_new_orders = 1 AND fr.retired_at IS NULL
            ORDER BY fr.route_version DESC, fr.created_at DESC LIMIT 1) AS provider_account_code,
          (SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.purchaseEnabled'))
             FROM card_provider_snapshots WHERE provider = 'hnskj' LIMIT 1) AS provider_purchase_enabled
        FROM cards`)
      ,pool.query(`SELECT setting_value FROM app_settings
        WHERE setting_key = 'card_stock_low_threshold' LIMIT 1`)
      ,pool.query(`SELECT
          (SELECT COUNT(*) FROM (
            SELECT d.provider_account_id, d.external_card_id, d.intake_status,
              ROW_NUMBER() OVER (
                PARTITION BY d.provider_account_id, d.external_card_id
                ORDER BY d.first_seen_at DESC, d.id DESC
              ) AS rn
            FROM card_discoveries d
          ) latest
          LEFT JOIN cards c
            ON c.provider_account_id = latest.provider_account_id
           AND c.external_card_id = latest.external_card_id
          WHERE latest.rn = 1
            AND c.id IS NULL
            AND latest.intake_status IN ('QUARANTINED','VALIDATED','REVIEW_REQUIRED')) AS card_intake_pending,
          (SELECT COUNT(*) FROM recharge_attempts
            WHERE funds_risk_state IN ('ACTIVE','UNKNOWN')) AS funds_risk_pending,
          (SELECT COUNT(*) FROM card_funding_attempts
            WHERE funds_risk_state IN ('ACTIVE','UNKNOWN')) AS card_funding_risk_pending,
          (SELECT COUNT(*) FROM card_funding_attempts
            WHERE status = 'MANUAL_REVIEW' OR funds_risk_state = 'UNKNOWN') AS card_funding_manual_review,
          (SELECT COUNT(*) FROM reconciliation_cases
            WHERE status IN ('OPEN','ASSIGNED')) AS reconciliation_cases_open,
          (SELECT COUNT(*) FROM card_sync_jobs
            WHERE status IN ('PENDING','RUNNING','REVIEW_REQUIRED')) AS card_sync_backlog,
          (SELECT COALESCE(SUM(requested_count), 0) FROM card_stock_jobs
            WHERE job_source = 'AUTOMATIC'
              AND created_at >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) - INTERVAL 8 HOUR
              AND created_at < TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) + INTERVAL 16 HOUR) AS replenishment_used_today,
          (SELECT setting_value FROM app_settings WHERE setting_key = 'card_replenishment_daily_limit' LIMIT 1) AS replenishment_daily_limit`)
    ]);
    const count = (value) => Number(value || 0);
    const total = count(orderCounts[0]?.total);
    const successful = count(orderCounts[0]?.successful);
    const completed = successful + count(orderCounts[0]?.completed_failed);
    const heartbeatRow = settingsRows.find((row) => row.setting_key === 'worker_heartbeat_at');
    const heartbeatAt = Date.parse(heartbeatRow?.setting_value || '');
    const workerHealthy = Number.isFinite(heartbeatAt) && now() - heartbeatAt <= 60_000;
    return {
      metrics: {
        totalOrders: total,
        todayOrders: count(orderCounts[0]?.today),
        successfulOrders: successful,
        processingOrders: count(orderCounts[0]?.processing),
        awaitingConfirmationOrders: count(orderCounts[0]?.awaiting_confirmation),
        reviewingOrders: count(orderCounts[0]?.reviewing),
        reconciliationIssues: count(orderCounts[0]?.reconciliation_issues),
        waitingForSession: count(orderCounts[0]?.waiting_for_session),
        waitingForCard: count(orderCounts[0]?.waiting_for_card),
        cancellationPending: count(orderCounts[0]?.cancellation_pending),
        cancellationReview: count(orderCounts[0]?.cancellation_review),
        completedOrders: completed,
        successRate: completed === 0 ? null : Number(((successful / completed) * 100).toFixed(1))
      },
      orderStatuses: statusRows.map((row) => ({ status: row.status, count: count(row.count) })),
      cdkStatuses: cdkRows.map((row) => ({ status: row.status, count: count(row.count) })),
      refundStatuses: refundRows.map((row) => ({ status: row.status, count: count(row.count) })),
      openAlertCount: count(alertRows[0]?.count),
      runtimeHealth: {
        workerHealthy,
        workerHeartbeatAt: Number.isFinite(heartbeatAt) ? new Date(heartbeatAt).toISOString() : null,
        expiredTaskLeases: count(orderCounts[0]?.expired_task_leases),
        stalledProviderCalls: count(orderCounts[0]?.stalled_provider_calls)
      },
      operationalBacklog: {
        cardIntakePending: count(backlogRows[0]?.card_intake_pending),
        fundsRiskPending: count(backlogRows[0]?.funds_risk_pending),
        cardFundingRiskPending: count(backlogRows[0]?.card_funding_risk_pending),
        cardFundingManualReview: count(backlogRows[0]?.card_funding_manual_review),
        reconciliationCasesOpen: count(backlogRows[0]?.reconciliation_cases_open),
        cardSyncBacklog: count(backlogRows[0]?.card_sync_backlog),
        replenishmentUsedToday: count(backlogRows[0]?.replenishment_used_today),
        replenishmentDailyLimit: count(backlogRows[0]?.replenishment_daily_limit || 5),
        replenishmentRemainingToday: Math.max(0,
          count(backlogRows[0]?.replenishment_daily_limit || 5)
          - count(backlogRows[0]?.replenishment_used_today))
      },
      cardStock: {
        available: count(stockRows[0]?.available),
        provisioning: count(stockRows[0]?.provisioning),
        assigned: count(stockRows[0]?.assigned),
        depleted: count(stockRows[0]?.depleted),
        held: count(stockRows[0]?.held),
        lowThreshold: count(stockSettingRows[0]?.setting_value || 5),
        low: count(stockRows[0]?.available) <= count(stockSettingRows[0]?.setting_value || 5)
      },
      providerHealth: {
        provider: 'hnskj',
        routeLabel: stockRows[0]?.provider_route_code || '当前 Plus 卡台路线未配置',
        accountCode: stockRows[0]?.provider_account_code || null,
        syncedAt: iso(stockRows[0]?.provider_synced_at),
        accountBalance: stockRows[0]?.provider_account_balance == null ? null : String(stockRows[0].provider_account_balance),
        currency: stockRows[0]?.provider_currency || 'USD',
        purchaseEnabled: stockRows[0]?.provider_purchase_enabled == null
          ? null : String(stockRows[0].provider_purchase_enabled) === 'true'
      },
      settings: settingsRows.filter((row) => row.setting_key !== 'worker_heartbeat_at').map((row) => ({
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
    const { page, pageSize, status, query, tag, fromDate, toDate, timeField } = parseListQuery(input);
    const conditions = [];
    const values = [];
    let exactCdkLookup = null;
    if (status === 'REVIEW_REQUIRED') {
      conditions.push(`(o.status IN (${REVIEW_STATUSES.map(() => '?').join(', ')})
        OR o.cancellation_review_required = 1 OR (${STALE_CREATE_ATTEMPT_SQL}))`);
      values.push(...REVIEW_STATUSES);
    } else if (status === 'RECONCILIATION_ISSUES') {
      conditions.push(RECONCILIATION_ISSUE_SQL);
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
    const directTimeColumn = {
      CREATED: 'o.created_at', UPDATED: 'o.updated_at', FINISHED: 'o.finished_at'
    }[timeField];
    if (directTimeColumn && fromDate) { conditions.push(`${directTimeColumn} >= ?`); values.push(fromDate); }
    if (directTimeColumn && toDate) { conditions.push(`${directTimeColumn} <= ?`); values.push(toDate); }
    if (!directTimeColumn && (fromDate || toDate)) {
      const timeConditions = [];
      if (fromDate) { timeConditions.push(`${timeField === 'PAID' ? 'tp.paid_at' : 'tp.started_at'} >= ?`); values.push(fromDate); }
      if (toDate) { timeConditions.push(`${timeField === 'PAID' ? 'tp.paid_at' : 'tp.started_at'} <= ?`); values.push(toDate); }
      conditions.push(timeField === 'PAID'
        ? `EXISTS (SELECT 1 FROM customer_payments tp
          WHERE (tp.order_id = o.id OR tp.cdk_id = o.cdk_id) AND ${timeConditions.join(' AND ')})`
        : `EXISTS (SELECT 1 FROM provider_calls tp
          WHERE tp.order_id = o.id AND tp.operation = 'create_direct'
            AND ${timeConditions.join(' AND ')})`);
    }
    if (tag) {
      conditions.push(`EXISTS (SELECT 1 FROM order_tags ot
        WHERE ot.order_id = o.id AND BINARY ot.tag = BINARY ?)`);
      values.push(tag);
    }
    if (query) {
      const lookupConditions = [`o.public_no LIKE ?`, `o.customer_email LIKE ?`,
        `o.chatgpt_account_id LIKE ?`, `o.recharge_order_no LIKE ?`,
        `o.failure_code LIKE ?`, `o.failure_reason LIKE ?`,
        `EXISTS (SELECT 1 FROM recharge_attempts oqra
          WHERE oqra.order_id = o.id AND oqra.external_order_id LIKE ?)`,
        `EXISTS (SELECT 1 FROM provider_calls oqpc
          WHERE oqpc.order_id = o.id AND oqpc.business_code LIKE ?)`,
        `EXISTS (SELECT 1 FROM order_tags oqt WHERE oqt.order_id = o.id AND oqt.tag LIKE ?)`,
        `EXISTS (SELECT 1 FROM customer_payments oqp
          WHERE oqp.order_id = o.id AND oqp.external_reference_masked LIKE ?)`];
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern,
        pattern, pattern);
      const normalizedPan = query.replace(/[\s-]/g, '');
      const cardLookup = [`sc.provider_card_id LIKE ?`, `sc.external_card_id LIKE ?`, `sc.last4 = ?`];
      values.push(pattern, pattern, query);
      if (Buffer.isBuffer(panHmacKey) && /^\d{12,19}$/.test(normalizedPan)) {
        cardLookup.push('sc.pan_hmac = ?');
        values.push(crypto.createHmac('sha256', panHmacKey).update(normalizedPan).digest('hex'));
      }
      lookupConditions.push(`EXISTS (
        SELECT 1 FROM cards sc
        LEFT JOIN card_assignment_history sah ON sah.card_id = sc.id
        WHERE (sc.order_id = o.id OR sah.order_id = o.id)
          AND (${cardLookup.join(' OR ')})
      )`);
      if (Buffer.isBuffer(cdkHashKey)) {
        const lookup = createCdkLookup(query, cdkHashKey);
        exactCdkLookup = lookup;
        lookupConditions.push(`EXISTS (
          SELECT 1 FROM cdks cdk
          LEFT JOIN order_compensations oc ON oc.replacement_cdk_id = cdk.id
          WHERE (cdk.id = o.cdk_id OR oc.original_order_id = o.id) AND (
            (cdk.hash_version = ? AND cdk.code_hash = ?)
            OR (cdk.hash_version = ? AND cdk.code_hash = ?)
          )
        )`);
        values.push(
          lookup.current.version, lookup.current.hash,
          lookup.legacy.version, lookup.legacy.hash
        );
      }
      conditions.push(`(${lookupConditions.join(' OR ')})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[countRows], [rows], [cdkMatchRows]] = await Promise.all([
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
            AND pt.task_type = 'PREPARE_RECHARGE' ORDER BY pt.id DESC LIMIT 1) AS confirmation_ready_at,
          (${CREATE_ATTEMPTED_SQL}) AS create_attempted,
          (${STALE_CREATE_ATTEMPT_SQL}) AS create_attempt_stalled,
          (${SUCCESS_EVENT_SQL}) AS has_recharge_success_event,
          (${TRANSACTION_SYNCED_SQL}) AS transaction_evidence_synced,
          (${SUCCESSFUL_PURCHASE_SQL}) AS successful_purchase_exists,
          (${PAYMENT_MATCH_SQL}) AS payment_matched,
          (${PAYMENT_SETTLED_SQL}) AS payment_settled
        FROM orders o LEFT JOIN cards c ON c.order_id = o.id
        ${where}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]),
      exactCdkLookup ? pool.query(
        `SELECT c.id, c.status, c.batch_no, c.plan_type, c.created_at,
                c.redeemed_at, c.revoked_at, o.public_no
         FROM cdks c LEFT JOIN orders o ON o.id = c.order_id
         WHERE (c.hash_version = ? AND c.code_hash = ?)
            OR (c.hash_version = ? AND c.code_hash = ?)
         LIMIT 2`,
        [exactCdkLookup.current.version, exactCdkLookup.current.hash,
          exactCdkLookup.legacy.version, exactCdkLookup.legacy.hash]
      ) : Promise.resolve([[]])
    ]);
    return {
      page,
      pageSize,
      deliveryTrackingEnabled,
      total: Number(countRows[0]?.total || 0)
        || cdkMatchRows.filter((cdk) => !cdk.public_no).length,
      cdkMatches: cdkMatchRows.map((cdk) => ({
        id: cdk.id, status: cdk.status, batchNo: cdk.batch_no, planType: cdk.plan_type,
        orderPublicNo: cdk.public_no || null, createdAt: iso(cdk.created_at),
        redeemedAt: iso(cdk.redeemed_at), revokedAt: iso(cdk.revoked_at)
      })),
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
        reconciliation: reconciliationFromRow(row),
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
    const [[orderRows], [eventRows], [taskRows], [callRows], [refundRows], [transactionRows],
      [compensationRows], [authorizationRows], [cdkRows], [deliveryRows], [paymentRows],
      [assignmentRows], [noteRows], [tagRows], [relationshipRows], [sessionReplacementRows]] = await Promise.all([
      pool.query(`SELECT o.id, o.public_no, o.status, o.plan_type, o.customer_email,
          o.chatgpt_account_id, o.card_type_id, o.open_card_amount,
          o.minimum_required_card_balance, o.actual_payment_amount, o.actual_payment_currency,
          o.recharge_order_no, o.failure_code, o.failure_reason,
          o.customer_action_code, o.session_replacement_count,
          o.session_repair_started_at, o.session_repair_expires_at, o.last_session_replaced_at,
          o.subscription_cancelled, o.cancellation_checked_at, o.cancellation_review_required,
          o.created_at, o.updated_at, o.finished_at, o.session_ciphertext,
          c.provider_card_id, c.last4, c.status AS card_status, c.funded_amount,
          c.current_balance, c.currency, c.refund_status, c.last_synced_at,
          c.last_transaction_synced_at,
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
        WHERE BINARY o.public_no = ?
        ORDER BY (pc.provider = 'zzshu' AND pc.operation = 'create_direct') DESC, pc.id DESC LIMIT 100`, [publicNo]),
      pool.query(`SELECT r.status, r.expected_amount, r.confirmed_amount, r.currency,
          r.detected_at, r.confirmed_at, r.withdrawn_at, r.operator_note, r.updated_at
        FROM refund_cases r INNER JOIN orders o ON o.id = r.order_id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo]),
      pool.query(`SELECT ct.provider_transaction_id, ct.transaction_type, ct.status,
          ct.amount, ct.currency, ct.fee, ct.trade_time_raw, ct.related_txn_id,
          ct.settlement_status, ct.original_amount, ct.original_currency,
          ct.merchant_name, ct.merchant_country, ct.merchant_mcc,
          ct.first_seen_at, ct.last_seen_at
        FROM orders o
        INNER JOIN cards c ON c.order_id = o.id OR EXISTS (
          SELECT 1 FROM card_assignment_history ah
          WHERE ah.card_id = c.id AND ah.order_id = o.id
        )
        INNER JOIN card_transactions ct ON ct.card_id = c.id
        WHERE BINARY o.public_no = ?
        ORDER BY ct.id DESC LIMIT 200`, [publicNo]),
      pool.query(`SELECT oc.created_at, c.status AS replacement_status
        FROM order_compensations oc
        INNER JOIN orders o ON o.id = oc.original_order_id
        INNER JOIN cdks c ON c.id = oc.replacement_cdk_id
        WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo]),
      pool.query(`SELECT ra.id AS authorization_id, ra.status AS authorization_status,
          ra.expires_at, rai.status AS item_status, rat.id AS attempt_id,
          rat.status AS attempt_status, rat.funds_risk_state
        FROM recharge_authorization_items rai
        INNER JOIN recharge_authorizations ra ON ra.id = rai.authorization_id
        INNER JOIN orders o ON o.id = rai.order_id
        LEFT JOIN recharge_attempts rat ON rat.authorization_item_id = rai.id
        WHERE BINARY o.public_no = ? ORDER BY rai.created_at DESC LIMIT 1`, [publicNo])
      ,pool.query(`SELECT c.id, c.status, c.batch_no, c.created_at, c.redeemed_at,
            CASE WHEN c.id = o.cdk_id THEN 'ORDER' ELSE 'REPLACEMENT' END AS relationship,
            redeemed_order.public_no AS redeemed_order_public_no
          FROM orders o
          INNER JOIN cdks c ON c.id = o.cdk_id OR EXISTS (
            SELECT 1 FROM order_compensations oc
            WHERE oc.original_order_id = o.id AND oc.replacement_cdk_id = c.id
          )
          LEFT JOIN orders redeemed_order ON redeemed_order.cdk_id = c.id
          WHERE BINARY o.public_no = ? ORDER BY c.created_at`, [publicNo])
      ,pool.query(`SELECT de.cdk_id, de.event_type, de.channel,
            de.recipient_note, de.actor_id, de.delivered_at
          FROM cdk_delivery_events de
          INNER JOIN orders o ON de.cdk_id = o.cdk_id OR EXISTS (
            SELECT 1 FROM order_compensations oc
            WHERE oc.original_order_id = o.id AND oc.replacement_cdk_id = de.cdk_id
          )
          WHERE BINARY o.public_no = ? ORDER BY de.delivered_at DESC`, [publicNo])
      ,pool.query(`SELECT p.id, p.cdk_id, p.payment_channel, p.payment_status,
            p.amount, p.currency, p.paid_at, p.external_reference_masked,
            p.operator_note, p.recorded_by, p.created_at
          FROM customer_payments p
          INNER JOIN orders o ON p.order_id = o.id OR p.cdk_id = o.cdk_id OR EXISTS (
            SELECT 1 FROM order_compensations oc
            WHERE oc.original_order_id = o.id AND oc.replacement_cdk_id = p.cdk_id
          ) OR EXISTS (
            SELECT 1 FROM order_compensations reverse_oc
            INNER JOIN orders original ON original.id = reverse_oc.original_order_id
            WHERE reverse_oc.replacement_cdk_id = o.cdk_id
              AND (p.order_id = original.id OR p.cdk_id = original.cdk_id)
          )
          WHERE BINARY o.public_no = ? ORDER BY p.created_at DESC`, [publicNo])
      ,pool.query(`SELECT ah.id, ah.assignment_kind, ah.status, ah.assigned_by,
            ah.assignment_reason, ah.assigned_at, ah.released_by, ah.release_reason,
            ah.released_at, c.provider_account_id, c.provider_card_id, c.external_card_id, c.last4,
            c.card_number_ciphertext, c.card_credentials_ciphertext,
            linked.public_no AS linked_public_no, linked.status AS linked_order_status
          FROM card_assignment_history ah
          INNER JOIN orders target ON target.id = ah.order_id
          INNER JOIN cards c ON c.id = ah.card_id
          INNER JOIN orders linked ON linked.id = ah.order_id
          WHERE BINARY target.public_no = ? ORDER BY ah.assigned_at DESC`, [publicNo])
      ,pool.query(`SELECT n.id, n.note_text, n.created_by, n.created_at
          FROM order_notes n INNER JOIN orders o ON o.id = n.order_id
          WHERE BINARY o.public_no = ? ORDER BY n.created_at DESC`, [publicNo])
      ,pool.query(`SELECT t.tag, t.created_by, t.created_at
          FROM order_tags t INNER JOIN orders o ON o.id = t.order_id
          WHERE BINARY o.public_no = ? ORDER BY t.tag`, [publicNo])
      ,pool.query(`SELECT original.public_no AS original_public_no,
            replacement_order.public_no AS replacement_public_no,
            oc.created_at
          FROM order_compensations oc
          INNER JOIN orders original ON original.id = oc.original_order_id
          INNER JOIN cdks replacement_cdk ON replacement_cdk.id = oc.replacement_cdk_id
          LEFT JOIN orders replacement_order ON replacement_order.cdk_id = replacement_cdk.id
          WHERE BINARY original.public_no = ? OR BINARY replacement_order.public_no = ?
          ORDER BY oc.created_at DESC`, [publicNo, publicNo])
      ,pool.query(`SELECT sr.replacement_no, sr.reason_code,
            sr.previous_customer_email, sr.new_customer_email,
            sr.previous_chatgpt_account_id, sr.new_chatgpt_account_id,
            sr.created_at
          FROM order_session_replacements sr
          INNER JOIN orders o ON o.id = sr.order_id
          WHERE BINARY o.public_no = ? ORDER BY sr.replacement_no DESC`, [publicNo])
    ]);
    const row = orderRows[0];
    if (!row) throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
    // Historical orders may predate failure-code persistence. Derive a
    // read-only admin explanation from the authoritative Provider call rather
    // than mutating production history.
    const historicalProviderFailure = callRows.find((call) =>
      call.provider === 'zzshu' && call.operation === 'create_direct'
        && call.business_code != null && call.outcome !== 'SUCCESS'
    );
    const effectiveFailureCode = row.failure_code || (
      row.status === 'RECHARGE_FAILED' && historicalProviderFailure
        ? `PROVIDER_${String(historicalProviderFailure.business_code)}` : null
    );
    const effectiveFailureReason = row.failure_reason || (
      effectiveFailureCode ? `Provider ${effectiveFailureCode}（历史记录推导，未修改订单数据）` : null
    );
    const prepareTask = taskRows.find((task) => task.task_type === 'PREPARE_RECHARGE');
    const submitTask = taskRows.find((task) => task.task_type === 'SUBMIT_RECHARGE');
    const authorization = authorizationRows[0] || null;
    const authorizationExpired = authorization?.expires_at
      && new Date(authorization.expires_at).getTime() <= now();
    const effectivePermitStatus = authorization
      ? (authorization.item_status === 'PENDING' && !authorizationExpired
        ? 'ARMED'
        : authorization.item_status === 'PENDING' ? 'EXPIRED' : authorization.item_status)
      : (submitTask?.permit_status || 'LOCKED');
    const effectivePermitExpiresAt = authorization?.expires_at
      ? iso(authorization.expires_at) : (submitTask?.permit_expires_at || null);
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
    const rechargeCallExists = callRows.some(
      (call) => call.provider === 'zzshu' && call.operation === 'create_direct'
    );
    const rechargeCallStalled = callRows.some((call) =>
      call.provider === 'zzshu' && call.operation === 'create_direct'
        && call.outcome === 'STARTED'
        && now() - new Date(call.started_at).getTime() > 2 * 60_000);
    const successfulPurchases = transactionRows.filter((transaction) =>
      String(transaction.transaction_type).toLowerCase() === 'purchase'
        && String(transaction.status).toLowerCase() === 'success');
    const matchingPurchases = successfulPurchases.filter((transaction) =>
      transactionMatchesPayment(
        transaction, row.actual_payment_amount, row.actual_payment_currency
      ));
    const reconciliation = reconcileOrderEvidence({
      orderStatus: row.status,
      rechargeOrderNo: row.recharge_order_no,
      createAttempted: rechargeCallExists,
      createAttemptStalled: rechargeCallStalled,
      hasRechargeSuccessEvent: eventRows.some((event) => event.to_status === 'RECHARGE_SUCCESS'),
      actualPaymentAmount: row.actual_payment_amount,
      actualPaymentCurrency: row.actual_payment_currency,
      transactionEvidenceSynced: Boolean(row.last_transaction_synced_at),
      successfulPurchaseExists: successfulPurchases.length > 0,
      paymentMatched: matchingPurchases.length > 0,
      paymentSettled: matchingPurchases.some((transaction) =>
        String(transaction.settlement_status || '').toLowerCase() === 'settled')
    });
    const customerPaidRows = paymentRows.filter((payment) => payment.payment_status === 'PAID');
    let cancellationCode = 'ORDER_CANCELLATION_NOT_ELIGIBLE';
    if (row.status === 'CLOSED' && row.failure_code === 'CANCELLED_PRE_SUBMISSION') {
      cancellationCode = 'ORDER_CANCELLATION_ALREADY_COMPLETED';
    } else if (row.status === 'CARD_READY'
      && submitTask?.status === 'PENDING'
      && Number(submitTask.attempts) === 0
      && effectivePermitStatus !== 'CONSUMED'
      && !row.recharge_order_no
      && !rechargeCallExists) {
      cancellationCode = row.provider_card_id
        ? 'ORDER_CANCELLATION_ELIGIBLE'
        : 'ORDER_CANCELLATION_REVIEW_REQUIRED';
    } else if (rechargeCallExists || row.recharge_order_no || Number(submitTask?.attempts || 0) > 0
      || effectivePermitStatus === 'CONSUMED') {
      cancellationCode = 'ORDER_CANCELLATION_SUBMISSION_RISK';
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
        failureCode: effectiveFailureCode,
        failureReason: effectiveFailureReason,
        customerActionCode: row.customer_action_code,
        sessionReplacementCount: Number(row.session_replacement_count || 0),
        sessionRepairStartedAt: iso(row.session_repair_started_at),
        sessionRepairExpiresAt: iso(row.session_repair_expires_at),
        lastSessionReplacedAt: iso(row.last_session_replaced_at),
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
        lastSyncedAt: iso(row.last_synced_at),
        lastTransactionSyncedAt: iso(row.last_transaction_synced_at)
      } : null,
      reconciliation,
      paymentGate: {
        prepaymentReady: prepareTask?.status === 'COMPLETED',
        submissionLocked: effectivePermitStatus !== 'ARMED',
        permitStatus: effectivePermitStatus,
        permitExpiresAt: effectivePermitExpiresAt,
        authorizationId: authorization?.authorization_id || null,
        rechargeAttemptStatus: authorization?.attempt_status || null,
        fundsRiskState: authorization?.funds_risk_state || null,
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
      cancellation: {
        eligible: cancellationCode === 'ORDER_CANCELLATION_ELIGIBLE',
        alreadyCancelled: cancellationCode === 'ORDER_CANCELLATION_ALREADY_COMPLETED',
        code: cancellationCode,
        cardWillBeReleased: cancellationCode === 'ORDER_CANCELLATION_ELIGIBLE'
      },
      traceability: {
        deliveryTrackingEnabled: Boolean(deliveryTrackingEnabled),
        cdks: cdkRows.map((cdk) => ({
          id: cdk.id, status: cdk.status, batchId: cdk.batch_no,
          relationship: cdk.relationship,
          redeemedOrderPublicNo: cdk.redeemed_order_public_no || null,
          createdAt: iso(cdk.created_at), redeemedAt: iso(cdk.redeemed_at)
        })),
        deliveries: deliveryRows.map((delivery) => ({
          cdkId: delivery.cdk_id, type: delivery.event_type, channel: delivery.channel,
          recipient: delivery.recipient_note, actorId: delivery.actor_id,
          createdAt: iso(delivery.delivered_at)
        })),
        customerPayments: paymentRows.map((payment) => ({
          id: payment.id, cdkId: payment.cdk_id, channel: payment.payment_channel,
          status: payment.payment_status, amount: decimal(payment.amount),
          currency: payment.currency, paidAt: iso(payment.paid_at),
          externalReference: payment.external_reference_masked,
          operatorNote: payment.operator_note, recordedBy: payment.recorded_by,
          createdAt: iso(payment.created_at)
        })),
        cardAssignments: assignmentRows.map((assignment) => ({
          id: assignment.id, kind: assignment.assignment_kind, status: assignment.status,
          providerAccountId: assignment.provider_account_id,
          providerCardId: assignment.provider_card_id,
          externalCardId: assignment.external_card_id,
          cardNumber: cardNumber(assignment, sessionEncryptionKey), last4: assignment.last4,
          linkedOrderPublicNo: assignment.linked_public_no,
          linkedOrderStatus: assignment.linked_order_status,
          assignedBy: assignment.assigned_by, assignmentReason: assignment.assignment_reason,
          assignedAt: iso(assignment.assigned_at), releasedBy: assignment.released_by,
          releaseReason: assignment.release_reason, releasedAt: iso(assignment.released_at)
        })),
        notes: noteRows.map((note) => ({
          id: note.id, text: note.note_text, createdBy: note.created_by,
          createdAt: iso(note.created_at)
        })),
        tags: tagRows.map((tagRow) => ({
          tag: tagRow.tag, createdBy: tagRow.created_by, createdAt: iso(tagRow.created_at)
        })),
        orderRelationships: relationshipRows.map((relationship) => ({
          originalPublicNo: relationship.original_public_no,
          replacementPublicNo: relationship.replacement_public_no || null,
          createdAt: iso(relationship.created_at)
        })),
        sessionReplacements: sessionReplacementRows.map((replacement) => ({
          replacementNo: Number(replacement.replacement_no),
          reasonCode: replacement.reason_code,
          previousCustomerEmail: replacement.previous_customer_email,
          newCustomerEmail: replacement.new_customer_email,
          previousChatgptAccountId: replacement.previous_chatgpt_account_id,
          newChatgptAccountId: replacement.new_chatgpt_account_id,
          createdAt: iso(replacement.created_at)
        })),
        fulfillmentCost: {
          customerPayments: sumByCurrency(customerPaidRows),
          cardFundedAmount: row.funded_amount == null ? [] : [{
            amount: decimal(row.funded_amount), currency: row.currency
          }],
          providerConfirmedPayment: row.actual_payment_amount == null ? [] : [{
            amount: decimal(row.actual_payment_amount), currency: row.actual_payment_currency
          }],
          successfulCardPurchases: sumByCurrency(successfulPurchases),
          cardTransactionFees: sumByCurrency(
            transactionRows.filter((transaction) => Number(transaction.fee) !== 0),
            'fee', 'currency'
          ),
          exchangeRateApplied: false,
          note: '各币种保留原值；未留存的历史费用显示为空，不推算汇率或成本。'
        }
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

  return { getCard, getOrder, getOverview, listOrders, listAlerts, requestCardTransactionSync };
}
