import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');
const migrationName = '024_traceability_center.sql';
const sql = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');

test('traceability migration is the latest ordered migration', () => {
  const names = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  assert.equal(names.at(-1), migrationName);
  assert.equal(names.at(-2), '023_bark_notifications.sql');
});

test('traceability migration creates the required additive ledgers', () => {
  for (const table of ['card_assignment_history', 'customer_payments', 'order_notes', 'order_tags']) {
    assert.match(sql, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i'));
  }
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /TRUNCATE\s+TABLE/i);
});

test('only one active assignment can exist for a card while history remains append-preserving', () => {
  assert.match(sql, /active_card_id CHAR\(36\) GENERATED ALWAYS AS/i);
  assert.match(sql, /CASE WHEN status = 'ACTIVE' THEN card_id ELSE NULL END/i);
  assert.match(sql, /UNIQUE KEY uq_card_assignment_active_card \(active_card_id\)/i);
  assert.match(sql, /status IN \('ACTIVE', 'RELEASED'\)/i);
});

test('legacy assignment backfill is evidence-bound and replay-safe', () => {
  assert.match(sql, /FROM cards c\s+WHERE c\.order_id IS NOT NULL/i);
  assert.match(sql, /NOT EXISTS \([\s\S]*h\.card_id = c\.id AND h\.status = 'ACTIVE'/i);
  assert.match(sql, /JSON_OBJECT\('source', 'cards\.order_id'/i);
  assert.match(sql, /order_events\.metadata_json\.cardId/i);
  assert.match(sql, /SET c\.inventory_status = 'HELD_FOR_REVIEW'/i);
});

test('payment, note and tag ledgers retain their cross-system relationships', () => {
  for (const constraint of [
    'fk_customer_payments_cdk', 'fk_customer_payments_order',
    'fk_order_notes_order', 'fk_order_tags_order',
    'fk_card_assignment_card', 'fk_card_assignment_order'
  ]) {
    assert.match(sql, new RegExp(`CONSTRAINT ${constraint} FOREIGN KEY`, 'i'));
  }
  assert.match(sql, /external_reference_hmac CHAR\(64\)/i);
  assert.match(sql, /payment is confirmed by CDK issuance; actual payment time was not historically recorded/i);
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM customer_payments p WHERE p\.cdk_id = c\.id/i);
  assert.match(sql, /order_compensations oc WHERE oc\.replacement_cdk_id = c\.id/i);
});

test('PAN exact lookup index is added with a replay guard', () => {
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.match(sql, /ALTER TABLE cards ADD INDEX idx_cards_pan_hmac \(pan_hmac\)/i);
  assert.match(sql, /PREPARE traceability_stmt FROM @traceability_ddl/i);
  assert.match(sql, /ADD COLUMN pan_hmac_version SMALLINT NULL/i);
  assert.match(sql, /UPDATE cards SET pan_hmac_version = 1/i);
});
