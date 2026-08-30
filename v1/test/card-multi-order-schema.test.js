import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '../migrations/043_order_assigned_card.sql'), 'utf8');

test('order-side card binding enables multi-order reuse without rewriting legacy history', () => {
  assert.match(sql, /orders ADD COLUMN assigned_card_id CHAR\(36\) NULL/i);
  assert.match(sql, /UPDATE orders o INNER JOIN cards c ON c\.order_id = o\.id/i);
  assert.match(sql, /FOREIGN KEY \(assigned_card_id\) REFERENCES cards\(id\)/i);
  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE|DROP TABLE/i);
});
