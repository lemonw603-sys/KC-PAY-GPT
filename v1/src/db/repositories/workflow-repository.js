import crypto from 'node:crypto';
import { transitionOrder } from './order-repository.js';
import { OrderStatus } from '../../domain/order-status.js';
import { decryptSecret, encryptSecret } from '../../security/secret-box.js';
import { persistCardTransactions } from './card-transaction-repository.js';
import { eligibleInventoryCardSql } from '../../services/card-inventory-eligibility.js';
import { transitionCardConsumptionInTransaction } from '../../services/card-consumption-ledger-service.js';

function parseSession(ciphertext, key) {
  const text = decryptSecret(ciphertext, key);
  const session = JSON.parse(text);
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('Stored Session is not a JSON object');
  }
  return session;
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
                c.card_credentials_ciphertext
         FROM orders o
         LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
         LEFT JOIN cards c ON c.order_id = o.id
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
          `SELECT o.status, o.version, o.card_type_id, o.minimum_required_card_balance,
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
             AND provider_account_id = ?
             AND BINARY card_type_id = BINARY ?
           ORDER BY current_balance ASC, created_at ASC
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [String(order.minimum_required_card_balance), order.card_provider_account_id,
            String(order.card_type_id)]
        );
        const alertKey = `card-stock-low:${order.card_provider_account_id}:${order.card_type_id}`;
        if (cards.length === 0) {
          await connection.query(
            `INSERT INTO operator_alerts
             (id, alert_type, dedupe_key, severity, title, message, status)
             VALUES (UUID(), 'CARD_STOCK_LOW', ?, 'critical', '可用卡库存不足', ?, 'OPEN')
             ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
               message = VALUES(message), status = 'OPEN', acknowledged_at = NULL`,
            [alertKey, `卡段 ${order.card_type_id} 没有满足余额要求的可用库存卡，订单正在安全等待。`]
          );
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
          return { waitingForCard: true };
        }
        const card = cards[0];
        const [cardUpdate] = await connection.query(
          `UPDATE cards SET order_id = ?, inventory_status = 'ASSIGNED',
             assigned_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND order_id IS NULL AND inventory_status = 'AVAILABLE'`,
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
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_READY, orderId, order.version]
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
          `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
           VALUES (?, 'PREPARE_RECHARGE', 'PENDING', ?, 5),
                  (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)
           ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
          [orderId, `prepare-recharge:${orderId}`, orderId, `submit-recharge:${orderId}`]
        );
        const [thresholdRows] = await connection.query(
          `SELECT setting_value FROM app_settings
           WHERE setting_key = 'card_stock_low_threshold' LIMIT 1`
        );
        const [stockRows] = await connection.query(
          `SELECT COUNT(*) AS count FROM cards
           WHERE ${eligibleInventoryCardSql('cards', '?')}
             AND provider_account_id = ?
             AND BINARY card_type_id = BINARY ?`,
          [String(order.minimum_required_card_balance), order.card_provider_account_id,
            String(order.card_type_id)]
        );
        const threshold = Math.max(0, Number(thresholdRows[0]?.setting_value || 5));
        const remaining = Number(stockRows[0]?.count || 0);
        if (remaining <= threshold) {
          await connection.query(
            `INSERT INTO operator_alerts
             (id, alert_type, dedupe_key, severity, title, message, status)
             VALUES (UUID(), 'CARD_STOCK_LOW', ?, 'warning', '可用卡库存偏低', ?, 'OPEN')
             ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
               message = VALUES(message), status = 'OPEN', acknowledged_at = NULL`,
            [alertKey, `卡段 ${order.card_type_id} 剩余 ${remaining} 张可用库存卡，阈值为 ${threshold}。`]
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
          `SELECT o.status, o.version, fr.card_provider_account_id
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
        const [updateResult] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_PROVISIONING, orderId, order.version]
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
             updated_at = CURRENT_TIMESTAMP(3) WHERE order_id = ?`,
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
           FROM orders o INNER JOIN cards c ON c.order_id = o.id
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
        await connection.query(
          `UPDATE cards SET card_credentials_ciphertext = NULL, updated_at = CURRENT_TIMESTAMP(3)
           WHERE order_id = ?`, [orderId]
        );
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
           (id, card_id, status, requested_by, dedupe_key)
           SELECT UUID(), c.id, 'PENDING', 'workflow', CONCAT('post-recharge:', ?)
           FROM cards c
           WHERE c.order_id = ?
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
        const [result] = await connection.query(
          `UPDATE orders SET status = ?, failure_code = 'PROVIDER_CONFIRMED_FAILURE',
             failure_reason = 'Recharge provider confirmed failure',
             customer_action_code = NULL, finished_at = CURRENT_TIMESTAMP(3),
             version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.RECHARGE_FAILED, orderId, order.version]
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
          'SELECT id FROM cards WHERE order_id = ? FOR UPDATE', [orderId]
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
