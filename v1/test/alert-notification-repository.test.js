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
  // 3 条：入队 + 复活 CANCELLED + 收掉已关闭告警的待推行。
  // D-275 ④：撤掉 DAILY_DIGEST 开关后白名单不再读 app_settings 设置，少了那次 SELECT（enqueue 行为不变）。
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT IGNORE INTO alert_notifications/);
  assert.match(calls[1].sql, /n\.status = 'CANCELLED'/);
  assert.doesNotMatch(calls[1].sql, /a\.acknowledged_at IS NOT NULL/);
  assert.match(calls[2].sql, /n\.status IN \('PENDING', 'RETRY', 'SENDING', 'SENT', 'DEAD'\)/);
});
