import { PublicApiError } from '../domain/public-api-error.js';

const STATES = new Set(['AK', 'DE', 'MT', 'NH', 'OR']);

export function createBrowserBillingAddressAdminService({ pool }) {
  async function get() {
    const [rows] = await pool.query(`SELECT setting_key, setting_value, updated_at FROM app_settings
      WHERE setting_key IN ('browser_billing_address_enabled','browser_billing_address_state','browser_billing_address_name')
      ORDER BY setting_key`);
    const values = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      enabled: values.get('browser_billing_address_enabled') === 'true',
      state: String(values.get('browser_billing_address_state') || 'DE'),
      nameConfigured: Boolean(String(values.get('browser_billing_address_name') || '').trim()),
      updatedAt: rows.map((r) => r.updated_at).filter(Boolean).sort().at(-1) || null,
      source: 'MockAddress pinned local dataset',
      sourceVersion: 'taxfree_target_no_source_perstate888@2026-04-26',
    };
  }
  async function set({ enabled, state, name, confirmation }) {
    if (String(confirmation || '') !== '确认更新账单地址设置') {
      throw new PublicApiError('Billing address settings confirmation mismatch', { code: 'BILLING_ADDRESS_CONFIRMATION_REQUIRED', status: 400 });
    }
    const nextState = String(state || 'DE').trim().toUpperCase();
    const nextName = String(name || '').trim();
    if (!STATES.has(nextState)) throw new PublicApiError('Unsupported billing address state', { code: 'INVALID_BILLING_ADDRESS_STATE', status: 400 });
    if (Boolean(enabled) && !nextName) throw new PublicApiError('Billing address name is required when enabled', { code: 'BILLING_ADDRESS_NAME_REQUIRED', status: 400 });
    await pool.query(`INSERT INTO app_settings (setting_key, setting_value) VALUES
      ('browser_billing_address_enabled', ?), ('browser_billing_address_state', ?), ('browser_billing_address_name', ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
      [Boolean(enabled) ? 'true' : 'false', nextState, nextName]);
    return get();
  }
  return { get, set };
}
