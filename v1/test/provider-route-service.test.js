import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARD_ADAPTER_HIGHVCC, CARD_ADAPTER_HNSKJ, cardProviderAccountIsHealthy, listCardProviderAccounts,
  mapCardProviderAccount, resolveCardProviderAccountForAdapter, resolveCardProviderAccountIdForAdapter
} from '../src/services/provider-route-service.js';

// 生产 provider_accounts 两行的真实形状（2026-09-17 16:2x UTC 实查），只把 053 加的列补上。
const HNSKJ = {
  id: '00000000-0000-4000-8000-000000000101', provider_code: 'hnskj', account_code: 'legacy-primary', display_name: 'HNSKJ',
  environment: 'PRODUCTION', purpose: 'CARD', source_adapter: 'hnskj_api_v1', open_adapter: 'hnskj_api_v1',
  default_card_segment: '23', wallet_floor: '30.000000', wallet_alert_threshold: '50.000000',
  supply_fault_state: 'OK', supply_fault_reason: null, supply_fault_at: null,
  supports_api_recharge: 1, supports_browser_recharge: 1, supports_api_sync: 1, supports_auto_open: 1, supports_auto_funding: 1,
  operational_enabled: 1, read_enabled: 1, write_enabled: 0, circuit_state: 'CLOSED', retry_after_until: null, last_full_snapshot_at: null
};
const BACKUP_A = {
  id: '00000000-0000-4000-8000-000000000103', provider_code: 'manual_excel', account_code: 'backup-a', display_name: '备用卡台 A',
  environment: 'PRODUCTION', purpose: 'CARD', source_adapter: 'backup_card_export_v1', open_adapter: 'highvcc_api_v1',
  default_card_segment: '708', wallet_floor: '20.000000', wallet_alert_threshold: '50.000000',
  supply_fault_state: 'OK', supply_fault_reason: null, supply_fault_at: null,
  supports_api_recharge: 0, supports_browser_recharge: 1, supports_api_sync: 0, supports_auto_open: 1, supports_auto_funding: 0,
  // 生产实值：备用卡台 A 没有只读 API，read_enabled=0 是「没这个能力」而不是「被停用」。
  operational_enabled: 1, read_enabled: 0, write_enabled: 0, circuit_state: 'CLOSED', retry_after_until: null,
  last_full_snapshot_at: new Date('2026-09-17T13:52:19.801Z')
};

function poolWith(rows) {
  const queries = [];
  return { queries, async query(sql, params) { queries.push({ sql, params }); return [rows]; } };
}

test('account rows map capability bits and never expose a name-based verdict', () => {
  const account = mapCardProviderAccount(BACKUP_A);
  assert.equal(account.openAdapter, CARD_ADAPTER_HIGHVCC);
  assert.equal(account.supportsApiSync, false);
  assert.equal(account.supportsAutoOpen, true);
  assert.equal(account.walletFloor, '20.000000');
  assert.equal(account.lastFullSnapshotAt, '2026-09-17T13:52:19.801Z');
});

test('health: read_enabled only matters for accounts that actually have an API sync capability', () => {
  assert.equal(cardProviderAccountIsHealthy(mapCardProviderAccount(BACKUP_A)), true, 'no API sync → read_enabled=0 is not a fault');
  assert.equal(cardProviderAccountIsHealthy(mapCardProviderAccount({ ...HNSKJ, read_enabled: 0 })), false);
  assert.equal(cardProviderAccountIsHealthy(mapCardProviderAccount({ ...HNSKJ, circuit_state: 'OPEN' })), false);
  assert.equal(cardProviderAccountIsHealthy(mapCardProviderAccount({ ...HNSKJ, operational_enabled: 0 })), false);
  assert.equal(cardProviderAccountIsHealthy(
    mapCardProviderAccount({ ...HNSKJ, retry_after_until: new Date(Date.now() + 60_000) })
  ), false);
  assert.equal(cardProviderAccountIsHealthy(
    mapCardProviderAccount({ ...HNSKJ, retry_after_until: new Date(Date.now() - 60_000) })
  ), true);
});

test('listing reads only CARD/PRODUCTION accounts and does not filter by provider_code', async () => {
  const pool = poolWith([HNSKJ, BACKUP_A]);
  const accounts = await listCardProviderAccounts(pool);
  assert.equal(accounts.length, 2);
  assert.match(pool.queries[0].sql, /pa\.purpose = 'CARD' AND pa\.environment = 'PRODUCTION'/);
  assert.doesNotMatch(pool.queries[0].sql, /provider_code\s*=/);
});

test('an adapter resolves to the healthy account it serves, by adapter code, regardless of routes', async () => {
  assert.equal(await resolveCardProviderAccountIdForAdapter(poolWith([HNSKJ, BACKUP_A]), CARD_ADAPTER_HNSKJ), HNSKJ.id);
  assert.equal(await resolveCardProviderAccountIdForAdapter(poolWith([HNSKJ, BACKUP_A]), CARD_ADAPTER_HIGHVCC), BACKUP_A.id);
  // 之前的实现会在 Plus 路线 accepts=0 时返回 null；现在跟路线无关。
  const account = await resolveCardProviderAccountForAdapter(poolWith([BACKUP_A, HNSKJ]), CARD_ADAPTER_HNSKJ);
  assert.equal(account.displayName, 'HNSKJ');
});

test('an unhealthy or missing account fails closed for its adapter', async () => {
  assert.equal(await resolveCardProviderAccountIdForAdapter(poolWith([{ ...HNSKJ, circuit_state: 'OPEN' }]), CARD_ADAPTER_HNSKJ), null);
  assert.equal(await resolveCardProviderAccountIdForAdapter(poolWith([]), CARD_ADAPTER_HNSKJ), null);
  await assert.rejects(resolveCardProviderAccountIdForAdapter(poolWith([HNSKJ]), ''), TypeError);
});
