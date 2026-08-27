import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.resolve(here, '../migrations/025_session_recovery_and_finalization.sql'), 'utf8');

test('session recovery migration is additive and replay guarded', () => {
  for (const column of ['customer_action_code', 'session_replacement_count',
    'session_repair_started_at', 'session_repair_expires_at', 'last_session_replaced_at']) {
    assert.match(sql, new RegExp(`column_name = '${column}'`, 'i'));
  }
  assert.match(sql, /CREATE TABLE IF NOT EXISTS order_session_replacements/i);
  assert.match(sql, /session_replacement_window_hours', '72'/i);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)|TRUNCATE\s+TABLE/i);
});
