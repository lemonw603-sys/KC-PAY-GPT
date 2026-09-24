import crypto from 'node:crypto';
import { transitionOrder } from './order-repository.js';
import { releaseCardForSessionReplacementInTransaction } from './card-release-repository.js';
import { OrderStatus } from '../../domain/order-status.js';
import { decryptSecret, encryptSecret } from '../../security/secret-box.js';
import { redactSensitiveText } from '../../security/redaction.js';
import { persistCardTransactions } from './card-transaction-repository.js';
import {
  eligibleInventoryCardSql,
  refreshableInventoryCardSql, maxPaymentsSql } from '../../services/card-inventory-eligibility.js';
import {
  reserveCardConsumptionInTransaction,
  transitionCardConsumptionInTransaction
} from '../../services/card-consumption-ledger-service.js';

function parseSession(ciphertext, key) {
  const text = decryptSecret(ciphertext, key);
  const session = JSON.parse(text);
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('Stored Session is not a JSON object');
  }
  return session;
}

function providerFailureReason(status) {
  const reason = status?.failureReason ?? status?.failure_reason;
  return typeof reason === 'string' && reason.trim()
    ? redactSensitiveText(reason.trim())
    : 'Recharge provider confirmed failure';
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

async function insertEvent(connection, {
  orderId,
  fromStatus,
  toStatus,
  reason,
  metadata = null
}) {
  await connection.query(
    `INSERT INTO order_events
     (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, ?, ?, 'WORKER', NULL, ?, ?)`,
    [orderId, fromStatus, toStatus, reason, metadata == null ? null : JSON.stringify(metadata)]
  );
}

export function createWorkflowRepository(pool, { sessionEncryptionKey, panHmacKey = null }) {
  return {
    async loadOrderContext(orderId) {
      const [rows] = await pool.query(
        `SELECT o.*,
                fr.recharge_provider_account_id,
                fr.executor_kind AS recharge_executor_kind,
                c.id AS local_card_id,
                c.provider_account_id AS stored_card_provider_account_id,
                c.provider_card_id,
                c.card_type_id AS stored_card_type_id,
                c.sync_tier AS card_sync_tier,
                card_pa.provider_code AS card_provider_code,
                card_pa.supports_api_sync AS card_supports_api_sync,
                c.last4,
                c.status AS card_status,
                c.current_balance AS card_current_balance,
                c.currency AS card_currency,
                c.last_synced_at AS card_last_synced_at,
                c.last_transaction_synced_at AS card_last_transaction_synced_at,
                c.card_credentials_ciphertext
         FROM orders o
         LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
         LEFT JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
         LEFT JOIN provider_accounts card_pa ON card_pa.id = c.provider_account_id
         WHERE o.id = ?`,
        [orderId]
      );
      if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
      const row = rows[0];
      return {
        order: {
          ...row,
          card_type_id: row.card_type_id,
          open_card_amount: row.open_card_amount,
          minimum_required_card_balance: row.minimum_required_card_balance
        },
        card: row.provider_card_id ? {
          id: row.local_card_id,
          provider_account_id: row.stored_card_provider_account_id,
          provider_card_id: row.provider_card_id,
          card_type_id: row.stored_card_type_id,
          sync_tier: row.card_sync_tier,
          provider_code: row.card_provider_code,
          supports_api_sync: Number(row.card_supports_api_sync) === 1,
          last4: row.last4,
          status: row.card_status,
          current_balance: row.card_current_balance,
          currency: row.card_currency,
          last_synced_at: row.card_last_synced_at,
          last_transaction_synced_at: row.card_last_transaction_synced_at,
          credentials: row.card_credentials_ciphertext
            ? JSON.parse(decryptSecret(row.card_credentials_ciphertext, sessionEncryptionKey))
            : null
        } : null,
        session: parseSession(row.session_ciphertext, sessionEncryptionKey)
      };
    },

    transition(orderId, toStatus, reason, metadata = null) {
      return transitionOrder(pool, {
        orderId,
        toStatus,
        actorType: 'WORKER',
        reason,
        metadata
      });
    },

    async markSessionReplacementRequired(orderId, {
      failureCode = 'TARGET_ACCOUNT_ALREADY_PLUS',
      failureReason = 'Target account is not eligible for Plus recharge',
      customerActionCode = 'ACCOUNT_ALREADY_PLUS'
    } = {}) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT status, version, session_repair_started_at, session_repair_expires_at
           FROM orders WHERE id = ? FOR UPDATE`, [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status === OrderStatus.WAITING_FOR_SESSION) return;
        if (![OrderStatus.CARD_READY, OrderStatus.SUBMITTING].includes(order.status)) {
          throw new Error(`Cannot request Session replacement from ${order.status}`);
        }
        const [settingRows] = await connection.query(
          `SELECT setting_value FROM app_settings
           WHERE setting_key = 'session_replacement_window_hours' LIMIT 1`
        );
        const hours = Math.max(1, Math.min(168, Number(settingRows[0]?.setting_value || 72)));
        const [updated] = await connection.query(
          `UPDATE orders SET status = ?, failure_code = ?, failure_reason = ?,
             customer_action_code = ?,
             session_repair_started_at = COALESCE(session_repair_started_at, CURRENT_TIMESTAMP(3)),
             session_repair_expires_at = COALESCE(session_repair_expires_at,
               DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)),
             finished_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.WAITING_FOR_SESSION, failureCode, failureReason,
            customerActionCode, hours, orderId, order.version]
        );
        if (Number(updated.affectedRows) !== 1) {
          throw new Error(`Concurrent Session repair transition detected: ${orderId}`);
        }
        // D-355：等 Session 期间不占卡；有付款痕迹时 helper 自己不放。
        const release = await releaseCardForSessionReplacementInTransaction(connection, {
          orderId, releasedBy: 'worker:session-replacement-required',
          reason: `session replacement required: ${failureCode}`
        });
        await insertEvent(connection, {
          orderId, fromStatus: order.status, toStatus: OrderStatus.WAITING_FOR_SESSION,
          reason: 'target account requires a customer-provided replacement Session',
          metadata: { failureCode, customerActionCode, replacementWindowHours: hours, cardRelease: release }
        });
      });
    },

    /**
     * 第④步（面二⑨，D-266）：分卡前先看有没有「过期但本来可能合格」的候选卡。
     * 有合格卡 → null（直接分）；没有合格卡且有过期候选 → 返回那一张，让 handler 当场同步
     * 再分。只挑有只读 API 的账户（supports_api_sync）、非 MANUAL_IMPORT、流水超过 15 分钟
     * 没同步、连续同步失败 < 5 次的卡。只读，不改任何东西，不排任何 job。
     */
    async findStaleInventoryCandidate(orderId) {
      const [orders] = await pool.query(
        `SELECT o.status, o.minimum_required_card_balance, o.plan_type,
                o.frozen_card_provider_account_id AS card_provider_account_id
         FROM orders o WHERE o.id = ? LIMIT 1`,
        [orderId]
      );
      if (orders.length !== 1) throw new Error(`Order not found: ${orderId}`);
      const order = orders[0];
      if (![OrderStatus.CREATED, OrderStatus.WAITING_FOR_CARD].includes(order.status)) return null;
      if (!order.card_provider_account_id) return null;
      const [eligible] = await pool.query(
        `SELECT 1 FROM cards
         WHERE ${eligibleInventoryCardSql('cards', '?', { productCode: order.plan_type || 'plus' })}
           AND cards.provider_account_id = ?
         LIMIT 1`,
        [String(order.minimum_required_card_balance), order.card_provider_account_id]
      );
      if (eligible.length > 0) return null;
      const [candidates] = await pool.query(
        `SELECT cards.id, cards.provider_card_id, cards.card_type_id, cards.funded_amount,
                cards.provider_account_id, cards.last_transaction_synced_at
         FROM cards
         INNER JOIN provider_accounts stale_pa ON stale_pa.id = cards.provider_account_id
         WHERE ${refreshableInventoryCardSql('cards')}
           AND stale_pa.supports_api_sync = 1
           AND cards.provider_account_id = ?
           AND (cards.last_transaction_synced_at IS NULL
             OR cards.last_transaction_synced_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))
           AND COALESCE(cards.sync_consecutive_failures, 0) < 5
         ORDER BY COALESCE(cards.last_transaction_synced_at, cards.created_at) ASC
         LIMIT 1`,
        [order.card_provider_account_id]
      );
      if (candidates.length === 0) return null;
      const card = candidates[0];
      return {
        id: card.id,
        providerCardId: card.provider_card_id,
        providerAccountId: card.provider_account_id,
        cardTypeId: card.card_type_id,
        fundedAmount: card.funded_amount,
        minimumRequiredBalance: order.minimum_required_card_balance,
        lastTransactionSyncedAt: card.last_transaction_synced_at
      };
    },

    /**
     * 第④步（面三③ 表二）：API 单付款不明时的上下文——哪条 attempt、ZZSHU 有没有给 cardKey、
     * 提交请求什么时候发出（provider_calls.started_at）。只读。
     */
    async findUnknownSubmission(orderId) {
      const [rows] = await pool.query(
        `SELECT rat.id AS attempt_id, rat.status AS attempt_status, rat.funds_risk_state,
                rat.external_reference, rat.submit_intent_at, rat.created_at AS attempt_created_at,
                o.recharge_card_key, o.status AS order_status,
                (SELECT MIN(pc.started_at) FROM provider_calls pc
                  WHERE pc.order_id = o.id AND pc.provider = 'zzshu' AND pc.operation = 'create_direct') AS submitted_at
         FROM orders o
         INNER JOIN recharge_attempts rat ON rat.order_id = o.id
         WHERE o.id = ? AND rat.status = 'SUBMIT_UNKNOWN' AND rat.funds_risk_state = 'UNKNOWN'
         ORDER BY rat.created_at DESC LIMIT 1`,
        [orderId]
      );
      if (rows.length !== 1) return null;
      const row = rows[0];
      return {
        attemptId: row.attempt_id,
        orderStatus: row.order_status,
        cardKey: row.recharge_card_key || row.external_reference || null,
        submittedAt: row.submitted_at || row.submit_intent_at || row.attempt_created_at
      };
    },

    /** 卡台侧扣款证据：这张卡库内流水里、按提交时间往后的行（含刚当场同步进来的）。只读。 */
    async listCardPurchasesSince(cardId, since) {
      const [rows] = await pool.query(
        `SELECT provider_transaction_id, transaction_type, status, amount, currency,
                original_amount, original_currency, merchant_name, settlement_status,
                trade_time_raw, occurred_at, first_seen_at
         FROM card_transactions
         WHERE card_id = ?
           AND (occurred_at >= DATE_SUB(?, INTERVAL 15 MINUTE)
             OR first_seen_at >= DATE_SUB(?, INTERVAL 15 MINUTE)
             OR trade_time_raw >= DATE_FORMAT(DATE_ADD(DATE_SUB(?, INTERVAL 15 MINUTE), INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s'))
         ORDER BY first_seen_at ASC, id ASC LIMIT 200`,
        [cardId, since, since, since]
      );
      return rows;
    },

    /**
     * 第④步（面三③ 表二）：API 单付款不明、两路证据仍定不了 → 交人，且必须带证据。
     * 订单 SUBMIT_UNKNOWN → RECONCILIATION_REQUIRED；资金栅栏（attempt SUBMIT_UNKNOWN / UNKNOWN、
     * 账本 RECONCILIATION、卡占用）原样锁住，不重付、不换卡。写 order_events + operator_alerts +
     * reconciliation_cases，三者都带 evidence。
     */
    async escalateUnknownSubmission(orderId, { reasonCode, evidence = {} } = {}) {
      const reason = String(reasonCode || 'PAYMENT_UNKNOWN_UNRESOLVED').slice(0, 64);
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT o.status, o.version, o.public_no,
                  (SELECT rat.id FROM recharge_attempts rat WHERE rat.order_id = o.id
                    AND rat.status = 'SUBMIT_UNKNOWN' ORDER BY rat.created_at DESC LIMIT 1) AS attempt_id
           FROM orders o WHERE o.id = ? FOR UPDATE`, [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status === OrderStatus.RECONCILIATION_REQUIRED) return { orderId, replayed: true };
        if (order.status !== OrderStatus.SUBMIT_UNKNOWN) {
          throw new Error(`Cannot escalate unknown submission from ${order.status}`);
        }
        const safeEvidence = JSON.parse(redactSensitiveText(JSON.stringify(evidence || {})));
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.RECONCILIATION_REQUIRED, orderId, order.version]
        );
        if (result.affectedRows !== 1) throw new Error(`Concurrent unknown-submission escalation detected: ${orderId}`);
        await insertEvent(connection, {
          orderId, fromStatus: OrderStatus.SUBMIT_UNKNOWN, toStatus: OrderStatus.RECONCILIATION_REQUIRED,
          reason: `payment outcome unknown; two-source reconciliation could not decide (${reason})`,
          metadata: { reasonCode: reason, evidence: safeEvidence }
        });
        const account = safeEvidence.account?.summary || '账号状态：无法查询';
        const card = safeEvidence.card?.summary || '卡台扣款：无法查询';
        await connection.query(
          `INSERT INTO operator_alerts
           (id, alert_type, dedupe_key, order_id, severity, title, message, status)
           VALUES (UUID(), 'ORDER_PAYMENT_UNKNOWN_REVIEW', ?, ?, 'critical', ?, ?, 'OPEN')
           ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
             order_id = VALUES(order_id), message = VALUES(message),
             status = IF(status = 'RESOLVED', 'OPEN', status),
             acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
          [`order-payment-unknown-review:${orderId}`, orderId,
            'API 付款结果不明，两路证据定不了，等你核实',
            `订单 ${order.public_no}｜${account}；${card}。系统已锁死：不重付、不换卡。请核实后在后台点「核实付款不明结果」（已扣款 / 未扣款）。`.slice(0, 2000)]
        );
        await connection.query(
          `INSERT INTO reconciliation_cases
           (id, case_type, status, severity, dedupe_key, order_id, recharge_attempt_id,
            evidence_json, detected_at, updated_at)
           VALUES (UUID(), 'API_PAYMENT_UNKNOWN', 'OPEN', 'critical', ?, ?, ?, ?,
                   CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP(3),
             evidence_json = VALUES(evidence_json), updated_at = CURRENT_TIMESTAMP(3)`,
          [`api-payment-unknown:${orderId}`, orderId, order.attempt_id || null,
            JSON.stringify({ reasonCode: reason, ...safeEvidence })]
        );
        return { orderId, replayed: false, reasonCode: reason };
      });
    },

    async assignAvailableCard(orderId) {
      return inTransaction(pool, async (connection) => {
        const [orders] = await connection.query(
          `SELECT o.status, o.version, o.card_type_id, o.product_id, o.plan_type, o.open_card_amount,
                  o.minimum_required_card_balance, o.fulfillment_route_id,
                  o.frozen_card_provider_account_id AS card_provider_account_id
           FROM orders o
           WHERE o.id = ? FOR UPDATE`,
          [orderId]
        );
        if (orders.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = orders[0];
        if (![OrderStatus.CREATED, OrderStatus.WAITING_FOR_CARD].includes(order.status)) {
          throw new Error(`Cannot assign inventory card from ${order.status}`);
        }
        if (!order.fulfillment_route_id || !order.card_provider_account_id) {
          throw new Error(`Order route cannot assign a card: ${orderId}`);
        }
        const [sourceRows] = await connection.query(
          `SELECT id, supports_api_sync, supports_auto_open
           FROM provider_accounts WHERE id=? AND purpose='CARD' LIMIT 1 FOR UPDATE`,
          [order.card_provider_account_id]
        );
        if (sourceRows.length !== 1) throw new Error(`Frozen card source not found: ${orderId}`);
        const source = sourceRows[0];
        const [cards] = await connection.query(
          `SELECT id, provider_card_id, current_balance
           FROM cards
           WHERE ${eligibleInventoryCardSql('cards', '?', { productCode: order.plan_type || 'plus' })}
             AND cards.provider_account_id = ?
           ORDER BY current_balance ASC, created_at ASC
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [String(order.minimum_required_card_balance), order.card_provider_account_id]
        );
        const alertKey = `order-waiting-card:${orderId}`;
        if (cards.length === 0) {
          // 第④步（面二⑨，D-266）：候选卡过期不再「排一条 card_sync_jobs 等 runner 领、
          // 再等下次分卡重试」。分卡 handler 在调本方法之前已用 findStaleInventoryCandidate
          // 挑出过期候选并当场同步；走到这里就是同步后仍无合格卡。
          const [supplySettings] = await connection.query(
            `SELECT setting_key, setting_value FROM app_settings
             WHERE setting_key = 'card_auto_replenishment_enabled'`
          );
          const autoReplenishmentEnabled = Boolean(source.supports_auto_open) && supplySettings.some(
            (row) => row.setting_key === 'card_auto_replenishment_enabled'
              && row.setting_value === 'true'
          );
          // WAITING_FOR_CARD itself is the durable replenishment trigger. Do
          // not create a paid stock job here: that bypassed the scheduler's
          // live rule, balance and daily-limit checks and recreated a failed
          // job on every order retry.
          // 补余额整条线已删（D-367）：余额不够的卡不再「补足后再用」，缺卡一律交给水位调度器开新卡；
          // 开不出来时由调度器的「缺卡但开不出来」/「卡台故障」叫人，这里不再因「有卡可补钱」而另外叫人。
          const replenishmentPending = autoReplenishmentEnabled;
          const waitingMessage = replenishmentPending
            ? '当前没有可用卡，已自动安排开卡，订单会继续处理。'
            : '当前没有可用于 Plus 的卡，订单正在等待处理。';
          const autoHealing = replenishmentPending;
          if (autoHealing) {
            await connection.query(
              `UPDATE operator_alerts SET status='RESOLVED',
                 acknowledged_at=COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))
               WHERE dedupe_key=? AND status='OPEN'`,
              [alertKey]
            );
          } else {
            await connection.query(
              `INSERT INTO operator_alerts
               (id, alert_type, dedupe_key, order_id, severity, title, message, status)
               VALUES (UUID(), 'ORDER_WAITING_FOR_CARD', ?, ?, 'critical', '订单正在等待卡片', ?, 'OPEN')
               ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
                 order_id = VALUES(order_id), message = VALUES(message),
                 status = IF(status = 'RESOLVED', 'OPEN', status),
                 acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
              [alertKey, orderId, waitingMessage]
            );
          }
          if (order.status === OrderStatus.CREATED) {
            const [waiting] = await connection.query(
              `UPDATE orders SET status = ?, version = version + 1,
                 failure_code = NULL, failure_reason = NULL,
                 updated_at = CURRENT_TIMESTAMP(3)
               WHERE id = ? AND version = ?`,
              [OrderStatus.WAITING_FOR_CARD, orderId, order.version]
            );
            if (waiting.affectedRows !== 1) throw new Error(`Concurrent waiting-for-card transition detected: ${orderId}`);
            await insertEvent(connection, {
              orderId, fromStatus: OrderStatus.CREATED, toStatus: OrderStatus.WAITING_FOR_CARD,
              reason: 'no eligible inventory card; order waits for replenishment',
              metadata: { cardTypeId: String(order.card_type_id), minimumRequiredBalance: String(order.minimum_required_card_balance) }
            });
          }
          return {
            waitingForCard: true,
            ...(replenishmentPending ? { replenishmentPending: true } : {})
          };
        }
        const card = cards[0];
        // 每卡单数按订单产品（D-221）：唯一口径 maxPaymentsSql，不在这里另抄键名
        const [[capacitySetting]] = await connection.query(
          `SELECT (${maxPaymentsSql(order.plan_type || 'plus')}) AS max_payments`
        );
        const maxPayments = Number(capacitySetting?.max_payments || 3);
        const [cardUpdate] = await connection.query(
          `UPDATE cards SET order_id = COALESCE(order_id, ?), inventory_status = 'ASSIGNED',
             assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP(3)), updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND inventory_status IN ('AVAILABLE','ASSIGNED','DEPLETED')`,
          [orderId, card.id]
        );
        if (cardUpdate.affectedRows !== 1) throw new Error(`Concurrent card assignment detected: ${card.id}`);
        await connection.query(
          `INSERT INTO card_assignment_history
           (id, card_id, order_id, assignment_kind, status, assigned_by,
            assignment_reason, assigned_at, evidence_json)
           VALUES (UUID(), ?, ?, 'NORMAL', 'ACTIVE', 'worker:assign-available-card',
             'available inventory card assigned to order', CURRENT_TIMESTAMP(3), ?)`,
          [card.id, orderId, JSON.stringify({
            providerCardId: String(card.provider_card_id),
            balanceAtAssignment: String(card.current_balance)
          })]
        );
        await reserveCardConsumptionInTransaction(connection, {
          cardId: card.id,
          orderId,
          productId: order.product_id,
          amount: order.open_card_amount,
          currency: 'USD',
          maxPayments,
          evidence: { source: 'card_assignment', providerCardId: String(card.provider_card_id) }
        });
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status = ?, assigned_card_id = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_READY, card.id, orderId, order.version]
        );
        if (orderUpdate.affectedRows !== 1) throw new Error(`Concurrent order assignment detected: ${orderId}`);
        await insertEvent(connection, {
          orderId,
          fromStatus: order.status,
          toStatus: OrderStatus.CARD_READY,
          reason: 'available inventory card assigned',
          metadata: {
            providerCardId: String(card.provider_card_id),
            currentBalance: String(card.current_balance)
          }
        });
        await connection.query(
          `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = CURRENT_TIMESTAMP(3)
           WHERE dedupe_key = ? AND status = 'OPEN'`,
          [alertKey]
        );
        await connection.query(
          `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
           VALUES (?, 'PREPARE_RECHARGE', 'PENDING', ?, 5),
                  (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)
           ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
          [orderId, `prepare-recharge:${orderId}`, orderId, `submit-recharge:${orderId}`]
        );
        // Session recovery held these tasks until this assignment committed a card.
        // Never revive unrelated DEAD tasks or a task under another dedupe key.
        await connection.query(
          `UPDATE tasks SET status = 'PENDING', attempts = 0, available_at = CURRENT_TIMESTAMP(3),
             leased_by = NULL, leased_until = NULL, completed_at = NULL,
             last_error_code = NULL, last_error_message = NULL, updated_at = CURRENT_TIMESTAMP(3)
           WHERE order_id = ? AND task_type IN ('PREPARE_RECHARGE','SUBMIT_RECHARGE')
             AND status = 'DEAD' AND last_error_code = 'SESSION_REPLACEMENT_WAITING_FOR_CARD'
             AND dedupe_key IN (?, ?)`,
          [orderId, `prepare-recharge:${orderId}`, `submit-recharge:${orderId}`]
        );
        // 库存偏低的告警按台 × 产品由供卡调度器每分钟唯一产生（card-supply-scheduler-service），
        // 这里只把剩余数报回去，不再自己写库存偏低告警（旧实现只算一台、阈值全局）。
        const [stockRows] = await connection.query(
          `SELECT COUNT(*) AS count FROM cards
           WHERE ${eligibleInventoryCardSql('cards', '?', { productCode: order.plan_type || 'plus' })}
             AND provider_account_id = ?`,
          [String(order.minimum_required_card_balance), order.card_provider_account_id]
        );
        const remaining = Number(stockRows[0]?.count || 0);
        return {
          providerCardId: String(card.provider_card_id),
          currentBalance: String(card.current_balance),
          remaining
        };
      });
    },

    async refreshAssignedCardForRecharge(orderId, snapshot, credentials = null) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT o.status AS order_status, c.id AS card_id
           FROM orders o INNER JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
           WHERE o.id = ? FOR UPDATE`,
          [orderId]
        );
        if (rows.length !== 1) throw new Error(`Assigned card not found: ${orderId}`);
        if (rows[0].order_status !== OrderStatus.CARD_READY) {
          throw new Error(`Cannot refresh recharge card from ${rows[0].order_status}`);
        }
        const normalizedPan = credentials
          ? String(credentials.cardNumber || '').replace(/[\s-]/g, '') : '';
        const panHmac = Buffer.isBuffer(panHmacKey) && /^\d{12,19}$/.test(normalizedPan)
          ? crypto.createHmac('sha256', panHmacKey).update(normalizedPan).digest('hex') : null;
        await connection.query(
          `UPDATE cards SET status = ?, last4 = COALESCE(?, last4),
             current_balance = COALESCE(?, current_balance), currency = ?, last_synced_at = CURRENT_TIMESTAMP(3),
             card_credentials_ciphertext = COALESCE(?, card_credentials_ciphertext),
             card_number_ciphertext = COALESCE(?, card_number_ciphertext),
             pan_hmac = COALESCE(?, pan_hmac),
             pan_hmac_version = CASE WHEN ? IS NULL THEN pan_hmac_version ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [snapshot.status, snapshot.last4 || null,
            snapshot.currentBalance == null ? null : String(snapshot.currentBalance),
            snapshot.currency || 'USD',
            credentials ? encryptSecret(JSON.stringify(credentials), sessionEncryptionKey) : null,
            credentials ? encryptSecret(credentials.cardNumber, sessionEncryptionKey) : null,
            panHmac, panHmac, rows[0].card_id]
        );
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.CARD_READY,
          toStatus: OrderStatus.CARD_READY,
          reason: 'assigned card refreshed before recharge funds attempt',
          metadata: {
            state: snapshot.state,
            status: snapshot.status,
            last4: snapshot.last4 || null,
            currentBalance: snapshot.currentBalance == null ? null : String(snapshot.currentBalance)
          }
        });
      });
    },

    async queueAssignedCardTransactionSync(orderId) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT c.id AS card_id
           FROM orders o INNER JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
           WHERE o.id = ? FOR UPDATE`, [orderId]
        );
        if (rows.length !== 1) throw new Error(`Assigned card not found: ${orderId}`);
        const [result] = await connection.query(
          `INSERT INTO card_sync_jobs
           (id, card_id, status, requested_by, priority, dedupe_key)
           SELECT UUID(), ?, 'PENDING', 'workflow', 10, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM card_sync_jobs
             WHERE card_id = ? AND status IN ('PENDING','RUNNING')
           )`,
          [rows[0].card_id, `order-demand-transaction-sync:${orderId}`, rows[0].card_id]
        );
        return { queued: Number(result.affectedRows) === 1, cardId: rows[0].card_id };
      });
    },

    async recordPrepaymentReady(orderId, summary) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        if (rows[0].status !== OrderStatus.CARD_READY) {
          throw new Error(`Cannot prepare recharge from ${rows[0].status}`);
        }
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.CARD_READY,
          toStatus: OrderStatus.CARD_READY,
          reason: 'prepayment request validated; recharge not submitted',
          metadata: summary
        });
      });
    },

    async consumeRechargePermit(orderId, taskId, attemptNo = 1, now = new Date()) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT t.payload_json, t.status AS task_status,
                  o.status AS order_status, o.version AS order_version
           FROM tasks t INNER JOIN orders o ON o.id = t.order_id
           WHERE t.id = ? AND t.order_id = ? AND t.task_type = 'SUBMIT_RECHARGE'
           FOR UPDATE`,
          [taskId, orderId]
        );
        if (rows.length !== 1) return { allowed: false, reason: 'TASK_NOT_FOUND' };
        const row = rows[0];
        if (row.task_status !== 'RUNNING' || row.order_status !== OrderStatus.CARD_READY) {
          return { allowed: false, reason: 'STATE_MISMATCH' };
        }
        const payload = typeof row.payload_json === 'string'
          ? JSON.parse(row.payload_json) : (row.payload_json || {});
        const permit = payload.rechargePermit;
        const expiresAt = Date.parse(permit?.expiresAt || '');
        if (permit?.status !== 'ARMED' || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
          return { allowed: false, reason: 'PERMIT_NOT_ARMED' };
        }
        const [calls] = await connection.query(
          `SELECT id FROM provider_calls
           WHERE order_id = ? AND provider = 'zzshu' AND operation = 'create_direct'
           LIMIT 1 FOR UPDATE`,
          [orderId]
        );
        if (calls.length) return { allowed: false, reason: 'CREATE_ALREADY_ATTEMPTED' };
        payload.rechargePermit = {
          ...permit,
          status: 'CONSUMED',
          consumedAt: now.toISOString()
        };
        const [result] = await connection.query(
          `UPDATE tasks SET payload_json = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND order_id = ? AND status = 'RUNNING'`,
          [JSON.stringify(payload), taskId, orderId]
        );
        if (result.affectedRows !== 1) return { allowed: false, reason: 'LEASE_LOST' };
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND status = ? AND version = ?`,
          [OrderStatus.SUBMITTING, orderId, OrderStatus.CARD_READY, row.order_version]
        );
        if (orderUpdate.affectedRows !== 1) {
          throw new Error(`Concurrent recharge start detected: ${orderId}`);
        }
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.CARD_READY,
          toStatus: OrderStatus.SUBMITTING,
          reason: 'recharge permit consumed; provider call intent persisted'
        });
        const [call] = await connection.query(
          `INSERT INTO provider_calls
           (order_id, provider, operation, request_key, attempt_no, outcome, started_at)
           VALUES (?, 'zzshu', 'create_direct', NULL, ?, 'STARTED', ?)`,
          [orderId, Math.max(1, Number(attemptNo) || 1), now]
        );
        return {
          allowed: true,
          providerCall: { id: call.insertId, startedAt: now }
        };
      });
    },

    async commitRechargeSubmission(orderId, submission) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE',
          [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.SUBMITTING) {
          throw new Error(`Cannot commit recharge submission from ${order.status}`);
        }

        const [updateResult] = await connection.query(
          `UPDATE orders
           SET status = ?, recharge_order_no = ?, recharge_card_key = ?,
               version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [
            OrderStatus.RECHARGE_PROCESSING,
            String(submission.orderNo),
            String(submission.cardKey),
            orderId,
            order.version
          ]
        );
        if (updateResult.affectedRows !== 1) {
          throw new Error(`Concurrent recharge commit detected: ${orderId}`);
        }
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.SUBMITTING,
          toStatus: OrderStatus.RECHARGE_PROCESSING,
          reason: 'recharge submission committed',
          metadata: {
            orderNo: String(submission.orderNo)
          }
        });
        await connection.query(
          `INSERT INTO tasks
           (order_id, task_type, status, dedupe_key, max_attempts, available_at)
           VALUES (?, 'POLL_RECHARGE', 'PENDING', ?, 720,
                   DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 3 SECOND))`,
          [orderId, `poll-recharge:${orderId}`]
        );
      });
    },

    async commitRechargeSuccess(orderId, status, latestSession = null) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (![OrderStatus.RECHARGE_PROCESSING, OrderStatus.SUBMIT_UNKNOWN].includes(order.status)) {
          throw new Error(`Cannot commit recharge success from ${order.status}`);
        }
        const encryptedSession = latestSession
          ? encryptSecret(JSON.stringify(latestSession), sessionEncryptionKey)
          : null;
        const cancelled = status.isSubscriptionCancelled === 1 ? 1 : 0;
        const targetStatus = cancelled === 1
          ? OrderStatus.RECHARGE_SUCCESS : OrderStatus.CANCELLATION_PENDING;
        const [attemptResult] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'SUCCESS', funds_risk_state = 'SETTLED',
               finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP(3)),
               updated_at = CURRENT_TIMESTAMP(3)
           WHERE order_id = ? AND status IN ('PREPARED','PROCESSING','SUBMIT_UNKNOWN')
             AND funds_risk_state IN ('ACTIVE','UNKNOWN')`,
          [orderId]
        );
        if (Number(attemptResult.affectedRows) !== 1) {
          throw new Error(`Recharge success requires exactly one funds attempt: ${orderId}`);
        }
        await transitionCardConsumptionInTransaction(connection, {
          orderId,
          targetStatus: 'CONSUMED',
          allowedCurrentStatuses: ['RESERVED', 'RECONCILIATION'],
          requireActive: false,
          evidence: {
            source: 'workflow_recharge_success',
            paymentAmount: status.paymentAmount ?? null,
            paymentCurrency: status.paymentCurrency ?? null
          }
        });
        await connection.query(
          `UPDATE card_assignment_history SET status='RELEASED', released_by='worker:payment-confirmed',
             release_reason='payment confirmed; capacity ledger retains consumption',
             released_at=CURRENT_TIMESTAMP(3)
           WHERE order_id=? AND status='ACTIVE'`, [orderId]
        );
        await connection.query(
          `UPDATE cards c INNER JOIN orders o ON o.assigned_card_id=c.id
           SET c.inventory_status='DEPLETED', c.current_balance=NULL,
               c.last_transaction_synced_at=NULL, c.updated_at=CURRENT_TIMESTAMP(3)
           WHERE o.id=?`, [orderId]
        );
        const [result] = await connection.query(
          `UPDATE orders SET status = ?,
             session_ciphertext = COALESCE(?, session_ciphertext),
             actual_payment_amount = COALESCE(?, actual_payment_amount),
             actual_payment_currency = COALESCE(?, actual_payment_currency),
             subscription_cancelled = ?, cancellation_checked_at = CURRENT_TIMESTAMP(3),
             cancellation_review_required = 0, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3),
             finished_at = CASE WHEN ? = 'RECHARGE_SUCCESS' THEN CURRENT_TIMESTAMP(3) ELSE NULL END
           WHERE id = ? AND version = ?`,
          [targetStatus, encryptedSession,
            status.paymentAmount ?? null, status.paymentCurrency ?? null,
            cancelled, targetStatus, orderId, order.version]
        );
        if (result.affectedRows !== 1) throw new Error(`Concurrent recharge success detected: ${orderId}`);
        await insertEvent(connection, {
          orderId, fromStatus: order.status, toStatus: targetStatus,
          reason: cancelled === 1
            ? 'provider confirmed payment success and subscription cancellation'
            : 'provider confirmed payment success; subscription cancellation pending',
          metadata: {
            subscriptionCancelled: cancelled,
            paymentAmount: status.paymentAmount ?? null,
            paymentCurrency: status.paymentCurrency ?? null,
            paymentDetailsStatus: status.paymentDetailsStatus || 'missing'
          }
        });
        await connection.query(
          `INSERT INTO card_sync_jobs
           (id, card_id, status, requested_by, priority, dedupe_key)
           SELECT UUID(), c.id, 'PENDING', 'workflow', 10, CONCAT('post-recharge:', ?)
           FROM orders assigned_order INNER JOIN cards c ON c.id = assigned_order.assigned_card_id
           WHERE assigned_order.id = ?
             AND EXISTS (
               SELECT 1 FROM app_settings s
               WHERE s.setting_key = 'sync_card_transactions' AND s.setting_value = 'true'
             )
             AND NOT EXISTS (
               SELECT 1 FROM card_sync_jobs j
               WHERE j.card_id = c.id AND j.status IN ('PENDING','RUNNING')
             )
           ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key)`,
          [orderId, orderId]
        );
        if (cancelled !== 1) {
          await connection.query(
            `INSERT INTO tasks
             (order_id, task_type, status, dedupe_key, max_attempts, available_at)
             VALUES (?, 'RECHECK_CANCELLATION', 'PENDING', ?, 60,
                     DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND))`,
            [orderId, `recheck-cancellation:${orderId}`]
          );
        }
      });
    },

    async commitRechargeFailure(orderId, status = null) {
      return inTransaction(pool, async (connection) => {
        const failureReason = providerFailureReason(status);
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (![OrderStatus.RECHARGE_PROCESSING, OrderStatus.SUBMIT_UNKNOWN].includes(order.status)) {
          throw new Error(`Cannot commit recharge failure from ${order.status}`);
        }
        const [attemptResult] = await connection.query(
          `UPDATE recharge_attempts
           SET status = 'FAILED', funds_risk_state = 'CLEARED',
               result_summary_json = COALESCE(?, result_summary_json),
               last_reconciled_at = CURRENT_TIMESTAMP(3),
               finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP(3)),
               updated_at = CURRENT_TIMESTAMP(3)
           WHERE order_id = ? AND status IN ('PREPARED','PROCESSING','SUBMIT_UNKNOWN')
             AND funds_risk_state IN ('ACTIVE','UNKNOWN')`,
          [status == null ? null : JSON.stringify(status), orderId]
        );
        if (Number(attemptResult.affectedRows) !== 1) {
          throw new Error(`Recharge failure requires exactly one funds attempt: ${orderId}`);
        }
        await transitionCardConsumptionInTransaction(connection, {
          orderId,
          targetStatus: 'RECONCILIATION',
          requireActive: false,
          evidence: {
            source: 'workflow_provider_confirmed_failure_after_submission',
            reason: 'submitted attempt is not automatically released'
          }
        });
        await connection.query(
          `INSERT INTO card_sync_jobs
           (id, card_id, status, requested_by, priority, dedupe_key)
           SELECT UUID(), o.assigned_card_id, 'PENDING', 'workflow', 10, CONCAT('failed-recharge-reconcile:', ?)
           FROM orders o
           WHERE o.id = ? AND o.assigned_card_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM card_sync_jobs j
               WHERE j.card_id = o.assigned_card_id AND j.status IN ('PENDING','RUNNING')
             )
           ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key)`,
          [orderId, orderId]
        );
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, failure_code = 'PROVIDER_CONFIRMED_FAILURE',
             failure_reason = ?,
             customer_action_code = NULL, finished_at = CURRENT_TIMESTAMP(3),
             version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.RECHARGE_FAILED, failureReason, orderId, order.version]
        );
        if (result.affectedRows !== 1) {
          throw new Error(`Concurrent recharge failure detected: ${orderId}`);
        }
        await insertEvent(connection, {
          orderId, fromStatus: order.status, toStatus: OrderStatus.RECHARGE_FAILED,
          reason: 'provider confirmed failure', metadata: status
        });
      });
    },

    async commitCancellationStatus(orderId, status, latestSession = null, { exhausted = false } = {}) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.CANCELLATION_PENDING) {
          throw new Error(`Cannot commit cancellation check from ${order.status}`);
        }
        const encryptedSession = latestSession
          ? encryptSecret(JSON.stringify(latestSession), sessionEncryptionKey)
          : null;
        const cancelled = status.isSubscriptionCancelled === 1 ? 1 : 0;
        const reviewRequired = cancelled === 1 ? 0 : (exhausted ? 1 : 0);
        // 第④步（面三② 表一，D-248）：API 单取消续费超时不再阻塞交付。轮询用尽仍没确认
        // → 订单照常 RECHARGE_SUCCESS，只留 cancellation_review_required=1 这个事实标记，
        // 推手机提醒，这张卡靠该标记自动进待销清单（card-retirement-service）。
        // CANCELLATION_REVIEW_REQUIRED 这个订单状态从此不再由自动路径产生。
        const targetStatus = cancelled === 1 || exhausted
          ? OrderStatus.RECHARGE_SUCCESS
          : OrderStatus.CANCELLATION_PENDING;
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, session_ciphertext = COALESCE(?, session_ciphertext),
             actual_payment_amount = COALESCE(actual_payment_amount, ?),
             actual_payment_currency = COALESCE(actual_payment_currency, ?),
             subscription_cancelled = ?, cancellation_checked_at = CURRENT_TIMESTAMP(3),
             cancellation_review_required = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3),
             finished_at = CASE WHEN ? = 'RECHARGE_SUCCESS' THEN CURRENT_TIMESTAMP(3) ELSE NULL END
           WHERE id = ? AND version = ?`,
          [targetStatus, encryptedSession, status.paymentAmount ?? null, status.paymentCurrency ?? null,
            cancelled, reviewRequired, targetStatus, orderId, order.version]
        );
        if (result.affectedRows !== 1) throw new Error(`Concurrent cancellation check detected: ${orderId}`);
        if (targetStatus !== OrderStatus.CANCELLATION_PENDING) {
          await insertEvent(connection, {
            orderId, fromStatus: OrderStatus.CANCELLATION_PENDING, toStatus: targetStatus,
            reason: cancelled === 1
              ? 'subscription cancellation confirmed; fulfillment complete'
              : 'subscription cancellation could not be confirmed automatically; delivered anyway, card queued for retirement (D-248)',
            metadata: { subscriptionCancelled: cancelled, exhausted }
          });
        }
        if (cancelled !== 1 && exhausted) {
          const [[publicRow]] = await connection.query(
            'SELECT public_no FROM orders WHERE id = ? LIMIT 1', [orderId]
          );
          await connection.query(
            `INSERT INTO operator_alerts
             (id, alert_type, dedupe_key, order_id, severity, title, message, status)
             VALUES (UUID(), 'ORDER_CANCELLATION_UNCONFIRMED', ?, ?, 'warning', ?, ?, 'OPEN')
             ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
               order_id = VALUES(order_id), message = VALUES(message),
               status = IF(status = 'RESOLVED', 'OPEN', status),
               acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
            [`order-cancellation-unconfirmed:${orderId}`, orderId,
              '取消续费未确认，订单已交付，卡进待销清单',
              `订单 ${publicRow?.public_no || orderId}｜ZZSHU 轮询用尽仍未确认取消续费。订单已按成功交付，不卡单；这张卡已进待销清单，到存活期请在卡台删掉，删完在后台点「已销卡」。`]
          );
        }
      });
    },

    async commitCardTransactions(orderId, transactions, cardSnapshot = null) {
      return inTransaction(pool, async (connection) => {
        const [cards] = await connection.query(
          `SELECT c.id FROM orders o INNER JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
           WHERE o.id = ? FOR UPDATE`, [orderId]
        );
        if (cards.length !== 1) throw new Error(`Card not found for order: ${orderId}`);
        await persistCardTransactions(connection, {
          cardId: cards[0].id,
          orderId,
          transactions,
          cardSnapshot
        });
      });
    }
  };
}
