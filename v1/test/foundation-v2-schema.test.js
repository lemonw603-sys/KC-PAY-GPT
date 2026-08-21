import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');
const migrationName = '021_foundation_v2_core.sql';
const migrationPath = path.join(migrationsDir, migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');
const operationsSql = fs.readFileSync(path.join(migrationsDir, '022_foundation_v2_operations.sql'), 'utf8');

const expectedTables = [
  'provider_accounts',
  'products',
  'fulfillment_routes',
  'recharge_attempts',
  'recharge_authorizations',
  'recharge_authorization_items',
  'card_intake_batches',
  'card_discoveries',
  'provider_balance_snapshots',
  'cdk_delivery_events',
  'reconciliation_cases'
];

test('Foundation v2 migrations are correctly ordered after 020', () => {
  const names = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const foundationIndex = names.indexOf(migrationName);
  assert.equal(names[foundationIndex - 1], '020_runtime_health.sql');
  assert.equal(names[foundationIndex + 1], '022_foundation_v2_operations.sql');
  assert.equal(names[foundationIndex + 2], '023_bark_notifications.sql');
  assert.equal(new Set(names).size, names.length);
});

test('operations migration adds an explicit replay-safe last-seen timestamp', () => {
  assert.match(operationsSql, /information_schema\.COLUMNS/i);
  assert.match(operationsSql, /ADD COLUMN last_seen_at TIMESTAMP\(3\)/i);
  assert.match(operationsSql, /SET last_seen_at = COALESCE\(last_seen_at, updated_at, detected_at\)/i);
  assert.doesNotMatch(operationsSql, /DROP\s+(?:TABLE|COLUMN)/i);
});

test('Foundation v2 creates every required table idempotently', () => {
  for (const table of expectedTables) {
    assert.match(sql, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i'), table);
  }
  assert.doesNotMatch(sql, /CREATE\s+TABLE(?!\s+IF\s+NOT\s+EXISTS)/i);
});

test('compatibility migration preserves all legacy columns', () => {
  assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
  assert.doesNotMatch(sql, /RENAME\s+COLUMN/i);
  for (const table of ['cards', 'orders', 'provider_calls']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN`, 'i'));
  }
  for (const column of [
    'provider_account_id', 'external_card_id', 'intake_status', 'sync_tier',
    'next_sync_at', 'sync_consecutive_failures', 'last_successful_sync_at',
    'refund_watch_until', 'pan_hmac'
  ]) {
    assert.match(sql, new RegExp(`COLUMN ${column}\\b`, 'i'), column);
  }
  assert.match(sql, /ALTER TABLE orders ADD COLUMN product_id/i);
  assert.match(sql, /ALTER TABLE orders ADD COLUMN fulfillment_route_id/i);
  assert.match(sql, /ALTER TABLE provider_calls ADD COLUMN provider_account_id/i);
  assert.match(sql, /ALTER TABLE provider_calls ADD COLUMN recharge_attempt_id/i);
});

test('account-scoped card identity replaces legacy global uniqueness without deleting its column', () => {
  assert.match(sql, /UNIQUE INDEX uq_cards_provider_account_external \(provider_account_id, external_card_id\)/i);
  assert.match(sql, /DROP INDEX uq_cards_provider_card_id/i);
  assert.match(sql, /ADD INDEX idx_cards_provider_card_id \(provider_card_id\)/i);
  assert.doesNotMatch(sql, /DROP\s+COLUMN\s+provider_card_id/i);
  assert.match(sql, /CONSTRAINT fk_cards_provider_account FOREIGN KEY \(provider_account_id\)/i);
});

test('funds fence uses MySQL NULL-aware generated uniqueness', () => {
  assert.match(sql, /funds_fence_order_id CHAR\(36\) GENERATED ALWAYS AS/i);
  assert.match(sql, /funds_risk_state IN \('ACTIVE', 'UNKNOWN', 'SETTLED'\)/i);
  assert.match(sql, /UNIQUE KEY uq_recharge_attempt_funds_fence \(funds_fence_order_id\)/i);
  assert.match(sql, /CONSTRAINT fk_recharge_attempts_order FOREIGN KEY \(order_id\)/i);
  assert.match(sql, /CONSTRAINT fk_recharge_attempts_authorization_item FOREIGN KEY \(authorization_item_id\)/i);
});

test('authorization items freeze explicit orders and are consumable once', () => {
  assert.match(sql, /UNIQUE KEY uq_recharge_auth_item_member \(authorization_id, order_id\)/i);
  assert.match(sql, /protected_order_id CHAR\(36\) GENERATED ALWAYS AS/i);
  assert.match(sql, /status IN \('PENDING', 'CONSUMED'\)/i);
  assert.match(sql, /UNIQUE KEY uq_recharge_auth_item_protected_order \(protected_order_id\)/i);
  assert.match(sql, /UNIQUE KEY uq_recharge_auth_item_consumed_attempt \(consumed_attempt_id\)/i);
  assert.match(sql, /UNIQUE KEY uq_recharge_attempt_authorization_item \(authorization_item_id\)/i);
  assert.match(sql, /fk_recharge_auth_items_consumed_attempt/i);
});

test('all required relationships have explicit foreign keys', () => {
  const foreignKeys = [
    'fk_fulfillment_routes_product',
    'fk_fulfillment_routes_card_account',
    'fk_fulfillment_routes_recharge_account',
    'fk_recharge_auth_items_authorization',
    'fk_recharge_auth_items_order',
    'fk_recharge_attempts_route',
    'fk_card_intake_batches_account',
    'fk_card_discoveries_batch',
    'fk_card_discoveries_account',
    'fk_provider_balance_account',
    'fk_cdk_delivery_cdk',
    'fk_reconciliation_cases_attempt',
    'fk_provider_calls_recharge_attempt'
  ];
  for (const constraint of foreignKeys) {
    assert.match(sql, new RegExp(`CONSTRAINT ${constraint}\\s+FOREIGN KEY`, 'i'), constraint);
  }
});

test('deterministic compatibility seeds are non-destructive and idempotent', () => {
  const stableSeeds = [
    ['00000000-0000-4000-8000-000000000101', 'hnskj'],
    ['00000000-0000-4000-8000-000000000102', 'zzshu'],
    ['00000000-0000-4000-8000-000000000201', 'chatgpt_plus'],
    ['00000000-0000-4000-8000-000000000301', 'LEGACY_HNSKJ_ZZSHU_V1']
  ];
  for (const [id, code] of stableSeeds) {
    assert.match(sql, new RegExp(`${id.replaceAll('-', '\\-')}[^;]*${code}`, 'is'), code);
  }
  assert.equal((sql.match(/ON DUPLICATE KEY UPDATE/gi) || []).length, 4);
  assert.match(sql, /ON DUPLICATE KEY UPDATE external_order_id = o\.recharge_order_no/i);
  assert.doesNotMatch(sql, /ON DUPLICATE KEY UPDATE[^;]*(provider_code|account_code|route_code|product_code)\s*=/i);
});

test('historical backfill is evidence-bound and keeps unknown routes explicit', () => {
  assert.match(sql, /route_resolution_status VARCHAR\(24\) NOT NULL DEFAULT ''LEGACY_UNKNOWN''/i);
  assert.match(sql, /route_resolution_status = 'EVIDENCE_BACKFILLED'/i);
  assert.match(sql, /recharge_order_no IS NOT NULL[\s\S]*EXISTS \(SELECT 1 FROM cards[\s\S]*EXISTS \(SELECT 1 FROM provider_calls/i);
  assert.match(sql, /WHERE o\.recharge_order_no IS NOT NULL[\s\S]*LOWER\(pc\.provider\) = 'zzshu'/i);
  assert.doesNotMatch(sql, /UPDATE orders[\s\S]*SET[^;]*fulfillment_route_id[^;]*WHERE\s+fulfillment_route_id IS NULL\s*;/i);
});

test('all additive ALTER operations are guarded for safe migration replay', () => {
  const directAlters = [...sql.matchAll(/'ALTER TABLE ([a-z_]+) (ADD|DROP)[^']*'/gi)];
  assert.ok(directAlters.length >= 20);
  assert.equal((sql.match(/PREPARE foundation_v2_stmt FROM @foundation_v2_ddl/gi) || []).length, directAlters.length);
  assert.equal((sql.match(/DEALLOCATE PREPARE foundation_v2_stmt/gi) || []).length, directAlters.length);
  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.match(sql, /information_schema\.TABLE_CONSTRAINTS/i);
});

test('schema-only migration contains no provider execution or production operation', () => {
  assert.doesNotMatch(sql, /https?:\/\//i);
  assert.doesNotMatch(sql, /CALL\s+(purchase|recharge|provider)/i);
  assert.doesNotMatch(sql, /INTO\s+OUTFILE|LOAD\s+DATA|DROP\s+DATABASE|TRUNCATE\s+TABLE/i);
});

test('Bark notification migration tracks the source alert revision for safe re-open delivery', () => {
  const barkSql = fs.readFileSync(path.join(migrationsDir, '023_bark_notifications.sql'), 'utf8');
  assert.match(barkSql, /source_updated_at TIMESTAMP\(3\)/i);
  assert.match(barkSql, /FOREIGN KEY \(alert_id\) REFERENCES operator_alerts\(id\)/i);
  assert.match(barkSql, /ALTER TABLE operator_alerts ADD COLUMN updated_at TIMESTAMP\(3\)/i);
  assert.match(barkSql, /information_schema\.COLUMNS/i);
});
