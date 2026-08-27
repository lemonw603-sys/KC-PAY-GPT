import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');
const migrationName = '027_browser_execution_control_plane.sql';
const sql = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');

test('Browser control-plane migration follows the automatic funds-fence migration', () => {
  const names = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const index = names.indexOf(migrationName);
  assert.equal(names[index - 1], '026_automatic_fulfillment_funds_fence.sql');
  assert.equal(names[index + 1], '028_browser_artifact_vault_recovery.sql');
});

test('Browser control-plane schema is additive and keeps production writes disabled', () => {
  for (const table of [
    'executor_profiles',
    'browser_runs',
    'browser_checkpoints',
    'browser_operations',
    'payment_permits',
    'checkout_artifacts',
    'execution_resource_leases',
    'browser_interventions'
  ]) {
    assert.match(sql, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i'), table);
  }
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.match(sql, /browser_dispatch_enabled', 'false'/i);
  assert.match(sql, /browser_payment_writes_enabled', 'false'/i);
  assert.match(sql, /'CHATGPT_PLUS_BROWSER_V1'[\s\S]*'BROWSER', 0, 1/i);
});

test('Browser attempts freeze an executor profile and runs preserve single active ownership', () => {
  assert.match(sql, /ADD COLUMN executor_profile_id CHAR\(36\) NULL/i);
  assert.match(sql, /fk_recharge_attempts_executor_profile/i);
  assert.match(sql, /active_attempt_id CHAR\(36\) GENERATED ALWAYS AS/i);
  assert.match(sql, /active_account_key_hmac CHAR\(64\) GENERATED ALWAYS AS/i);
  assert.match(sql, /UNIQUE KEY uq_browser_runs_active_attempt \(active_attempt_id\)/i);
  assert.match(sql, /UNIQUE KEY uq_browser_runs_active_account \(active_account_key_hmac\)/i);
  assert.match(sql, /UNIQUE KEY uq_browser_runs_start_operation \(start_operation_key\)/i);
});

test('payment authorization has one active and at most one consumed permit per funds attempt', () => {
  assert.match(sql, /active_attempt_id CHAR\(36\) GENERATED ALWAYS AS[\s\S]*status = 'ISSUED'/i);
  assert.match(sql, /consumed_attempt_id CHAR\(36\) GENERATED ALWAYS AS[\s\S]*status = 'CONSUMED'/i);
  assert.match(sql, /UNIQUE KEY uq_payment_permits_active_attempt \(active_attempt_id\)/i);
  assert.match(sql, /UNIQUE KEY uq_payment_permits_consumed_attempt \(consumed_attempt_id\)/i);
  assert.match(sql, /UNIQUE KEY uq_browser_operations_idempotency \(browser_run_id, operation_id\)/i);
  assert.match(sql, /UNIQUE KEY uq_browser_checkpoints_operation \(browser_run_id, operation_id\)/i);
});

test('sensitive Checkout authority is represented only by a secret reference and hashes', () => {
  const artifactTable = sql.match(/CREATE TABLE IF NOT EXISTS checkout_artifacts \([\s\S]*?\n\) ENGINE=/i)?.[0] || '';
  assert.match(artifactTable, /secret_ref VARCHAR\(255\) NOT NULL/i);
  assert.match(artifactTable, /url_hash CHAR\(64\) NOT NULL/i);
  assert.match(artifactTable, /checkout_hash CHAR\(64\) NULL/i);
  assert.doesNotMatch(artifactTable, /(?:navigation_)?url\s+(?:TEXT|VARCHAR|JSON)/i);
});

test('post-payment lifecycle migration is additive and separates activation evidence', () => {
  const postPaymentName = '031_browser_post_payment_lifecycle.sql';
  const postPaymentSql = fs.readFileSync(path.join(migrationsDir, postPaymentName), 'utf8');
  const names = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  assert.equal(names[names.indexOf(postPaymentName) - 1], '030_card_funding_attempts.sql');
  assert.match(postPaymentSql, /CREATE TABLE browser_post_payment_observations/i);
  assert.match(postPaymentSql, /ADD COLUMN post_payment_state VARCHAR\(32\)/i);
  assert.match(postPaymentSql, /PLUS_PENDING/);
  assert.match(postPaymentSql, /CANCELLATION_CONFIRMED/);
  assert.doesNotMatch(postPaymentSql, /DROP\s+(?:TABLE|COLUMN)/i);
});

test('Browser dispatch queue stores references and supports expiring claims', () => {
  const dispatchName = '032_browser_dispatch_queue.sql';
  const dispatchSql = fs.readFileSync(path.join(migrationsDir, dispatchName), 'utf8');
  assert.match(dispatchSql, /CREATE TABLE IF NOT EXISTS browser_dispatch_jobs/i);
  assert.match(dispatchSql, /UNIQUE KEY uq_browser_dispatch_attempt/i);
  assert.match(dispatchSql, /lease_token_hash CHAR\(64\)/i);
  assert.match(dispatchSql, /FOR UPDATE|status VARCHAR\(24\)/i);
  const dispatchDefinition = dispatchSql.slice(dispatchSql.indexOf('CREATE TABLE'));
  assert.doesNotMatch(dispatchDefinition, /session|card_number|checkout_url|authority/i);
});
