import { OrderIntakeError } from '../../domain/order-intake-error.js';
import { OrderStatus } from '../../domain/order-status.js';
import { CDK_RETURN_ORDER_STATUSES, returnCdkForOrderInTransaction } from './cdk-return-repository.js';
import { upsertBrowserAlertInTransaction } from './browser-alert-repository.js';
import { replaceCustomerSessionInTransaction } from './session-replacement-repository.js';

const REQUIRED_SETTINGS = Object.freeze([
  'accept_new_orders',
  'default_card_type_id',
  'default_open_card_amount',
  'default_minimum_required_card_balance'
]);
// Per-product minimum card balance (Pro stages charge more than Plus). Optional:
// a missing or malformed value falls back to the Plus default.
const PLAN_MINIMUM_SETTINGS = Object.freeze({
  pro_5x: 'minimum_required_card_balance:pro_5x',
  pro_20x: 'minimum_required_card_balance:pro_20x'
});
const INTAKE_SETTING_KEYS = Object.freeze([...REQUIRED_SETTINGS, ...Object.values(PLAN_MINIMUM_SETTINGS)]);
const MINIMUM_PATTERN = /^\d+(?:\.\d{1,6})?$/;

export function minimumRequiredCardBalanceForPlan(settings, planType) {
  const key = PLAN_MINIMUM_SETTINGS[String(planType || '').trim().toLowerCase()];
  const override = key ? settings.minimumRequiredCardBalanceByPlan?.[key.split(':')[1]] : null;
  return override || settings.minimumRequiredCardBalance;
}

export function parseOrderIntakeSettings(rows) {
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
  const minimumBalanceText = String(values.get('default_minimum_required_card_balance') || '').trim();
  const amount = Number(amountText);
  const minimumBalance = Number(minimumBalanceText);
  if (
    !cardTypeId
    || cardTypeId.length > 128
    || !/^\d+$/.test(amountText)
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || amount > 999_999_999_999
    || !/^\d+(?:\.\d{1,6})?$/.test(minimumBalanceText)
    || !Number.isFinite(minimumBalance)
    || minimumBalance <= 0
    || minimumBalance > amount
  ) {
    throw new OrderIntakeError('Order intake is not configured', {
      code: 'ORDERING_NOT_CONFIGURED',
      status: 503
    });
  }
  const minimumRequiredCardBalanceByPlan = {};
  for (const [plan, key] of Object.entries(PLAN_MINIMUM_SETTINGS)) {
    const text = String(values.get(key) || '').trim();
    if (MINIMUM_PATTERN.test(text) && Number(text) > 0 && Number(text) <= 100000) minimumRequiredCardBalanceByPlan[plan] = text;
  }
  return {
    cardTypeId,
    openCardAmount: amountText,
    minimumRequiredCardBalance: minimumBalanceText,
    minimumRequiredCardBalanceByPlan
  };
}

export async function createOrderFromCdk(pool, input) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = INTAKE_SETTING_KEYS.map(() => '?').join(', ');
    const [settingRows] = await connection.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN (${placeholders}) FOR UPDATE`,
      INTAKE_SETTING_KEYS
    );
    const settings = parseOrderIntakeSettings(settingRows);

    const [cdkRows] = await connection.query(
      `SELECT id, status, plan_type, batch_no FROM cdks
       WHERE (hash_version = ? AND code_hash = ?)
          OR (hash_version = ? AND code_hash = ?)
       LIMIT 2 FOR UPDATE`,
      [
        input.cdkLookup.current.version, input.cdkLookup.current.hash,
        input.cdkLookup.legacy.version, input.cdkLookup.legacy.hash
      ]
    );
    if (cdkRows.length === 1 && cdkRows[0].status === 'REDEEMED') {
      // A bound CDK belongs to one order. The same customer submitting the
      // same code again gets that order back instead of a rejection; an
      // order that already ended without any payment hands the CDK back so
      // the submission below can proceed as a fresh order.
      const [boundOrders] = await connection.query(
        `SELECT id, public_no, status, version, customer_email, chatgpt_account_id,
                customer_action_code, session_replacement_count, assigned_card_id
         FROM orders WHERE id = (SELECT order_id FROM cdks WHERE id = ?) LIMIT 1 FOR UPDATE`,
        [cdkRows[0].id]
      );
      const bound = boundOrders[0] || null;
      const sameAccount = bound && (
        (input.chatgptAccountId && bound.chatgpt_account_id === input.chatgptAccountId)
        || (input.customerEmail && String(bound.customer_email || '').toLowerCase() === String(input.customerEmail).toLowerCase())
      );
      if (bound && CDK_RETURN_ORDER_STATUSES.includes(bound.status)) {
        const released = await returnCdkForOrderInTransaction(connection, {
          orderId: bound.id, reason: 'customer resubmitted the code after a no-payment ending',
          actorType: 'CUSTOMER', actorId: 'customer', metadata: { publicNo: bound.public_no },
        });
        if (released.returned) cdkRows[0] = { ...cdkRows[0], status: 'AVAILABLE' };
      } else if (bound && bound.status === 'WAITING_FOR_SESSION') {
        // F-34 / F-35: the order was sent back for a new Session. Whatever the
        // customer submits now with the same code IS the replacement, from the
        // same account or from another free account. Same code, same order:
        // no second order, no dropped Session.
        let replaced;
        try {
          replaced = await replaceCustomerSessionInTransaction(connection, {
            order: bound, sessionCiphertext: input.sessionCiphertext,
            customerEmail: input.customerEmail, chatgptAccountId: input.chatgptAccountId,
            actorType: 'CUSTOMER', reason: 'customer resubmitted the code with a new Session',
          });
        } catch (error) {
          if (['FUNDS_STATE_UNSAFE', 'SESSION_REPLACEMENT_CONFLICT'].includes(error?.code)) {
            throw new OrderIntakeError('CDK is invalid or unavailable', { code: 'CDK_UNAVAILABLE', status: 409 });
          }
          throw error;
        }
        await connection.commit();
        return { orderId: bound.id, publicNo: bound.public_no, status: replaced.resumeStatus, reused: true, sessionReplaced: true };
      } else if (bound && sameAccount) {
        await connection.commit();
        return { orderId: bound.id, publicNo: bound.public_no, status: bound.status, reused: true };
      }
    }
    if (cdkRows.length !== 1 || cdkRows[0].status !== 'AVAILABLE') {
      throw new OrderIntakeError('CDK is invalid or unavailable', {
        code: 'CDK_UNAVAILABLE',
        status: 409
      });
    }
    const cdkId = cdkRows[0].id;

    const [routeRows] = await connection.query(
      `SELECT p.id AS product_id, fr.id AS fulfillment_route_id, fr.executor_kind,
              CASE WHEN fr.executor_kind='API' THEN fr.card_provider_account_id
                   ELSE bcs.provider_account_id END AS frozen_card_provider_account_id
       FROM products p INNER JOIN fulfillment_routes fr ON fr.product_id = p.id
       LEFT JOIN browser_card_source_selections bcs ON bcs.product_id=p.id
       INNER JOIN provider_accounts cpa ON cpa.id=CASE
         WHEN fr.executor_kind='API' THEN fr.card_provider_account_id
         ELSE bcs.provider_account_id END
       WHERE BINARY p.legacy_plan_type = BINARY ?
         AND p.status = 'ACTIVE' AND fr.accepts_new_orders = 1
         AND fr.retired_at IS NULL
         AND ((fr.executor_kind='API' AND cpa.provider_code='hnskj'
               AND cpa.supports_api_recharge=1)
           OR (fr.executor_kind='BROWSER' AND cpa.supports_browser_recharge=1))
       ORDER BY fr.route_version DESC LIMIT 2 FOR SHARE`,
      [cdkRows[0].plan_type || 'plus']
    );
    if (routeRows.length !== 1) {
      throw new OrderIntakeError('Order route is not configured', {
        code: 'ORDER_ROUTE_UNAVAILABLE',
        status: 503
      });
    }
    const route = routeRows[0];

    await connection.query(
      `INSERT INTO orders
        (id, public_no, cdk_id, status, plan_type, product_id, fulfillment_route_id,
        frozen_card_provider_account_id,
        route_resolution_status, customer_email,
        chatgpt_account_id, card_type_id, open_card_amount, minimum_required_card_balance,
        session_ciphertext, card_purchase_idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RESOLVED', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.orderId,
        input.publicNo,
        cdkId,
        OrderStatus.CREATED,
        cdkRows[0].plan_type || 'plus',
        route.product_id,
        route.fulfillment_route_id,
        route.frozen_card_provider_account_id,
        input.customerEmail,
        input.chatgptAccountId,
        settings.cardTypeId,
        settings.openCardAmount,
        minimumRequiredCardBalanceForPlan(settings, cdkRows[0].plan_type || 'plus'),
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
      `UPDATE customer_payments SET order_id = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE cdk_id = ? AND order_id IS NULL`,
      [input.orderId, cdkId]
    );
    await connection.query(
      `INSERT INTO order_events
       (order_id, from_status, to_status, actor_type, reason)
       VALUES (?, NULL, ?, 'CUSTOMER', 'order created from CDK')`,
      [input.orderId, OrderStatus.CREATED]
    );
    await connection.query(
      `INSERT INTO tasks
       (order_id, task_type, status, dedupe_key, max_attempts)
       VALUES (?, 'ASSIGN_CARD', 'PENDING', ?, 10080)`,
      [input.orderId, `assign-card:${input.orderId}`]
    );
    // D-158: no separate BROWSER_PREFLIGHT task. It logged into the customer's
    // account, closed it, and the live run logged in again minutes later — two
    // logins per order for checks the live run now performs itself in its own
    // session (identity match, free-plan guard). Fewer logins, one session.

    // D-175: Lemon wants to know the moment a customer redeems, not only when it
    // ends. A CDK is redeemed at a time of the customer's choosing, so this is the
    // first point at which anyone knows a recharge is under way at all.
    if (route.executor_kind === 'BROWSER') {
      await upsertBrowserAlertInTransaction(connection, {
        type: 'BROWSER_ORDER_SUBMITTED', orderId: input.orderId,
        title: '客户提交了充值',
        message: '已收到 CDK 与账号，正在分卡并排队执行。跑完会再推一条结果。'
      });
    }

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
