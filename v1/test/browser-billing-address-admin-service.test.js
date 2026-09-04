import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserBillingAddressAdminService } from '../src/services/browser-billing-address-admin-service.js';

function poolMock(initial = []) {
  const values = new Map(initial.map(([k, v]) => [k, v]));
  return { values, async query(sql, params = []) {
    if (sql.startsWith('SELECT setting_key')) return [[...values].map(([setting_key, setting_value]) => ({ setting_key, setting_value, updated_at: new Date('2026-09-04T00:00:00Z') }))];
    if (sql.startsWith('INSERT INTO app_settings')) {
      values.set('browser_billing_address_enabled', params[0]); values.set('browser_billing_address_state', params[1]); values.set('browser_billing_address_name', params[2]); return [{ affectedRows: 3 }];
    }
    throw new Error(`unexpected query ${sql}`);
  } };
}

test('billing address admin settings expose metadata without full address', async () => {
  const service = createBrowserBillingAddressAdminService({ pool: poolMock([
    ['browser_billing_address_enabled', 'false'], ['browser_billing_address_state', 'DE'], ['browser_billing_address_name', ''],
  ]) });
  assert.deepEqual(await service.get(), { enabled: false, state: 'DE', nameConfigured: false, updatedAt: new Date('2026-09-04T00:00:00Z'), source: 'MockAddress pinned local dataset', sourceVersion: 'taxfree_target_no_source_perstate888@2026-04-26' });
});

test('billing address admin settings require confirmation and validate state/name', async () => {
  const service = createBrowserBillingAddressAdminService({ pool: poolMock([
    ['browser_billing_address_enabled', 'false'], ['browser_billing_address_state', 'DE'], ['browser_billing_address_name', ''],
  ]) });
  await assert.rejects(() => service.set({ enabled: true, state: 'DE', name: 'X' }), /confirmation/);
  await assert.rejects(() => service.set({ enabled: true, state: 'CA', name: 'X', confirmation: '确认更新账单地址设置' }), /Unsupported/);
  await assert.rejects(() => service.set({ enabled: true, state: 'DE', name: '', confirmation: '确认更新账单地址设置' }), /required/);
  const result = await service.set({ enabled: true, state: 'DE', name: 'X', confirmation: '确认更新账单地址设置' });
  assert.equal(result.enabled, true); assert.equal(result.nameConfigured, true);
});
