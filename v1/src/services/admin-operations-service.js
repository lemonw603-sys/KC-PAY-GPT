import { PublicApiError } from '../domain/public-api-error.js';

function expectedConfirmation(enabled) {
  return enabled ? '开始接单' : '停止接单';
}

export function createAdminOperationsService({ pool }) {
  async function setOrderAcceptance(input = {}) {
    if (typeof input.enabled !== 'boolean') {
      throw new PublicApiError('Order acceptance state must be boolean', {
        code: 'INVALID_ORDER_ACCEPTANCE_STATE', status: 400
      });
    }
    if (input.confirmation !== expectedConfirmation(input.enabled)) {
      throw new PublicApiError('Order acceptance confirmation mismatch', {
        code: 'ORDER_ACCEPTANCE_CONFIRMATION_REQUIRED', status: 400
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
         WHERE setting_key = 'accept_new_orders'`,
        [String(input.enabled)]
      );
      if (input.enabled) {
        await connection.query(
          `UPDATE app_settings SET setting_value = 'true', updated_at = CURRENT_TIMESTAMP(3)
           WHERE setting_key = 'dispatch_new_recharges'`
        );
      }
      await connection.commit();
      return {
        acceptNewOrders: input.enabled,
        dispatchExistingOrders: input.enabled
          ? true
          : rows.find((row) => row.setting_key === 'dispatch_new_recharges')?.setting_value === 'true'
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { setOrderAcceptance };
}
