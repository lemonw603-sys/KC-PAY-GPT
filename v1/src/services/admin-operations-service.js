import { PublicApiError } from '../domain/public-api-error.js';

// Intake (accept_new_orders) and auto-recharge dispatch (dispatch_new_recharges)
// are two independent control planes. Enabling intake no longer force-enables
// dispatch: an operator can accept new orders while auto-recharge stays paused
// (e.g. staging a controlled single order), and must explicitly turn dispatch
// on. This removes the risk that opening intake silently auto-recharges other
// orders already sitting in CARD_READY. "Stop intake" still never touches
// dispatch, and dispatch is unrelated to poll_existing_orders (order tracking).

function acceptanceConfirmation(enabled) {
  return enabled ? '开始接单' : '停止接单';
}

function dispatchConfirmation(enabled) {
  return enabled ? '开始自动充值' : '停止自动充值';
}

function readSetting(rows, key) {
  return rows.find((row) => row.setting_key === key)?.setting_value === 'true';
}

export function createAdminOperationsService({ pool }) {
  async function updateSetting({ enabled, confirmation, settingKey, expectedConfirmation, invalidStateCode, confirmationCode, confirmationMessage }) {
    if (typeof enabled !== 'boolean') {
      throw new PublicApiError('Operation state must be boolean', {
        code: invalidStateCode, status: 400
      });
    }
    if (confirmation !== expectedConfirmation(enabled)) {
      throw new PublicApiError(confirmationMessage, {
        code: confirmationCode, status: 400
      });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT setting_key, setting_value FROM app_settings
         WHERE setting_key IN ('accept_new_orders','dispatch_new_recharges')
         FOR UPDATE`
      );
      if (rows.length !== 2) {
        throw new Error('Required order operation settings are missing');
      }
      await connection.query(
        `UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE setting_key = ?`,
        [String(enabled), settingKey]
      );
      await connection.commit();
      const acceptNewOrders = settingKey === 'accept_new_orders' ? enabled : readSetting(rows, 'accept_new_orders');
      const dispatchExistingOrders = settingKey === 'dispatch_new_recharges' ? enabled : readSetting(rows, 'dispatch_new_recharges');
      return { acceptNewOrders, dispatchExistingOrders };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  function setOrderAcceptance(input = {}) {
    return updateSetting({
      enabled: input.enabled,
      confirmation: input.confirmation,
      settingKey: 'accept_new_orders',
      expectedConfirmation: acceptanceConfirmation,
      invalidStateCode: 'INVALID_ORDER_ACCEPTANCE_STATE',
      confirmationCode: 'ORDER_ACCEPTANCE_CONFIRMATION_REQUIRED',
      confirmationMessage: 'Order acceptance confirmation mismatch'
    });
  }

  function setDispatch(input = {}) {
    return updateSetting({
      enabled: input.enabled,
      confirmation: input.confirmation,
      settingKey: 'dispatch_new_recharges',
      expectedConfirmation: dispatchConfirmation,
      invalidStateCode: 'INVALID_DISPATCH_STATE',
      confirmationCode: 'DISPATCH_CONFIRMATION_REQUIRED',
      confirmationMessage: 'Dispatch confirmation mismatch'
    });
  }

  return { setOrderAcceptance, setDispatch };
}
