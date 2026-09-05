import assert from 'node:assert/strict';
import test from 'node:test';
import { createCardSourceAdminService } from '../src/services/card-source-admin-service.js';

function poolFor(responses) {
  const queries = []; const tx = { begin: 0, commit: 0, rollback: 0 };
  const connection = { async beginTransaction() { tx.begin++; }, async commit() { tx.commit++; },
    async rollback() { tx.rollback++; }, release() {}, async query(sql, values = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      const next = responses.shift(); if (!next) throw new Error(`unexpected query: ${sql}`); return next;
    } };
  return { queries, tx, async getConnection() { return connection; }, async query(sql, values = []) { return connection.query(sql, values); } };
}

test('lists API fixed source separately from the operator-selected Browser source', async () => {
  const pool = poolFor([
    [[{ id: 'hnskj', provider_code: 'hnskj', account_code: 'primary', display_name: 'HNSKJ',
      supports_api_recharge: 1, supports_browser_recharge: 1, supports_api_sync: 1,
      supports_auto_open: 1, supports_auto_funding: 1, operational_enabled: 1,
      read_enabled: 1, circuit_state: 'CLOSED', card_count: 3, present_count: 3, usable_fact_count: 2 }]],
    [[{ provider_account_id: 'backup-a', version: 2, updated_by: 'ops' }]],
    [[{ card_provider_account_id: 'hnskj' }]]
  ]);
  const result = await createCardSourceAdminService({ pool }).list();
  assert.equal(result.apiProviderAccountId, 'hnskj');
  assert.equal(result.browserProviderAccountId, 'backup-a');
  assert.deepEqual(result.displayNames, { API: 'API 充值', BROWSER: '浏览器自动化充值' });
  assert.match(pool.queries[0].sql, /SUM\(c\.id IS NOT NULL AND COALESCE\(c\.source_present,1\)=1\) AS present_count/);
});

test('Browser source switch records warnings but does not block an unhealthy operator selection', async () => {
  const pool = poolFor([
    [[{ id: 'product-plus' }]],
    [[{ id: 'backup-b', provider_code: 'manual_excel', display_name: '备用 B', account_code: 'backup-b',
      supports_browser_recharge: 1, operational_enabled: 0, read_enabled: 0, circuit_state: 'OPEN' }]],
    [[{ provider_account_id: 'hnskj', version: 1 }]],
    [[{ count: 4 }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 1 }]
  ]);
  const result = await createCardSourceAdminService({ pool }).switchBrowserSource({ providerAccountId: 'backup-b' });
  assert.equal(result.providerAccountId, 'backup-b');
  assert.equal(result.actualTakeoverCount, 0);
  assert.deepEqual(result.warnings.sort(), ['CIRCUIT_OPEN', 'SOURCE_DISABLED']);
  assert.equal(pool.tx.commit, 1);
  assert.equal(pool.queries.some((q) => /ROUTE_NOT_HEALTHY/.test(q.sql)), false);
});

test('waiting takeover SQL excludes assignments, attempts, funding risks and reconciliation cases', async () => {
  const pool = poolFor([
    [[{ id: 'product-plus' }]],
    [[{ id: 'backup-b', provider_code: 'manual_excel', supports_browser_recharge: 1,
      operational_enabled: 1, read_enabled: 0, circuit_state: 'CLOSED' }]],
    [[{ provider_account_id: 'hnskj', version: 1 }]],
    [[{ count: 2 }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 1 }],
    [{ affectedRows: 1 }]
  ]);
  const result = await createCardSourceAdminService({ pool }).switchBrowserSource({ providerAccountId: 'backup-b', takeoverWaiting: true });
  assert.equal(result.actualTakeoverCount, 1);
  const update = pool.queries.find((q) => q.sql.startsWith('UPDATE orders o'));
  assert.match(update.sql, /assigned_card_id IS NULL/);
  assert.match(update.sql, /card_assignment_history/);
  assert.match(update.sql, /recharge_attempts/);
  assert.match(update.sql, /card_funding_attempts/);
  assert.match(update.sql, /reconciliation_cases/);
});
