import { transitionOrder } from './order-repository.js';
import { OrderStatus } from '../../domain/order-status.js';
import { decryptSecret } from '../../security/secret-box.js';

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

export function createWorkflowRepository(pool, { sessionEncryptionKey }) {
  return {
    async loadOrderContext(orderId) {
      const [rows] = await pool.query(
        `SELECT o.*,
                c.id AS local_card_id,
                c.provider_card_id,
                c.card_type_id AS stored_card_type_id,
                c.last4,
                c.status AS card_status
         FROM orders o
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
          open_card_amount: row.open_card_amount
        },
        card: row.provider_card_id ? {
          id: row.local_card_id,
          provider_card_id: row.provider_card_id,
          card_type_id: row.stored_card_type_id,
          last4: row.last4,
          status: row.card_status
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

    async commitPurchasedCard(orderId, card) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.query(
          'SELECT status, version FROM orders WHERE id = ? FOR UPDATE',
          [orderId]
        );
        if (rows.length !== 1) throw new Error(`Order not found: ${orderId}`);
        const order = rows[0];
        if (order.status !== OrderStatus.CARD_PURCHASING) {
          throw new Error(`Cannot commit card from order state ${order.status}`);
        }

        await connection.query(
          `INSERT INTO cards
           (id, order_id, provider_card_id, card_type_id, last4, status,
            funded_amount, current_balance, currency, refund_status)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'MONITORING')`,
          [
            orderId,
            String(card.providerCardId),
            String(card.cardTypeId),
            card.last4 || null,
            card.status || 'ACTIVE',
            String(card.fundedAmount),
            card.currentBalance == null ? null : String(card.currentBalance),
            card.currency || 'USD'
          ]
        );
        const [updateResult] = await connection.query(
          `UPDATE orders SET status = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
          [OrderStatus.CARD_READY, orderId, order.version]
        );
        if (updateResult.affectedRows !== 1) {
          throw new Error(`Concurrent card commit detected: ${orderId}`);
        }
        await insertEvent(connection, {
          orderId,
          fromStatus: OrderStatus.CARD_PURCHASING,
          toStatus: OrderStatus.CARD_READY,
          reason: 'card purchase committed',
          metadata: { providerCardId: String(card.providerCardId), last4: card.last4 || null }
        });
        await connection.query(
          `INSERT INTO tasks
           (order_id, task_type, status, dedupe_key, max_attempts)
           VALUES (?, 'SUBMIT_RECHARGE', 'PENDING', ?, 5)`,
          [orderId, `submit-recharge:${orderId}`]
        );
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
    }
  };
}
