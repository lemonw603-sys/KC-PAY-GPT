import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseManualCardWorkbook } from '../src/services/manual-card-import-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here, '../migrations/048_manual_backup_card_import.sql'), 'utf8');

test('manual backup-card migration creates isolated source, audit tables and Browser route mapping', () => {
  assert.match(migration, /manual_excel.*backup-primary/is);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manual_card_import_batches/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manual_card_import_rows/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS fulfillment_route_card_sources/i);
  assert.match(migration, /00000000-0000-4000-8000-000000000103/);
  assert.match(migration, /CHATGPT_PLUS_BROWSER_V1/);
  assert.match(migration, /WHERE fr\.card_provider_account_id = pa\.id/i);
});

test('manual workbook parser rejects non-OOXML bytes before database access', () => {
  assert.throws(() => parseManualCardWorkbook(Buffer.from('not a workbook')), /unsupported spreadsheet format/);
});

test('manual workbook parser never accepts a file over the bounded size', () => {
  assert.throws(() => parseManualCardWorkbook(Buffer.alloc(2 * 1024 * 1024 + 1)), /exceeds 2MB/);
});
