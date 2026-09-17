import assert from 'node:assert/strict';
import test from 'node:test';
import { createCardSourceAdminService } from '../src/services/card-source-admin-service.js';

const HNSKJ_ID = '00000000-0000-4000-8000-000000000101';
const BACKUP_ID = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';

function sourceRows() {
  return [
    { id: HNSKJ_ID, provider_code: 'hnskj', account_code: 'legacy-primary', display_name: 'HNSKJ', source_adapter: 'hnskj_api_v1',
      open_adapter: 'hnskj_api_v1', supports_api_recharge: 1, supports_browser_recharge: 1, supports_api_sync: 1,
      supports_auto_open: 1, supports_auto_funding: 1, operational_enabled: 1, read_enabled: 1, circuit_state: 'CLOSED',
      supply_fault_state: 'OK', wallet_floor: '30.000000', wallet_alert_threshold: '50.000000',
      card_count: 13, present_count: 13, usable_fact_count: 1 },
    { id: BACKUP_ID, provider_code: 'manual_excel', account_code: 'backup-a', display_name: '备用卡台 A', source_adapter: 'backup_card_export_v1',
      open_adapter: 'highvcc_api_v1', supports_api_recharge: 0, supports_browser_recharge: 1, supports_api_sync: 0,
      supports_auto_open: 1, supports_auto_funding: 0, operational_enabled: 1, read_enabled: 0, circuit_state: 'CLOSED',
      supply_fault_state: 'OK', wallet_floor: '20.000000', wallet_alert_threshold: '50.000000',
      card_count: 14, present_count: 6, usable_fact_count: 6 }
  ];
}
function selectionRows() {
  return [
    { product_id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus', executor_kind: 'API', provider_account_id: HNSKJ_ID, locked: 1, version: 1, updated_by: 'migration-053', updated_at: null },
    { product_id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus', executor_kind: 'BROWSER', provider_account_id: BACKUP_ID, locked: 0, version: 8, updated_by: 'admin', updated_at: new Date('2026-09-16T09:19:08.428Z') }
  ];
}

function poolFor() {
  const queries = [];
  const tx = { begin: 0, commit: 0, rollback: 0 };
  async function query(sql, params = []) {
    const text = String(sql);
    queries.push({ sql: text.replace(/\s+/g, ' ').trim(), params });
    if (text.includes('FROM provider_accounts pa LEFT JOIN cards c')) return [sourceRows()];
    if (text.includes('FROM card_source_selections s') && text.includes('WHERE s.product_id = ?')) {
      return [selectionRows().filter((r) => r.product_id === params[0] && r.executor_kind === params[1])];
    }
    if (text.includes('FROM card_source_selections s')) return [selectionRows()];
    if (text.includes('FROM products')) return [[{ id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus' }]];
    if (text.includes('FROM fulfillment_routes')) return [[{ id: 'route-302' }]];
    if (text.includes('FROM provider_accounts pa')) {
      const row = sourceRows().find((r) => r.id === params[0]);
      return [row ? [{ ...row, environment: 'PRODUCTION', purpose: 'CARD', retry_after_until: null, last_full_snapshot_at: null, default_card_segment: null, supply_fault_reason: null, supply_fault_at: null, write_enabled: 0 }] : []];
    }
    if (text.includes('SELECT COUNT(*) AS count FROM cards')) return [[{ count: 1 }]];
    if (text.includes('SELECT COUNT(*) AS count FROM orders o')) return [[{ count: 4 }]];
    if (text.startsWith('UPDATE card_source_selections')) return [{ affectedRows: 1 }];
    if (text.startsWith('UPDATE orders o')) return [{ affectedRows: 1 }];
    if (text.includes('INSERT INTO card_source_selection_events')) return [{ affectedRows: 1 }];
    if (text.includes('INSERT INTO provider_accounts')) return [{ affectedRows: 1 }];
    throw new Error(`unexpected query: ${text.slice(0, 90)}`);
  }
  const connection = { query, async beginTransaction() { tx.begin += 1; }, async commit() { tx.commit += 1; }, async rollback() { tx.rollback += 1; }, release() {} };
  return { queries, tx, query, async getConnection() { return connection; } };
}

test('list reads both halves from the selection table: API fixed+locked, Browser operator-selected with its version', async () => {
  const pool = poolFor();
  const result = await createCardSourceAdminService({ pool }).list();
  assert.equal(result.apiProviderAccountId, HNSKJ_ID);
  assert.equal(result.apiSelectionLocked, true);
  assert.equal(result.browserProviderAccountId, BACKUP_ID);
  assert.equal(result.browserSelectionVersion, 8);
  assert.equal(result.browserSelectionUpdatedAt, '2026-09-16T09:19:08.428Z');
  assert.equal(result.selections.length, 2);
  assert.deepEqual(result.displayNames, { API: 'API 充值', BROWSER: '浏览器自动化充值' });
  // 不再读 browser_card_source_selections / fulfillment_routes.card_provider_account_id，排序不按名字。
  assert.equal(pool.queries.some((q) => /browser_card_source_selections|fr\.card_provider_account_id/.test(q.sql)), false);
  assert.match(pool.queries[0].sql, /ORDER BY pa\.supports_api_sync DESC/);
  assert.doesNotMatch(pool.queries[0].sql, /provider_code='hnskj'/);
  assert.equal(result.sources[1].openAdapter, 'highvcc_api_v1');
  assert.equal(result.sources[1].walletFloor, '20.000000');
});

test('Browser source switch runs the four checks and only then writes; it no longer waves an unhealthy target through with warnings', async () => {
  const pool = poolFor();
  const result = await createCardSourceAdminService({ pool }).switchBrowserSource({
    providerAccountId: HNSKJ_ID, expectedVersion: 8, takeoverWaiting: true, actorId: 'lemon'
  });
  assert.equal(result.providerAccountId, HNSKJ_ID);
  assert.equal(result.previousProviderAccountId, BACKUP_ID);
  assert.equal(result.version, 9);
  assert.equal(result.actualTakeoverCount, 1);
  assert.deepEqual(result.checks.map((c) => c.code), ['ROUTE_UNIQUE', 'SOURCE_HEALTHY', 'TARGET_POOL_AVAILABLE', 'VERSION_MATCH']);
  assert.equal(pool.tx.commit, 1);
  const takeover = pool.queries.find((q) => q.sql.startsWith('UPDATE orders o'));
  assert.match(takeover.sql, /assigned_card_id IS NULL/);
  assert.match(takeover.sql, /card_assignment_history/);
  assert.match(takeover.sql, /recharge_attempts/);
  assert.match(takeover.sql, /card_funding_attempts/);
  assert.match(takeover.sql, /reconciliation_cases/);
});

test('a stale expectedVersion is rejected with the failed check attached', async () => {
  const pool = poolFor();
  await assert.rejects(
    createCardSourceAdminService({ pool }).switchBrowserSource({ providerAccountId: HNSKJ_ID, expectedVersion: 7 }),
    (error) => error.code === 'CARD_SOURCE_SWITCH_REJECTED' && error.checks.some((c) => c.code === 'VERSION_MATCH' && !c.ok)
  );
  assert.equal(pool.tx.rollback, 1);
  assert.equal(pool.queries.some((q) => q.sql.startsWith('UPDATE card_source_selections')), false);
});

test('creating a manual source still inserts a Browser-only account row', async () => {
  const pool = poolFor();
  const result = await createCardSourceAdminService({ pool }).createManualSource({ accountCode: 'Backup-B', displayName: '备用 B' });
  assert.equal(result.accountCode, 'backup-b');
  const insert = pool.queries.find((q) => q.sql.includes('INSERT INTO provider_accounts'));
  assert.match(insert.sql, /'manual_excel'/);
});

test('waiting takeover estimate counts only safe Browser orders', async () => {
  const pool = poolFor();
  const result = await createCardSourceAdminService({ pool }).estimateWaitingTakeover();
  assert.equal(result.count, 4);
  assert.match(pool.queries[0].sql, /fr\.executor_kind='BROWSER'/);
  assert.match(pool.queries[0].sql, /assigned_card_id IS NULL/);
});
