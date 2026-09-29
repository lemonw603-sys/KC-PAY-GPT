// 「演示精简版」形状快照的查询（本机后台 + 仿线上假数据）。
//
// 同一组 SQL 跑两个地方：
//   refresh-shape.mjs 经 browser-mvp/scripts/prod-query.sh 只读跑生产 → 写 shape.json；
//   verify.mjs 跑本机造好数的库 → 与 shape.json 逐节比对（造出来的形状是否和线上一样）。
//
// 边界（任务书 2026-09-29）：只取聚合 —— 每条查询都是 GROUP BY + COUNT/SUM/分桶，输出里没有任何
// 邮箱、Session、卡号、尾号、CDK、token、订单号、外部卡号或自由文本（原因、备注只取「有没有」
// 或「原因码」）。内部会读明细列来分桶，但只输出桶。钱包余额只取整数美元（量级）。
//
// 业务判断一律调生产那一份（资格、演练单、有人动过、需要我处理、关单前状态），不在这里另抄规则（D-191）。
import {
  ledgerSpendSql, minimumBalanceSql, providerCardStockSql, stockCountingCardSql
} from '../../src/services/card-inventory-eligibility.js';
import { rehearsalOrderSql } from '../../src/db/repositories/rehearsal-order-sql.js';
import { closedLastStatusSql } from '../../src/db/repositories/order-status-query-repository.js';
import { createAdminReadService, humanTouchedOrderSql, needsPersonOrderSql } from '../../src/services/admin-read-service.js';
import { latestProviderBalancesSql } from '../../src/services/provider-balance-snapshot-service.js';
import { MANUAL_USE_REASON_REGEXP } from '../../src/services/daily-reconciliation-service.js';

export const PRODUCTS = ['plus', 'pro_5x', 'pro_20x'];

/** 快照里允许出现的 app_settings（开关与门槛）。token、人名、对账指纹、会话版本不在其列。 */
export const SETTING_KEYS = [
  'accept_new_orders', 'dispatch_new_recharges', 'recharge_dispatch_mode', 'poll_existing_orders',
  'sync_card_transactions', 'worker_recharge_writes_enabled', 'browser_payment_writes_enabled',
  'browser_dispatch_enabled', 'browser_billing_address_enabled', 'browser_billing_address_state',
  'card_auto_replenishment_enabled', 'card_max_successful_payments', 'card_max_successful_payments:pro_5x',
  'card_max_successful_payments:pro_20x', 'card_min_retire_age_hours', 'card_replenishment_daily_limit',
  'card_stock_low_threshold', 'default_card_type_id', 'default_minimum_required_card_balance',
  'default_open_card_amount', 'minimum_required_card_balance:pro_5x', 'minimum_required_card_balance:pro_20x',
  'plus_max_card_balance', 'session_replacement_window_hours', 'intake_executor_heartbeat_check',
  'zzshu_points_remaining'
];
/** 这几个键的值是时间点：快照只存「距抓取时多少秒」，造数时按现在往回推。 */
export const HEARTBEAT_KEYS = [
  'worker_heartbeat_at', 'browser_worker_heartbeat_at', 'zzshu_points_observed_at', 'daily_reconciliation_heartbeat_at'
];

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
/** UTC+8 自然日偏移：0 = 今天（与后台「今天」同一日界）。 */
export const dayOffsetSql = (column) =>
  `DATEDIFF(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), DATE(CONVERT_TZ(${column}, '+00:00', '+08:00')))`;
const ageSql = (column) => `TIMESTAMPDIFF(SECOND, ${column}, UTC_TIMESTAMP(3))`;

/** 金额分桶：边界对齐资格规则里用到的门槛（Plus 最低 16、大额卡 75、5X 最低 95、20X 最低 150）。 */
export const BALANCE_BUCKETS = ['null', 'neg', '0', '0-1', '1-5', '5-16', '16-17', '17-50', '50-75', '75-95', '95-150', '150+'];
export const bucketSql = (expr) => `CASE WHEN (${expr}) IS NULL THEN 'null' WHEN (${expr}) < 0 THEN 'neg'
  WHEN (${expr}) = 0 THEN '0' WHEN (${expr}) < 1 THEN '0-1' WHEN (${expr}) < 5 THEN '1-5'
  WHEN (${expr}) < 16 THEN '5-16' WHEN (${expr}) < 17 THEN '16-17' WHEN (${expr}) < 50 THEN '17-50'
  WHEN (${expr}) <= 75 THEN '50-75' WHEN (${expr}) < 95 THEN '75-95' WHEN (${expr}) < 150 THEN '95-150' ELSE '150+' END`;
const dayBucketSql = (column) => `IF(${dayOffsetSql(column)} <= 7, CAST(${dayOffsetSql(column)} AS CHAR), 'old')`;

/**
 * 把「每行一组、带 count」的 GROUP BY 查询包成一个 JSON 数组（一次查询一行一列，便于经 prod-query.sh 取回）。
 * fields: 输出字段名（与内层列别名一致）。
 */
function jsonRows(fields, innerSql) {
  const pairs = fields.map((field) => `${quote(field)}, g.\`${field}\``).join(', ');
  return `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(${pairs})), JSON_ARRAY()) FROM (${innerSql}) g`;
}
function groupBy(dims, measures, perRowSql) {
  const dimList = dims.map((d) => `x.\`${d}\``).join(', ');
  const measureList = Object.entries(measures).map(([name, expr]) => `${expr} AS \`${name}\``).join(', ');
  return jsonRows([...dims, ...Object.keys(measures)],
    `SELECT ${dimList}, ${measureList} FROM (${perRowSql}) x GROUP BY ${dimList}`);
}

// ---------------------------------------------------------------------------------------------
// 配置类（开关、门槛、路线、卡台）。这些本来就是后台设置页上的数，不是个人或卡片明细。

export function settingsSql() {
  return `SELECT JSON_OBJECT(
    'values', (SELECT COALESCE(JSON_OBJECTAGG(setting_key, setting_value), JSON_OBJECT()) FROM app_settings
               WHERE setting_key IN (${SETTING_KEYS.map(quote).join(', ')})),
    'heartbeats', (SELECT COALESCE(JSON_OBJECTAGG(setting_key, setting_value), JSON_OBJECT()) FROM app_settings
               WHERE setting_key IN (${HEARTBEAT_KEYS.map(quote).join(', ')})),
    'dbNow', DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ'),
    'highvccToken', (SELECT JSON_OBJECT('configured', COALESCE(setting_value, '') <> '', 'ageSeconds', ${ageSql('updated_at')})
               FROM app_settings WHERE setting_key = 'highvcc_access_token_ciphertext'),
    'dailyReport', (SELECT JSON_OBJECT(
                 'persistent', JSON_LENGTH(setting_value, '$.persistentFingerprints'),
                 'discrepancies', JSON_LENGTH(setting_value, '$.discrepancyFingerprints'),
                 'ageSeconds', ${ageSql('updated_at')})
               FROM app_settings WHERE setting_key = 'daily_reconciliation_last_report' AND JSON_VALID(setting_value)))`;
}

export function providersSql() {
  return jsonRows(['providerCode', 'accountCode', 'purpose', 'displayName', 'supplyFaultState', 'supplyFaultReason',
    'supplyFaultAgeSeconds', 'walletFloor', 'walletAlertThreshold', 'operationalEnabled', 'readEnabled', 'writeEnabled',
    'circuitState', 'defaultCardSegment', 'lastFullSnapshotAgeSeconds', 'walletBalance', 'walletCurrency',
    'walletAgeSeconds', 'balanceSnapshots'],
  `SELECT pa.provider_code AS providerCode, pa.account_code AS accountCode, pa.purpose, pa.display_name AS displayName,
      pa.supply_fault_state AS supplyFaultState, pa.supply_fault_reason AS supplyFaultReason,
      ${ageSql('pa.supply_fault_at')} AS supplyFaultAgeSeconds,
      pa.wallet_floor AS walletFloor, pa.wallet_alert_threshold AS walletAlertThreshold,
      pa.operational_enabled AS operationalEnabled, pa.read_enabled AS readEnabled, pa.write_enabled AS writeEnabled,
      pa.circuit_state AS circuitState, pa.default_card_segment AS defaultCardSegment,
      ${ageSql('pa.last_full_snapshot_at')} AS lastFullSnapshotAgeSeconds,
      (SELECT ROUND(b.available_balance) FROM (${latestProviderBalancesSql()}) b WHERE b.provider_account_id = pa.id LIMIT 1) AS walletBalance,
      (SELECT b.currency FROM (${latestProviderBalancesSql()}) b WHERE b.provider_account_id = pa.id LIMIT 1) AS walletCurrency,
      (SELECT ${ageSql('b.observed_at')} FROM (${latestProviderBalancesSql()}) b WHERE b.provider_account_id = pa.id LIMIT 1) AS walletAgeSeconds,
      (SELECT COUNT(*) FROM provider_balance_snapshots s WHERE s.provider_account_id = pa.id) AS balanceSnapshots
    FROM provider_accounts pa`);
}

export function hnskjSnapshotSql() {
  return `SELECT JSON_OBJECT(
      'accountBalance', ROUND(JSON_EXTRACT(payload_json, '$.accountBalance')),
      'currency', JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.currency')),
      'exchangeRate', JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.exchangeRate')),
      'purchaseEnabled', JSON_EXTRACT(payload_json, '$.purchaseEnabled'),
      'cardLimit', JSON_EXTRACT(payload_json, '$.cardLimit'),
      'cardTypeCount', COALESCE(JSON_LENGTH(payload_json, '$.cardTypes'), 0),
      'ageSeconds', ${ageSql('synced_at')})
    FROM card_provider_snapshots WHERE provider = 'hnskj'`;
}

export function configSql() {
  return `SELECT JSON_OBJECT(
    'supplyPolicies', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('providerCode', pa.provider_code, 'productCode', sp.product_code,
        'targetAvailable', sp.target_available, 'openCardAmount', sp.open_card_amount, 'dailyOpenLimit', sp.daily_open_limit,
        'cardSegment', sp.card_segment)), JSON_ARRAY())
      FROM card_supply_policies sp JOIN provider_accounts pa ON pa.id = sp.provider_account_id),
    'cardSources', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('productCode', p.product_code, 'executorKind', css.executor_kind,
        'providerCode', pa.provider_code, 'locked', css.locked)), JSON_ARRAY())
      FROM card_source_selections css JOIN products p ON p.id = css.product_id JOIN provider_accounts pa ON pa.id = css.provider_account_id),
    'routes', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('routeCode', route_code, 'acceptsNewOrders', accepts_new_orders,
        'retired', retired_at IS NOT NULL)), JSON_ARRAY()) FROM fulfillment_routes),
    'executorProfiles', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('profileCode', profile_code, 'status', status,
        'productionWritesEnabled', JSON_UNQUOTE(JSON_EXTRACT(config_public_json, '$.productionWritesEnabled')) = 'true')), JSON_ARRAY())
      FROM executor_profiles),
    'products', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('productCode', product_code, 'status', status)), JSON_ARRAY()) FROM products))`;
}

// ---------------------------------------------------------------------------------------------
// 订单：每组一行（状态、产品、路线、失败原因码、UTC+8 日偏移、演练单/有人动过/成功事件等生产规则的判定结果、
// 最近一次付款尝试与 Browser run 的状态），只数个数。

const ORDER_DIMS = ['status', 'planType', 'routeCode', 'routeResolution', 'failureCode', 'customerActionCode',
  'cardProvider', 'cardAssigned', 'subscriptionCancelled', 'cancellationReviewRequired', 'hasRechargeOrderNo',
  'paymentCurrency', 'sessionReplacements', 'dayOffset', 'rehearsal', 'humanTouched', 'successEvent',
  'closedLastStatus', 'needsPerson', 'attemptCount', 'attemptStatus', 'attemptFundsRisk', 'attemptExecutor',
  'runCount', 'runStatus', 'runPaymentState', 'runPostPaymentState', 'runWorker', 'runErrorCode', 'runControlState',
  'cdkStatus', 'hasFailureReason', 'hasExecutionDetail'];

export function ordersSql() {
  const latestAttempt = (column) => `(SELECT la.${column} FROM recharge_attempts la WHERE la.order_id = o.id
      ORDER BY la.created_at DESC, la.id DESC LIMIT 1)`;
  const latestRun = (expr) => `(SELECT ${expr} FROM browser_runs lr INNER JOIN recharge_attempts lra ON lra.id = lr.recharge_attempt_id
      WHERE lra.order_id = o.id ORDER BY lr.created_at DESC, lr.id DESC LIMIT 1)`;
  const perOrder = `SELECT o.status, o.plan_type AS planType, fr.route_code AS routeCode,
      o.route_resolution_status AS routeResolution, o.failure_code AS failureCode,
      o.customer_action_code AS customerActionCode,
      COALESCE(cpa.provider_code, fpa.provider_code) AS cardProvider,
      o.assigned_card_id IS NOT NULL AS cardAssigned,
      o.subscription_cancelled AS subscriptionCancelled,
      o.cancellation_review_required AS cancellationReviewRequired,
      o.recharge_order_no IS NOT NULL AS hasRechargeOrderNo,
      o.actual_payment_currency AS paymentCurrency,
      o.session_replacement_count AS sessionReplacements,
      ${dayOffsetSql('o.created_at')} AS dayOffset,
      ${rehearsalOrderSql('o')} AS rehearsal,
      ${humanTouchedOrderSql('o')} AS humanTouched,
      EXISTS (SELECT 1 FROM order_events se WHERE se.order_id = o.id AND se.to_status = 'RECHARGE_SUCCESS') AS successEvent,
      CASE WHEN o.status = 'CLOSED' THEN ${closedLastStatusSql('o')} END AS closedLastStatus,
      ${needsPersonOrderSql()} AS needsPerson,
      (SELECT COUNT(*) FROM recharge_attempts ca WHERE ca.order_id = o.id) AS attemptCount,
      ${latestAttempt('status')} AS attemptStatus,
      ${latestAttempt('funds_risk_state')} AS attemptFundsRisk,
      ${latestAttempt('executor_kind')} AS attemptExecutor,
      (SELECT COUNT(*) FROM browser_runs cr INNER JOIN recharge_attempts cra ON cra.id = cr.recharge_attempt_id
        WHERE cra.order_id = o.id) AS runCount,
      ${latestRun('lr.status')} AS runStatus,
      ${latestRun('lr.payment_state')} AS runPaymentState,
      ${latestRun('lr.post_payment_state')} AS runPostPaymentState,
      ${latestRun(`CASE WHEN lr.worker_id IS NULL THEN 'none' WHEN lr.worker_id LIKE 'pool:%' THEN 'pool'
        WHEN lr.worker_id LIKE 'production%' THEN 'production' WHEN lr.worker_id LIKE 'local%' THEN 'local' ELSE 'other' END`)} AS runWorker,
      ${latestRun('lr.last_error_code')} AS runErrorCode,
      ${latestRun('lr.control_state')} AS runControlState,
      (SELECT k.status FROM cdks k WHERE k.id = o.cdk_id) AS cdkStatus,
      COALESCE(o.failure_reason, '') <> '' AS hasFailureReason,
      EXISTS (SELECT 1 FROM browser_run_events fe WHERE fe.order_id COLLATE utf8mb4_unicode_ci = o.id
        AND fe.action IN ('fail-closed', 'payment-outcome-diagnostic')
        AND (JSON_EXTRACT(fe.summary_json, '$.navigationError') IS NOT NULL
          OR JSON_EXTRACT(fe.summary_json, '$.diagnostic') IS NOT NULL)) AS hasExecutionDetail,
      o.actual_payment_amount AS payAmount,
      TIMESTAMPDIFF(SECOND, o.created_at, COALESCE(o.finished_at, o.updated_at)) AS durationSeconds
    FROM orders o
    LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
    LEFT JOIN cards cc ON cc.id = o.assigned_card_id
    LEFT JOIN provider_accounts cpa ON cpa.id = cc.provider_account_id
    LEFT JOIN provider_accounts fpa ON fpa.id = o.frozen_card_provider_account_id`;
  return groupBy(ORDER_DIMS, {
    count: 'COUNT(*)',
    avgPayment: 'ROUND(AVG(x.payAmount), 2)',
    avgDurationSeconds: 'ROUND(AVG(x.durationSeconds))'
  }, perOrder);
}

// ---------------------------------------------------------------------------------------------
// 卡：每组一行（卡台、状态、余额/入卡额/可用额分桶、账本各状态次数、占用、停用覆盖的原因码、流水签名、
// 以及生产资格规则按三个产品算出的「库存口径」判定），只数个数。流水签名＝这张卡的流水按
// 「类型|状态|日偏移」计数拼成的串，不含金额与流水号。

const CARD_DIMS = ['providerCode', 'status', 'inventoryStatus', 'intakeStatus', 'refundStatus', 'syncTier',
  'sourcePresent', 'sourceOperationalStatus', 'cardTypeId', 'currency', 'hasCredentials', 'hasNumber', 'hasPanHmac',
  'legacyOrder', 'lastTxSync', 'lastSync', 'lastSuccessfulSync', 'balanceBucket', 'fundedBucket', 'effectiveBucket',
  'ledgerReserved', 'ledgerConsumed', 'ledgerReconciliation', 'ledgerReleased', 'releasedOnSuccess', 'activePlans',
  'releasedPlans', 'activePro', 'activeAssignment', 'assignmentCount', 'overridePolicy', 'overrideProduct',
  'overrideReasonCode', 'refundCase', 'retiredConfirmed', 'createdDayOffset', 'txSignature',
  'stockPlus', 'stockPro5x', 'stockPro20x'];

const freshnessSql = (column, windowSql) => `CASE WHEN ${column} IS NULL THEN 'never'
  WHEN ${column} >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${windowSql}) THEN 'fresh' ELSE 'stale' END`;

export function cardsSql() {
  const ledgerCount = (statusSql) => `(SELECT COUNT(*) FROM card_consumption_ledger l WHERE l.card_id = c.id AND ${statusSql})`;
  const perCard = `SELECT pa.provider_code AS providerCode, c.status, c.inventory_status AS inventoryStatus,
      c.intake_status AS intakeStatus, c.refund_status AS refundStatus, c.sync_tier AS syncTier,
      c.source_present AS sourcePresent, c.source_operational_status AS sourceOperationalStatus,
      c.card_type_id AS cardTypeId, c.currency,
      c.card_credentials_ciphertext IS NOT NULL AS hasCredentials,
      c.card_number_ciphertext IS NOT NULL AS hasNumber,
      c.pan_hmac IS NOT NULL AS hasPanHmac,
      c.order_id IS NOT NULL AS legacyOrder,
      ${freshnessSql('c.last_transaction_synced_at', '15 MINUTE')} AS lastTxSync,
      ${freshnessSql('c.last_synced_at', '24 HOUR')} AS lastSync,
      ${freshnessSql('c.last_successful_sync_at', '24 HOUR')} AS lastSuccessfulSync,
      ${bucketSql('c.current_balance')} AS balanceBucket,
      ${bucketSql('c.funded_amount')} AS fundedBucket,
      ${bucketSql(`LEAST(c.current_balance, c.funded_amount - ${ledgerSpendSql('c')})`)} AS effectiveBucket,
      ${ledgerCount("l.status = 'RESERVED'")} AS ledgerReserved,
      ${ledgerCount("l.status = 'CONSUMED'")} AS ledgerConsumed,
      ${ledgerCount("l.status = 'RECONCILIATION'")} AS ledgerReconciliation,
      ${ledgerCount("l.status = 'RELEASED'")} AS ledgerReleased,
      (SELECT COUNT(*) FROM card_consumption_ledger l INNER JOIN orders lo ON lo.id = l.order_id
        WHERE l.card_id = c.id AND l.status = 'RELEASED' AND lo.status = 'RECHARGE_SUCCESS') AS releasedOnSuccess,
      (SELECT GROUP_CONCAT(DISTINCT lo.plan_type ORDER BY lo.plan_type) FROM card_consumption_ledger l
        INNER JOIN orders lo ON lo.id = l.order_id
        WHERE l.card_id = c.id AND l.status IN ('RESERVED','CONSUMED','RECONCILIATION')) AS activePlans,
      (SELECT GROUP_CONCAT(DISTINCT lo.plan_type ORDER BY lo.plan_type) FROM card_consumption_ledger l
        INNER JOIN orders lo ON lo.id = l.order_id
        WHERE l.card_id = c.id AND l.status = 'RELEASED') AS releasedPlans,
      EXISTS (SELECT 1 FROM card_consumption_ledger l INNER JOIN products lp ON lp.id = l.product_id
        WHERE l.card_id = c.id AND l.status IN ('RESERVED','CONSUMED','RECONCILIATION')
          AND lp.product_code LIKE 'chatgpt_pro%') AS activePro,
      EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id = c.id AND h.status = 'ACTIVE') AS activeAssignment,
      (SELECT COUNT(*) FROM card_assignment_history h WHERE h.card_id = c.id) AS assignmentCount,
      (SELECT GROUP_CONCAT(DISTINCT ov.allocation_policy ORDER BY ov.allocation_policy) FROM card_operational_overrides ov
        WHERE ov.provider_account_id = c.provider_account_id AND BINARY ov.external_card_id = BINARY c.external_card_id) AS overridePolicy,
      (SELECT MAX(ov.product_code) FROM card_operational_overrides ov
        WHERE ov.provider_account_id = c.provider_account_id AND BINARY ov.external_card_id = BINARY c.external_card_id) AS overrideProduct,
      (SELECT MAX(CASE WHEN ov.reason REGEXP '^[A-Z][A-Z_]+:' THEN SUBSTRING_INDEX(ov.reason, ':', 1)
                       WHEN ov.reason REGEXP ${quote(MANUAL_USE_REASON_REGEXP)} THEN 'manual-used' ELSE 'OTHER' END)
        FROM card_operational_overrides ov
        WHERE ov.provider_account_id = c.provider_account_id AND BINARY ov.external_card_id = BINARY c.external_card_id) AS overrideReasonCode,
      EXISTS (SELECT 1 FROM refund_cases r WHERE r.card_id = c.id) AS refundCase,
      EXISTS (SELECT 1 FROM card_state_events e WHERE e.card_id = c.id AND e.event_type = 'CARD_RETIRED_CONFIRMED') AS retiredConfirmed,
      LEAST(${dayOffsetSql('c.created_at')}, 45) AS createdDayOffset,
      tx.signature AS txSignature,
      (${stockCountingCardSql('c', minimumBalanceSql('plus'), { productCode: 'plus' })}) AS stockPlus,
      (${stockCountingCardSql('c', minimumBalanceSql('pro_5x'), { productCode: 'pro_5x' })}) AS stockPro5x,
      (${stockCountingCardSql('c', minimumBalanceSql('pro_20x'), { productCode: 'pro_20x' })}) AS stockPro20x
    FROM cards c
    INNER JOIN provider_accounts pa ON pa.id = c.provider_account_id
    LEFT JOIN (
      SELECT s.card_id, GROUP_CONCAT(s.sig ORDER BY s.sig SEPARATOR ',') AS signature
        FROM (SELECT tt.card_id, CONCAT(tt.type, '|', tt.status, '|', tt.dayb, '*', COUNT(*)) AS sig
                FROM (SELECT t.card_id, t.transaction_type AS type, t.status, ${dayBucketSql('t.first_seen_at')} AS dayb
                        FROM card_transactions t) tt
               GROUP BY tt.card_id, tt.type, tt.status, tt.dayb) s
       GROUP BY s.card_id) tx ON tx.card_id = c.id`;
  return groupBy(CARD_DIMS, { count: 'COUNT(*)' }, perCard);
}

// ---------------------------------------------------------------------------------------------
// 其余各表：按类型/状态/日偏移计数；金额只出合计（造数时平摊回每行）。

export function ledgerSql() {
  return groupBy(['status', 'orderStatus', 'planType', 'providerCode', 'currency'], {
    count: 'COUNT(*)', amount: 'SUM(x.amount)'
  }, `SELECT l.status, lo.status AS orderStatus, lo.plan_type AS planType, pa.provider_code AS providerCode,
        l.currency, l.amount
      FROM card_consumption_ledger l
      INNER JOIN orders lo ON lo.id = l.order_id
      INNER JOIN cards c ON c.id = l.card_id
      INNER JOIN provider_accounts pa ON pa.id = c.provider_account_id`);
}

export function cardTransactionsSql() {
  return groupBy(['providerCode', 'type', 'status', 'dayBucket', 'currency', 'originalCurrency', 'settlementStatus'], {
    count: 'COUNT(*)', amount: 'SUM(x.amount)', originalAmount: 'SUM(x.original_amount)', fee: 'SUM(x.fee)'
  }, `SELECT pa.provider_code AS providerCode, t.transaction_type AS type, t.status,
        ${dayBucketSql('t.first_seen_at')} AS dayBucket, t.currency, t.original_currency AS originalCurrency,
        t.settlement_status AS settlementStatus, t.amount, t.original_amount, t.fee
      FROM card_transactions t
      INNER JOIN cards c ON c.id = t.card_id
      INNER JOIN provider_accounts pa ON pa.id = c.provider_account_id`);
}

export function alertsSql() {
  return groupBy(['type', 'severity', 'status', 'hasOrder', 'dayOffset', 'incidentVersion'], { count: 'COUNT(*)' },
    `SELECT a.alert_type AS type, a.severity, a.status, a.order_id IS NOT NULL AS hasOrder,
        LEAST(${dayOffsetSql('a.created_at')}, 30) AS dayOffset, LEAST(a.incident_version, 3) AS incidentVersion
      FROM operator_alerts a`);
}

/** 只有停用覆盖、cards 里没有的卡（卡片页「历史」里的「仅外部」行）：只数个数与原因码。 */
export function overrideOnlySql() {
  return groupBy(['providerCode', 'policy', 'productCode', 'reasonCode'], { count: 'COUNT(*)' },
    `SELECT pa.provider_code AS providerCode, ov.allocation_policy AS policy, ov.product_code AS productCode,
        CASE WHEN ov.reason REGEXP '^[A-Z][A-Z_]+:' THEN SUBSTRING_INDEX(ov.reason, ':', 1)
             WHEN ov.reason REGEXP ${quote(MANUAL_USE_REASON_REGEXP)} THEN 'manual-used' ELSE 'OTHER' END AS reasonCode
      FROM card_operational_overrides ov
      INNER JOIN provider_accounts pa ON pa.id = ov.provider_account_id
      WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.provider_account_id = ov.provider_account_id
        AND BINARY c.external_card_id = BINARY ov.external_card_id)`);
}

export function alertNotificationsSql() {
  return groupBy(['status'], { count: 'COUNT(*)' }, 'SELECT n.status FROM alert_notifications n');
}

export function cdkBatchesSql() {
  return groupBy(['ordinal', 'planType', 'requestedCount', 'revoked', 'issued', 'saleAmount', 'saleCurrency',
    'hasChannelNote', 'dayOffset'], { count: 'COUNT(*)' },
  `SELECT ROW_NUMBER() OVER (ORDER BY b.created_at, b.batch_no) AS ordinal, b.plan_type AS planType,
        b.requested_count AS requestedCount, b.revoked_at IS NOT NULL AS revoked, b.issued_at IS NOT NULL AS issued,
        b.sale_amount AS saleAmount, b.sale_currency AS saleCurrency,
        COALESCE(b.channel_note, '') <> '' AS hasChannelNote, ${dayOffsetSql('b.created_at')} AS dayOffset
      FROM cdk_batches b`);
}

export function cdksSql() {
  return groupBy(['batchOrdinal', 'status', 'planType', 'issuanceKind', 'issued', 'expires', 'expired', 'orderLinked',
    'orderRefs', 'hasIssuedNote'], { count: 'COUNT(*)' },
  `SELECT bo.ordinal AS batchOrdinal, k.status, k.plan_type AS planType, k.issuance_kind AS issuanceKind,
        k.issued_at IS NOT NULL AS issued, k.expires_at IS NOT NULL AS expires,
        COALESCE(k.expires_at < UTC_TIMESTAMP(3), FALSE) AS expired, k.order_id IS NOT NULL AS orderLinked,
        (SELECT COUNT(*) FROM orders ko WHERE ko.cdk_id = k.id) AS orderRefs,
        COALESCE(k.issued_note, '') <> '' AS hasIssuedNote
      FROM cdks k
      LEFT JOIN (SELECT b.batch_no, ROW_NUMBER() OVER (ORDER BY b.created_at, b.batch_no) AS ordinal FROM cdk_batches b) bo
        ON bo.batch_no = k.batch_no`);
}

export function reconciliationCasesSql() {
  return groupBy(['caseType', 'severity', 'status', 'hasOrder', 'hasCard', 'hasAttempt', 'dayOffset'], { count: 'COUNT(*)' },
    `SELECT r.case_type AS caseType, r.severity, r.status, r.order_id IS NOT NULL AS hasOrder,
        r.card_id IS NOT NULL AS hasCard, r.recharge_attempt_id IS NOT NULL AS hasAttempt,
        LEAST(${dayOffsetSql('r.detected_at')}, 30) AS dayOffset
      FROM reconciliation_cases r`);
}

export function refundCasesSql() {
  return groupBy(['status', 'orderStatus'], { count: 'COUNT(*)' },
    'SELECT r.status, o.status AS orderStatus FROM refund_cases r INNER JOIN orders o ON o.id = r.order_id');
}

export function dispatchJobsSql() {
  return groupBy(['status', 'attemptStatus'], { count: 'COUNT(*)' },
    `SELECT j.status, ra.status AS attemptStatus FROM browser_dispatch_jobs j
      INNER JOIN recharge_attempts ra ON ra.id = j.recharge_attempt_id`);
}

export function tasksSql() {
  return groupBy(['taskType', 'status', 'orderStatus', 'leaseExpired'], { count: 'COUNT(*)' },
    `SELECT t.task_type AS taskType, t.status, o.status AS orderStatus,
        (t.status = 'RUNNING' AND t.leased_until < UTC_TIMESTAMP(3)) AS leaseExpired
      FROM tasks t INNER JOIN orders o ON o.id = t.order_id`);
}

export function stockJobsSql() {
  return groupBy(['status', 'jobSource', 'providerCode', 'productCode', 'dayBucket', 'requestedCount', 'openedCount',
    'hasError'], { count: 'COUNT(*)', amount: 'ROUND(AVG(x.amount), 2)' },
  `SELECT j.status, j.job_source AS jobSource, pa.provider_code AS providerCode, j.product_code AS productCode,
        ${dayBucketSql('j.created_at')} AS dayBucket, j.requested_count AS requestedCount, j.opened_count AS openedCount,
        j.error_code IS NOT NULL AS hasError, j.amount
      FROM card_stock_jobs j LEFT JOIN provider_accounts pa ON pa.id = j.provider_account_id`);
}

export function syncJobsSql() {
  return groupBy(['status', 'within24h'], { count: 'COUNT(*)', avgLatencySeconds: 'ROUND(AVG(x.latency))' },
    `SELECT j.status, COALESCE(j.completed_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR, FALSE) AS within24h,
        TIMESTAMPDIFF(SECOND, j.created_at, j.completed_at) AS latency
      FROM card_sync_jobs j`);
}

export function orderEventsSql() {
  return groupBy(['actorType'], { count: 'COUNT(*)' }, 'SELECT e.actor_type AS actorType FROM order_events e');
}

/**
 * 诊断页「卡台的零散情况」：直接拿生产服务里那条 SQL（用一个只记录不执行的假连接池取出来），不另抄。
 * first_error 是校验错误码，不是自由文本。
 */
export async function cardIntakeStuckSql() {
  let captured = null;
  const capturePool = { query: async (sql) => { captured = sql; return [[]]; } };
  await createAdminReadService({ pool: capturePool }).getCardIntakeStuck();
  if (!captured) throw new Error('could not capture getCardIntakeStuck SQL');
  return jsonRows(['providerCode', 'intakeStatus', 'firstError', 'count', 'firstSeenAgeSeconds'],
    `SELECT s.provider_code AS providerCode, s.intake_status AS intakeStatus, s.first_error AS firstError,
        s.card_count AS count, ${ageSql('s.first_seen_at')} AS firstSeenAgeSeconds FROM (${captured}) s`);
}

/** 期望值：生产资格规则（providerCardStockSql）按台 × 按产品算出的「剩几张 / 能充几单」。 */
export function providerStockSql(productCode) {
  return jsonRows(['providerCode', 'total', 'inStock', 'stockAvailable', 'inUse', 'anyUsed', 'productUsed',
    'remainingOrders', 'target'],
  `SELECT s.provider_kind AS providerCode, s.total, s.in_stock AS inStock, s.stock_available AS stockAvailable,
      s.in_use AS inUse, s.any_used AS anyUsed, s.product_used AS productUsed, s.remaining_orders AS remainingOrders,
      s.plus_target_available AS target
    FROM (${providerCardStockSql({ productCode })}) s`);
}

/** 快照的各节：name → 生成 SQL 的函数（可能是 async）。refresh 与 verify 共用这一张表。 */
export const SECTIONS = {
  settings: settingsSql,
  providers: providersSql,
  hnskjSnapshot: hnskjSnapshotSql,
  config: configSql,
  orders: ordersSql,
  cards: cardsSql,
  ledger: ledgerSql,
  cardTransactions: cardTransactionsSql,
  overrideOnly: overrideOnlySql,
  alerts: alertsSql,
  alertNotifications: alertNotificationsSql,
  cdkBatches: cdkBatchesSql,
  cdks: cdksSql,
  reconciliationCases: reconciliationCasesSql,
  refundCases: refundCasesSql,
  dispatchJobs: dispatchJobsSql,
  tasks: tasksSql,
  stockJobs: stockJobsSql,
  syncJobs: syncJobsSql,
  orderEvents: orderEventsSql,
  cardIntakeStuck: cardIntakeStuckSql,
  stockPlus: () => providerStockSql('plus'),
  stockPro5x: () => providerStockSql('pro_5x'),
  stockPro20x: () => providerStockSql('pro_20x')
};

/**
 * mysql 批处理输出（prod-query.sh 用 -N、非 raw）会把 \ 换行 制表符 NUL 转义成 \\ \n \t \0；
 * 这里还原后再当 JSON 解析。NULL（空集合的标量子查询）当作 null。
 */
export function parseMysqlJsonCell(text) {
  const line = String(text ?? '').replace(/\r?\n$/, '');
  if (line === '' || line === 'NULL') return null;
  const unescaped = line.replace(/\\(\\|n|t|0)/g, (_, ch) => ({ '\\': '\\', n: '\n', t: '\t', 0: '\0' }[ch]));
  return JSON.parse(unescaped);
}
