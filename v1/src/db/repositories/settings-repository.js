const RUNTIME_SETTING_KEYS = Object.freeze([
  'dispatch_new_recharges',
  'recharge_dispatch_mode',
  'poll_existing_orders',
  'sync_card_transactions'
]);

function parseBooleanSetting(key, value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean app setting ${key}`);
}

function parseRechargeDispatchMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  if (!['AUTOMATIC', 'MANUAL'].includes(mode)) {
    throw new Error('Invalid recharge dispatch mode');
  }
  return mode;
}

export async function loadRuntimeSettings(pool) {
  const placeholders = RUNTIME_SETTING_KEYS.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value
     FROM app_settings WHERE setting_key IN (${placeholders})`,
    RUNTIME_SETTING_KEYS
  );
  const values = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  for (const key of RUNTIME_SETTING_KEYS) {
    if (!values.has(key)) throw new Error(`Missing required app setting ${key}`);
  }
  return {
    dispatchNewRecharges: parseBooleanSetting(
      'dispatch_new_recharges',
      values.get('dispatch_new_recharges')
    ),
    rechargeDispatchMode: parseRechargeDispatchMode(values.get('recharge_dispatch_mode')),
    pollExistingOrders: parseBooleanSetting(
      'poll_existing_orders',
      values.get('poll_existing_orders')
    ),
    syncCardTransactions: parseBooleanSetting(
      'sync_card_transactions',
      values.get('sync_card_transactions')
    )
  };
}
