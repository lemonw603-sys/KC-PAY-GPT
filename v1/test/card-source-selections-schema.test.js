import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');
const sql = fs.readFileSync(path.join(migrationsDir, '053_card_source_selections_and_supply.sql'), 'utf8');

test('059 is the newest migration; 053 through 059 are additive', () => {
  const names = fs.readdirSync(migrationsDir).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  // 055＝D-286（CDK 发出登记 + 有效期），Lemon 2026-09-19 批准新增；只加列、不动存量。
  assert.equal(names.at(-1), '059_card_max_payments_per_product.sql');
  // 059＝D-221 每卡单数按产品：只补两把 Pro 键（=1），已有值不覆盖；不改结构、不动 Plus 的全局键。
  const perProduct = fs.readFileSync(path.join(migrationsDir, '059_card_max_payments_per_product.sql'), 'utf8');
  assert.doesNotMatch(perProduct, /ALTER TABLE|CREATE TABLE|DELETE|UPDATE\s+app_settings/i);
  assert.match(perProduct, /'card_max_successful_payments:pro_5x', '1'/);
  assert.match(perProduct, /'card_max_successful_payments:pro_20x', '1'/);
  assert.match(perProduct, /ON DUPLICATE KEY UPDATE setting_value = setting_value/);
  assert.doesNotMatch(perProduct, /\('card_max_successful_payments', /);
  const retirement = fs.readFileSync(path.join(migrationsDir, '054_card_retirement.sql'), 'utf8');
  const cdkIssuance = fs.readFileSync(path.join(migrationsDir, '055_cdk_issuance_and_expiry.sql'), 'utf8');
  assert.doesNotMatch(cdkIssuance, /CREATE TABLE/i);
  const cdkSales = fs.readFileSync(path.join(migrationsDir, '056_cdk_sales_metadata.sql'), 'utf8');
  assert.doesNotMatch(cdkSales, /CREATE TABLE|UPDATE\s+cdks|DELETE\s+FROM/i);
  assert.match(cdkSales, /issuance_kind.*DEFAULT 'LEGACY'/);
  const incidents = fs.readFileSync(path.join(migrationsDir, '057_alert_incident_version.sql'), 'utf8');
  assert.match(incidents, /OLD.status <> 'OPEN' AND NEW.status = 'OPEN'/);
  assert.match(incidents, /CREATE TRIGGER operator_alert_incident_version_before_update/);
  for (const text of [sql, retirement, cdkIssuance, cdkSales, incidents]) {
    assert.doesNotMatch(text, /DROP\s+(TABLE|COLUMN)/i);
    assert.doesNotMatch(text, /DELETE\s+FROM/i);
  }
  // 第④步：待销清单不建表（缝 c），只加一个存活期设置键，默认 6 小时。
  assert.match(retirement, /INSERT IGNORE INTO app_settings[\s\S]*'card_min_retire_age_hours', '6'/);
  assert.doesNotMatch(retirement, /CREATE TABLE/i);
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
