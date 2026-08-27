import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(
  path.resolve(here, '../migrations/026_automatic_fulfillment_funds_fence.sql'),
  'utf8'
);

test('create-direct calls are unique per recharge attempt without restricting read evidence', () => {
  assert.match(sql, /recharge_dispatch_mode', 'AUTOMATIC'/i);
  assert.match(sql, /recharge_create_attempt_id CHAR\(36\) GENERATED ALWAYS AS/i);
  assert.match(sql, /WHEN operation = ''create_direct'' THEN recharge_attempt_id ELSE NULL END/i);
  assert.match(sql, /UNIQUE INDEX uq_provider_calls_recharge_create_attempt/i);
});

test('automatic fulfillment migration is additive, guarded, and contains no provider operation', () => {
  assert.match(sql, /duplicate create_direct calls must be reconciled before migration 026/i);
  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE|https?:\/\//i);
});

test('historical create-call repair is limited to finished definite failures', () => {
  assert.match(sql, /pc\.outcome = 'DEFINITE_FAILURE'/i);
  assert.match(sql, /pc\.finished_at IS NOT NULL/i);
  assert.match(sql, /o\.status = 'RECHARGE_FAILED'/i);
  assert.match(sql, /o\.recharge_order_no IS NULL/i);
  assert.match(sql, /'REJECTED', 'CLEARED'/i);
  assert.match(sql, /stage3_definite_failure_backfill/i);
  assert.doesNotMatch(sql, /outcome\s+IN\s*\([^)]*UNKNOWN/i);
});
