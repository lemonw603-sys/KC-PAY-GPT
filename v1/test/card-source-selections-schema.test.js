import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');
const sql = fs.readFileSync(path.join(migrationsDir, '053_card_source_selections_and_supply.sql'), 'utf8');

test('053 is the newest migration and only adds', () => {
  const names = fs.readdirSync(migrationsDir).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  assert.equal(names.at(-1), '053_card_source_selections_and_supply.sql');
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
});

test('053 creates the product × executor → card source table and seeds both halves from the old tables', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS card_source_selections/);
  assert.match(sql, /PRIMARY KEY \(product_id, executor_kind\)/);
  // Browser 行从 browser_card_source_selections 原样迁入；API 行三个产品固定 101 且锁定。
  assert.match(sql, /SELECT bcs\.product_id, 'BROWSER', bcs\.provider_account_id, 0, bcs\.version/);
  assert.match(sql, /SELECT p\.id, 'API', '00000000-0000-4000-8000-000000000101', 1, 1/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS card_source_selection_events/);
});

test('053 gives provider accounts capability columns instead of name switches', () => {
  for (const column of ['open_adapter', 'default_card_segment', 'wallet_floor', 'wallet_alert_threshold', 'supply_fault_state']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}\\b`));
  }
  assert.match(sql, /open_adapter = 'hnskj_api_v1'[\s\S]*wallet_floor = 30/);
  assert.match(sql, /open_adapter = 'highvcc_api_v1'[\s\S]*wallet_floor = 20[\s\S]*supports_auto_open = 1/);
});

test('053 seeds supply policies per account × product with the D-247 numbers', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS card_supply_policies/);
  assert.match(sql, /SELECT 'plus' AS product_code, 2 AS target_available, 50 AS open_card_amount/);
  assert.match(sql, /UNION ALL SELECT 'pro_5x', 0, 100/);
  assert.match(sql, /UNION ALL SELECT 'pro_20x', 0, 150/);
  assert.match(sql, /plans\.daily_open_limit|, 20\n/);
});

test('053 lets stock jobs name their account/product and be archived without deletion', () => {
  assert.match(sql, /ALTER TABLE card_stock_jobs[\s\S]*ADD COLUMN provider_account_id CHAR\(36\) NULL/);
  assert.match(sql, /ADD COLUMN product_code VARCHAR\(32\) NULL/);
  assert.match(sql, /ADD COLUMN fallback_for_provider_account_id CHAR\(36\) NULL/);
  assert.match(sql, /ADD COLUMN archived_at TIMESTAMP\(3\) NULL/);
  assert.match(sql, /UPDATE card_stock_jobs\s+SET provider_account_id = '00000000-0000-4000-8000-000000000101', product_code = 'plus'\s+WHERE provider_account_id IS NULL/);
});
