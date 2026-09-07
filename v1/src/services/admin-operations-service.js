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

  async function readSettingValue(connection, key) {
    const [rows] = await connection.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1 FOR UPDATE', [key]);
    return rows.length ? String(rows[0].setting_value) : null;
  }

  async function writeSettingWithAudit(connection, { key, value, actorId, reason }) {
    const previous = await readSettingValue(connection, key);
    await connection.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
      [key, value]
    );
    await connection.query(
      `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
      [key, previous, value, actorId, reason]
    );
    return previous;
  }

  function requireBoolean(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new PublicApiError('Operation state must be boolean', { code: 'INVALID_OPERATION_STATE', status: 400 });
    }
    return enabled;
  }

  // Decision 4 「能不能付钱」: the Browser payment gate. The worker requires
  // the database flag and every ACTIVE Browser executor profile to agree, so
  // both move together here. No password, no typed phrase: the UI confirms.
  async function setBrowserPaymentWrites({ enabled, actorId = 'admin' } = {}) {
    const value = requireBoolean(enabled);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const previous = await writeSettingWithAudit(connection, {
        key: 'browser_payment_writes_enabled', value: String(value), actorId,
        reason: value ? 'operator enabled Browser payment' : 'operator disabled Browser payment'
      });
      const [profiles] = await connection.query(
        `UPDATE executor_profiles
         SET config_public_json = JSON_SET(COALESCE(config_public_json, JSON_OBJECT()), '$.productionWritesEnabled', CAST(? AS JSON)),
             updated_at = CURRENT_TIMESTAMP(3)
         WHERE executor_kind = 'BROWSER' AND status = 'ACTIVE'`,
        [value ? 'true' : 'false']
      );
      await connection.commit();
      return { browserPaymentWritesEnabled: value, previous: previous === 'true', executorProfilesUpdated: Number(profiles.affectedRows || 0) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Decision 5 「能不能开卡补钱」: one switch over the two supply automations
  // (automatic card opening and automatic balance top-up). Existing readers keep
  // their keys; this writes both so they can never disagree by accident.
  async function setSupplyAutomation({ enabled, actorId = 'admin' } = {}) {
    const value = requireBoolean(enabled);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const key of ['card_auto_replenishment_enabled', 'card_balance_recharge_enabled']) {
        await writeSettingWithAudit(connection, { key, value: String(value), actorId,
          reason: value ? 'operator enabled supply automation' : 'operator disabled supply automation' });
      }
      await connection.commit();
      return { supplyAutomationEnabled: value, cardAutoReplenishmentEnabled: value, cardBalanceRechargeEnabled: value };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function closeAlert(alertId) {
    const id = String(alertId || '').trim();
    if (!id || id.length > 64) {
      throw new PublicApiError('Alert id is required', { code: 'INVALID_ALERT_ID', status: 400 });
    }
    const [result] = await pool.query(
      `UPDATE operator_alerts
       SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))
       WHERE id = ? AND status = 'OPEN'`,
      [id]
    );
    return { alertId: id, closed: result.affectedRows === 1 };
  }

  return { setOrderAcceptance, setDispatch, setBrowserPaymentWrites, setSupplyAutomation, closeAlert };
}
