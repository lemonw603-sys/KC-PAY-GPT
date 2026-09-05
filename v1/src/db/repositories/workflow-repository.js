import crypto from 'node:crypto';
import { transitionOrder } from './order-repository.js';
import { OrderStatus } from '../../domain/order-status.js';
import { decryptSecret, encryptSecret } from '../../security/secret-box.js';
import { redactSensitiveText } from '../../security/redaction.js';
import { persistCardTransactions } from './card-transaction-repository.js';
import {
  eligibleInventoryCardSql,
  fundableInventoryCardSql,
  refreshableInventoryCardSql
} from '../../services/card-inventory-eligibility.js';
import {
  reserveCardConsumptionInTransaction,
  transitionCardConsumptionInTransaction
} from '../../services/card-consumption-ledger-service.js';

function topUpAmount(minimum, current) {
  const delta = Number(minimum) - Number(current || 0);
  // HNSKJ card recharge contract accepts whole USD amounts only. Round up so
  // a fractional deficit (e.g. $15.99) is sent as $16 rather than rejected
  // locally after creating a funding attempt.
  return String(Math.max(1, Math.ceil(delta)));
}

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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
                fr.card_provider_account_id,
                fr.recharge_provider_account_id,
                fr.executor_kind AS recharge_executor_kind,
                c.id AS local_card_id,
                c.provider_account_id AS stored_card_provider_account_id,
                c.provider_card_id,
                c.card_type_id AS stored_card_type_id,
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
        await insertEvent(connection, {
          orderId, fromStatus: order.status, toStatus: OrderStatus.WAITING_FOR_SESSION,
          reason: 'target account requires a customer-provided replacement Session',
          metadata: { failureCode, customerActionCode, replacementWindowHours: hours }
        });
      });
    },

    async assignAvailableCard(orderId) {
      return inTransaction(pool, async (connection) => {
        const [orders] = await connection.query(
          `SELECT o.status, o.version, o.card_type_id, o.product_id, o.open_card_amount,
                  o.minimum_required_card_balance,
                  o.fulfillment_route_id, fr.card_provider_account_id
           FROM orders o LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
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
        const [cards] = await connection.query(
          `SELECT id, provider_card_id, current_balance
           FROM cards
           WHERE ${eligibleInventoryCardSql('cards', '?')}
             AND EXISTS (SELECT 1 FROM fulfillment_route_card_sources src
                         WHERE src.fulfillment_route_id = ?
                           AND src.provider_account_id = cards.provider_account_id
                           AND src.enabled = 1)
           ORDER BY current_balance ASC, created_at ASC
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [String(order.minimum_required_card_balance), order.fulfillment_route_id]
        );
        const alertKey = `order-waiting-card:${orderId}`;
        if (cards.length === 0) {
          const [refreshCandidates] = await connection.query(
            `SELECT id FROM cards
             WHERE ${refreshableInventoryCardSql('cards')}
               AND sync_tier <> 'MANUAL_IMPORT'
               AND EXISTS (SELECT 1 FROM fulfillment_route_card_sources src
                           WHERE src.fulfillment_route_id = ?
                             AND src.provider_account_id = cards.provider_account_id
                             AND src.enabled = 1)
               AND (last_transaction_synced_at IS NULL
                 OR last_transaction_synced_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))
               AND NOT EXISTS (
                 SELECT 1 FROM card_sync_jobs exhausted_sync
                 WHERE exhausted_sync.card_id = cards.id
                   AND exhausted_sync.status = 'REVIEW_REQUIRED'
                   AND exhausted_sync.completed_at >= COALESCE(
                     cards.last_transaction_synced_at, cards.created_at)
               )
             ORDER BY COALESCE(last_transaction_synced_at, created_at) ASC
             LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [order.fulfillment_route_id]
          );
          let refreshQueued = false;
          if (refreshCandidates.length > 0) {
            const cardId = refreshCandidates[0].id;
            const [queued] = await connection.query(
              `INSERT INTO card_sync_jobs
              (id, card_id, status, requested_by, priority, dedupe_key)
               SELECT ?, ?, 'PENDING', 'worker', 10, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM card_sync_jobs active_sync
                 WHERE active_sync.card_id = ? AND active_sync.status IN ('PENDING','RUNNING')
               )`,
              [crypto.randomUUID(), cardId, `order-demand-sync:${cardId}:${crypto.randomUUID()}`, cardId]
            );
            refreshQueued = Number(queued.affectedRows) === 1;
          }
          const [[fundable]] = await connection.query(
            `SELECT COUNT(*) AS count FROM cards
             WHERE ${fundableInventoryCardSql('cards')}
               AND provider_account_id = ?`,
            [order.card_provider_account_id]
          );
          let fundingQueued = false;
          const [[underfunded]] = await connection.query(
            `SELECT c.id, c.current_balance
             FROM cards c
             WHERE ${fundableInventoryCardSql('c')}
               AND c.provider_account_id = ?
               AND c.current_balance < ?
             ORDER BY c.current_balance DESC, c.updated_at ASC
             LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [order.card_provider_account_id, String(order.minimum_required_card_balance)]
          );
          const [supplySettings] = await connection.query(
            `SELECT setting_key, setting_value FROM app_settings
             WHERE setting_key IN ('card_auto_replenishment_enabled','card_balance_recharge_enabled')`
          );
          const autoReplenishmentEnabled = supplySettings.some(
            (row) => row.setting_key === 'card_auto_replenishment_enabled'
              && row.setting_value === 'true'
          );
          const balanceFundingEnabled = supplySettings.some(
            (row) => row.setting_key === 'card_balance_recharge_enabled'
              && row.setting_value === 'true'
          );
          if (underfunded && balanceFundingEnabled) {
            const amount = topUpAmount(
              order.minimum_required_card_balance,
              underfunded.current_balance
            );
            const [priorFunding] = await connection.query(
              `SELECT status, funds_risk_state, result_summary_json
               FROM card_funding_attempts
               WHERE order_id = ? AND card_id = ?
               ORDER BY created_at DESC, id DESC FOR UPDATE`,
              [orderId, underfunded.id]
            );
            const lastFunding = priorFunding[0] || null;
            const retryDisposition = jsonObject(lastFunding?.result_summary_json).retryDisposition;
            const mayPrepare = priorFunding.length === 0 || (
              priorFunding.length < 3
              && lastFunding.status === 'FAILED'
              && lastFunding.funds_risk_state === 'CLEARED'
              && retryDisposition === 'AUTO_RETRY'
            );
            if (mayPrepare) {
              const attemptNo = priorFunding.length + 1;
              const fundingKey = `order-card-funding:${orderId}:${underfunded.id}:v${attemptNo}`;
              const [fundingInsert] = await connection.query(
                `INSERT INTO card_funding_attempts
               (id, card_id, order_id, provider_account_id, amount, currency, status,
                funds_risk_state, idempotency_key)
               VALUES (?, ?, ?, ?, ?, 'USD', 'PREPARED', 'NONE', ?)
               ON DUPLICATE KEY UPDATE id = id`,
                [crypto.randomUUID(), underfunded.id, orderId, order.card_provider_account_id,
                  amount, fundingKey]
              );
              fundingQueued = Number(fundingInsert.affectedRows) === 1;
            }
          }
          // A stale local card is not proof that inventory is absent. Wait for
          // the already queued read sync before spending money on a new card;
          // the retry will fund or assign it when the refreshed evidence allows.
          // WAITING_FOR_CARD itself is the durable replenishment trigger. Do
          // not create a paid stock job here: that bypassed the scheduler's
          // live rule, balance and daily-limit checks and recreated a failed
          // job on every order retry.
          const replenishmentPending = autoReplenishmentEnabled
            && Number(fundable?.count || 0) === 0
            && refreshCandidates.length === 0;
          const waitingMessage = refreshCandidates.length > 0
            ? '现有卡正在更新余额和交易，订单会在更新后继续处理。'
            : fundingQueued
              ? '现有卡余额不足，已自动补足，订单会继续处理。'
              : replenishmentPending
                ? '当前没有可用卡，已自动安排开卡，订单会继续处理。'
                : '当前没有可用于 Plus 的卡，订单正在等待处理。';
          const autoHealing = refreshCandidates.length > 0 || fundingQueued || replenishmentPending;
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
            refreshQueued,
            ...(fundingQueued ? { fundingQueued: true } : {}),
            ...(replenishmentPending ? { replenishmentPending: true } : {})
          };
        }
        const card = cards[0];
        const [[capacitySetting]] = await connection.query(
          `SELECT setting_value FROM app_settings
           WHERE setting_key='card_max_successful_payments' LIMIT 1 FOR SHARE`
        );
        const maxPayments = Number(capacitySetting?.setting_value || 3);
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
        const [thresholdRows] = await connection.query(
          `SELECT setting_key, setting_value FROM app_settings
           WHERE setting_key IN ('card_stock_low_threshold', 'card_auto_replenishment_enabled')`
        );
        const [stockRows] = await connection.query(
          `SELECT COUNT(*) AS count FROM cards
           WHERE ${eligibleInventoryCardSql('cards', '?')}
             AND provider_account_id = ?`,
          [String(order.minimum_required_card_balance), order.card_provider_account_id]
        );
        const threshold = Math.max(0, Number(thresholdRows.find((row) => row.setting_key === 'card_stock_low_threshold')?.setting_value || 5));
        const autoReplenishmentEnabled = thresholdRows.some((row) => row.setting_key === 'card_auto_replenishment_enabled' && row.setting_value === 'true');
        const remaining = Number(stockRows[0]?.count || 0);
        if (remaining <= threshold && !autoReplenishmentEnabled) {
          await connection.query(
            `INSERT INTO operator_alerts
             (id, alert_type, dedupe_key, severity, title, message, status)
             VALUES (UUID(), 'CARD_STOCK_LOW', ?, 'warning', '可用卡库存偏低', ?, 'OPEN')
             ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
               message = VALUES(message),
               status = IF(status = 'RESOLVED', 'OPEN', status),
               acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
            [`card-stock-low:${order.card_provider_account_id}:plus`,
              `Plus 可直接分配卡剩余 ${remaining} 张，阈值为 ${threshold}。`]
          );
        } else {
          await connection.query(
            `UPDATE operator_alerts SET status='RESOLVED',
               acknowledged_at=COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))
             WHERE dedupe_key=? AND status='OPEN'`,
            [`card-stock-low:${order.card_provider_account_id}:plus`]
          );
        }
        return {
          providerCardId: String(card.provider_card_id),
          currentBalance: String(card.current_balance),
          remaining
        };
      });
    },

    async beginCardPurchase(orderId, taskId, baseline) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.CREATED) {
          throw new Error(`Cannot begin card purchase from ${order.status}`);
        }
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_PURCHASING, orderId, order.version]
        );
        if (result.affectedRows !== 1) throw new Error(`Concurrent card purchase detected: ${orderId}`);
        await connection.query(
          `UPDATE tasks SET payload_json = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND order_id = ? AND task_type = 'PURCHASE_CARD'`,
          [JSON.stringify({ ...baseline, phase: 'PURCHASE_STARTING' }), taskId, orderId]
        );
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.CREATED,
          toStatus: OrderStatus.CARD_PURCHASING,
          reason: 'card purchase baseline persisted before provider write',
          metadata: {
            cardTypeId: String(baseline.cardTypeId),
            existingCardCount: baseline.existingCardIds.length
          }
        });
      });
    },

    async markCardPurchaseAccepted(orderId, taskId, baseline) {
      await pool.query(
        `UPDATE tasks SET payload_json = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND order_id = ? AND task_type = 'PURCHASE_CARD'`,
        [JSON.stringify({ ...baseline, phase: 'PURCHASE_ACCEPTED' }), taskId, orderId]
      );
    },

    reviewCardPurchase(orderId, reason, metadata = null) {
      return this.transition(orderId, OrderStatus.RECONCILIATION_REQUIRED, reason, metadata);
    },

    async commitPurchasedCard(orderId, card) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          `SELECT o.status, o.version, o.product_id, o.open_card_amount,
                  fr.card_provider_account_id
           FROM orders o LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
           WHERE o.id = ? FOR UPDATE`,
          [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.CARD_PURCHASING) {
          throw new Error(`Cannot commit card from order state ${order.status}`);
        }
        if (!order.card_provider_account_id) {
          throw new Error(`Order route has no card provider account: ${orderId}`);
        }

        await connection.query(
          `INSERT INTO cards
           (id, provider_account_id, order_id, inventory_status, intake_status, assigned_at,
            provider_card_id, external_card_id, card_type_id, last4, status,
            funded_amount, current_balance, currency, refund_status, sync_tier)
           VALUES (UUID(), ?, ?, 'ASSIGNED', 'ACCEPTED', CURRENT_TIMESTAMP(3),
             ?, ?, ?, ?, ?, ?, ?, ?, 'MONITORING', 'PROVISIONING')`,
          [
            order.card_provider_account_id,
            orderId,
            String(card.providerCardId),
            String(card.providerCardId),
            String(card.cardTypeId),
            card.last4 || null,
            card.status || 'PROVISIONING',
            String(card.fundedAmount),
            card.currentBalance == null ? null : String(card.currentBalance),
            card.currency || 'USD'
          ]
        );
        const [insertedCards] = await connection.query(
          `SELECT id FROM cards
           WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ?
           LIMIT 1 FOR UPDATE`,
          [order.card_provider_account_id, String(card.providerCardId)]
        );
        if (insertedCards.length !== 1) {
          throw new Error(`Purchased card cannot be resolved after insert: ${card.providerCardId}`);
        }
        await connection.query(
          `INSERT INTO card_assignment_history
           (id, card_id, order_id, assignment_kind, status, assigned_by,
            assignment_reason, assigned_at, evidence_json)
           VALUES (UUID(), ?, ?, 'PURCHASED_FOR_ORDER', 'ACTIVE', 'worker:purchase-card',
             'card purchased for this order', CURRENT_TIMESTAMP(3), ?)`,
          [insertedCards[0].id, orderId, JSON.stringify({
            providerCardId: String(card.providerCardId),
            fundedAmount: String(card.fundedAmount),
            currency: card.currency || 'USD'
          })]
        );
        const [[capacitySetting]] = await connection.query(
          `SELECT setting_value FROM app_settings
           WHERE setting_key='card_max_successful_payments' LIMIT 1 FOR SHARE`
        );
        await reserveCardConsumptionInTransaction(connection, {
          cardId: insertedCards[0].id,
          orderId,
          productId: order.product_id,
          amount: order.open_card_amount,
          currency: card.currency || 'USD',
          maxPayments: Number(capacitySetting?.setting_value || 3),
          evidence: { source: 'card_purchase_assignment', providerCardId: String(card.providerCardId) }
        });
        const [updateResult] = await connection.query(
          `UPDATE orders SET status = ?, assigned_card_id = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_PROVISIONING, insertedCards[0].id, orderId, order.version]
        );
        if (updateResult.affectedRows !== 1) {
          throw new Error(`Concurrent card commit detected: ${orderId}`);
        }
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.CARD_PURCHASING,
          toStatus: OrderStatus.CARD_PROVISIONING,
          reason: 'card purchase committed; awaiting final card readiness',
          metadata: { providerCardId: String(card.providerCardId), last4: card.last4 || null }
        });
        await connection.query(
          `INSERT INTO tasks
           (order_id, task_type, status, dedupe_key, max_attempts)
           VALUES (?, 'VERIFY_CARD', 'PENDING', ?, 240)`,
          [orderId, `verify-card:${orderId}`]
        );
      });
    },

    async commitCardReady(orderId, snapshot, credentials) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.CARD_PROVISIONING) {
          throw new Error(`Cannot commit ready card from ${order.status}`);
        }
        const normalizedPan = String(credentials.cardNumber || '').replace(/[\s-]/g, '');
        const panHmac = Buffer.isBuffer(panHmacKey) && /^\d{12,19}$/.test(normalizedPan)
          ? crypto.createHmac('sha256', panHmacKey).update(normalizedPan).digest('hex') : null;
        await connection.query(
          `UPDATE cards SET status = ?, last4 = COALESCE(?, last4),
             current_balance = ?, currency = ?, last_synced_at = CURRENT_TIMESTAMP(3),
             card_credentials_ciphertext = ?, card_number_ciphertext = ?,
             pan_hmac = COALESCE(?, pan_hmac),
             pan_hmac_version = CASE WHEN ? IS NULL THEN pan_hmac_version ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP(3) WHERE id = (
               SELECT assigned_card_id FROM orders WHERE id = ?
             )`,
          [snapshot.status, snapshot.last4 || null, String(snapshot.currentBalance),
            snapshot.currency || 'USD', encryptSecret(JSON.stringify(credentials), sessionEncryptionKey),
            encryptSecret(credentials.cardNumber, sessionEncryptionKey), panHmac, panHmac, orderId]
        );
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_READY, orderId, order.version]
        );
        if (result.affectedRows !== 1) throw new Error(`Concurrent card readiness commit detected: ${orderId}`);
        await insertEvent(connection, {
          orderId, fromStatus: OrderStatus.CARD_PROVISIONING, toStatus: OrderStatus.CARD_READY,
          reason: 'card status, balance and credentials confirmed',
          metadata: { last4: snapshot.last4 || null, currentBalance: String(snapshot.currentBalance) }
        });
        await connection.query(
          `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
           VALUES (?, 'PREPARE_RECHARGE', 'PENDING', ?, 5)`,
          [orderId, `prepare-recharge:${orderId}`]
        );
        await connection.query(
          `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
           VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)`,
          [orderId, `submit-recharge:${orderId}`]
        );
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

    async failCardProvisioning(orderId, snapshot) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE', [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.CARD_PROVISIONING) {
          throw new Error(`Cannot fail card from ${order.status}`);
        }
        await connection.query(
          `UPDATE cards SET status = ?, current_balance = COALESCE(?, current_balance),
             last_synced_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
           WHERE order_id = ?`,
          [snapshot.status || 'FAILED', snapshot.currentBalance == null ? null : String(snapshot.currentBalance), orderId]
        );
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, failure_code = ?, failure_reason = ?,
             version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_FAILED, snapshot.failureCode || 'CARD_PROVISIONING_FAILED',
            snapshot.failureReason || 'Card provisioning failed', orderId, order.version]
        );
        if (result.affectedRows !== 1) throw new Error(`Concurrent card failure detected: ${orderId}`);
        await insertEvent(connection, {
          orderId, fromStatus: OrderStatus.CARD_PROVISIONING, toStatus: OrderStatus.CARD_FAILED,
          reason: snapshot.failureReason || 'card provisioning failed',
          metadata: { cardStatus: snapshot.status || 'FAILED' }
        });
      });
    },

    async reviewCardProvisioning(orderId, reason = 'card provisioning timed out') {
      return this.transition(orderId, OrderStatus.RECONCILIATION_REQUIRED, reason);
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
        const targetStatus = cancelled === 1
          ? OrderStatus.RECHARGE_SUCCESS
          : (exhausted ? OrderStatus.CANCELLATION_REVIEW_REQUIRED : OrderStatus.CANCELLATION_PENDING);
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
              : 'subscription cancellation could not be confirmed automatically',
            metadata: { subscriptionCancelled: cancelled, exhausted }
          });
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
