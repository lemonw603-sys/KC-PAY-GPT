import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(here, '../migrations/028_browser_artifact_vault_recovery.sql'),
  'utf8'
);

test('artifact vault migration separates encrypted authority from the public index', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS browser_artifact_secrets/i);
  assert.match(migration, /key_version SMALLINT UNSIGNED NOT NULL/i);
  assert.match(migration, /iv VARBINARY\(12\) NULL/i);
  assert.match(migration, /auth_tag VARBINARY\(16\) NULL/i);
  assert.match(migration, /ciphertext MEDIUMBLOB NULL/i);
  assert.match(migration, /destroyed_at TIMESTAMP\(3\) NULL/i);
  assert.doesNotMatch(migration, /(?:navigation_)?url\s+(?:TEXT|VARCHAR|JSON)/i);
});

test('artifact vault replay guards every additive ALTER and keeps foreign keys explicit', () => {
  assert.match(migration, /information_schema\.COLUMNS[\s\S]*COLUMN_NAME = 'expires_at'/i);
  assert.match(migration, /information_schema\.COLUMNS[\s\S]*COLUMN_NAME = 'destroyed_at'/i);
  assert.match(migration, /information_schema\.STATISTICS[\s\S]*idx_checkout_artifacts_expiry/i);
  assert.match(migration, /information_schema\.TABLE_CONSTRAINTS[\s\S]*fk_checkout_artifacts_secret_ref/i);
  assert.match(migration, /fk_browser_artifact_secrets_run/i);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)/i);
});

test('destroyed vault rows are required to contain no recoverable cryptographic material', () => {
  assert.match(migration, /destroyed_at IS NULL[\s\S]*iv IS NOT NULL[\s\S]*auth_tag IS NOT NULL[\s\S]*ciphertext IS NOT NULL/i);
  assert.match(migration, /destroyed_at IS NOT NULL[\s\S]*iv IS NULL[\s\S]*auth_tag IS NULL[\s\S]*ciphertext IS NULL/i);
});
