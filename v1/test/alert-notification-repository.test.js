import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';

test('Bark outbox sends once per open incident and only requeues after resolution', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return [{ affectedRows: 0 }, []];
    }
  };
  await createAlertNotificationRepository(pool).enqueueOpenAlerts();
  assert.equal(calls.length, 3);
  assert.match(calls[1].sql, /n\.status = 'CANCELLED'/);
  assert.doesNotMatch(calls[1].sql, /a\.acknowledged_at IS NOT NULL/);
  assert.match(calls[2].sql, /n\.status IN \('PENDING', 'RETRY', 'SENDING', 'SENT', 'DEAD'\)/);
});
