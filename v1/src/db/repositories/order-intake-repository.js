import { OrderIntakeError } from '../../domain/order-intake-error.js';
import { OrderStatus } from '../../domain/order-status.js';

const REQUIRED_SETTINGS = Object.freeze([
  'accept_new_orders',
  'default_card_type_id',
  'default_open_card_amount'
]);

function parseSettings(rows) {
  const values = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  for (const key of REQUIRED_SETTINGS) {
    if (!values.has(key)) {
      throw new OrderIntakeError('Order intake is not configured', {
        code: 'ORDERING_NOT_CONFIGURED',
        status: 503
      });
    }
  }
  if (values.get('accept_new_orders') !== 'true') {
    throw new OrderIntakeError('New orders are currently paused', {
      code: 'ORDERING_PAUSED',
      status: 503
    });
  }
  const cardTypeId = String(values.get('default_card_type_id') || '').trim();
  const amountText = String(values.get('default_open_card_amount') || '').trim();
  const amount = Number(amountText);
  if (
    !cardTypeId
    || cardTypeId.length > 128
    || !/^\d+$/.test(amountText)
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || amount > 999_999_999_999
  ) {
    throw new OrderIntakeError('Order intake is not configured', {
      code: 'ORDERING_NOT_CONFIGURED',
      status: 503
    });
  }
  return { cardTypeId, openCardAmount: amountText };
}

export async function createOrderFromCdk(pool, input) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = REQUIRED_SETTINGS.map(() => '?').join(', ');
    const [settingRows] = await connection.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN (${placeholders}) FOR UPDATE`,
      REQUIRED_SETTINGS
    );
    const settings = parseSettings(settingRows);

    const [cdkRows] = await connection.query(
      'SELECT id, status FROM cdks WHERE code_hash = ? FOR UPDATE',
      [input.cdkHash]
    );
    if (cdkRows.length !== 1 || cdkRows[0].status !== 'AVAILABLE') {
      throw new OrderIntakeError('CDK is invalid or unavailable', {
        code: 'CDK_UNAVAILABLE',
        status: 409
      });
    }
    const cdkId = cdkRows[0].id;

    await connection.query(
      `INSERT INTO orders
       (id, public_no, cdk_id, status, plan_type, customer_email,
        chatgpt_account_id, card_type_id, open_card_amount,
        session_ciphertext, card_purchase_idempotency_key)
       VALUES (?, ?, ?, ?, 'plus', ?, ?, ?, ?, ?, ?)`,
      [
        input.orderId,
        input.publicNo,
        cdkId,
        OrderStatus.CREATED,
        input.customerEmail,
        input.chatgptAccountId,
        settings.cardTypeId,
        settings.openCardAmount,
        input.sessionCiphertext,
        input.cardPurchaseIdempotencyKey
      ]
    );
    const [cdkUpdate] = await connection.query(
      `UPDATE cdks SET status = 'REDEEMED', order_id = ?,
         redeemed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'AVAILABLE'`,
      [input.orderId, cdkId]
    );
    if (cdkUpdate.affectedRows !== 1) {
      throw new OrderIntakeError('CDK is invalid or unavailable', {
        code: 'CDK_UNAVAILABLE',
        status: 409
      });
    }
    await connection.query(
      `INSERT INTO order_events
       (order_id, from_status, to_status, actor_type, reason)
       VALUES (?, NULL, ?, 'CUSTOMER', 'order created from CDK')`,
      [input.orderId, OrderStatus.CREATED]
    );
    await connection.query(
      `INSERT INTO tasks
       (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'PURCHASE_CARD', 'PENDING', ?, 5)`,
      [input.orderId, `purchase-card:${input.orderId}`]
    );
    await connection.commit();
    return {
      orderId: input.orderId,
      publicNo: input.publicNo,
      status: OrderStatus.CREATED
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
