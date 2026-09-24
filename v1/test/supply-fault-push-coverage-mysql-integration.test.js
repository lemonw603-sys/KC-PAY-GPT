import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '../src/db/pool.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';

// D-365（Lemon 同意）：同一台卡台的「卡台故障」推过，这台的「缺卡但开不出来」只进后台不另推。
// 真实 MySQL（含 057 触发器）上跑，因为覆盖条件是一段 SQL，假库测不出它对不对。
const url = process.env.SUPPLY_ALERT_TEST_DATABASE_URL;
test('卡台故障推过 → 同台缺卡告警不推；别的台、故障没推成、故障已恢复 → 照推', { skip: !url && 'requires isolated SUPPLY_ALERT_TEST_DATABASE_URL' }, async () => {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1');
  const pool = createDatabasePool({ url, tls: { enabled: false } });
  const repo = createAlertNotificationRepository(pool);
  const A = randomUUID(); const B = randomUUID(); const ids = [];
  const open = async (type, key) => {
    const id = randomUUID(); ids.push(id);
    await pool.query("INSERT INTO operator_alerts (id, alert_type, dedupe_key, severity, title, message, status) VALUES (?, ?, ?, 'critical', 't', 'm', 'OPEN')", [id, type, key]);
    return id;
  };
  const drain = async () => { const got = []; for (;;) { const n = await repo.claimNext(); if (!n) return got; got.push(n.type + ':' + n.alertId); await repo.markSent(n.id, { incidentVersion: n.incidentVersion }); } };
  try {
    const faultA = await open('CARD_SUPPLY_FAULT', `card-supply-fault:${A}`);
    const blockedA = await open('CARD_SUPPLY_BLOCKED', `card-supply-blocked:${A}:plus`);
    const blockedB = await open('CARD_SUPPLY_BLOCKED', `card-supply-blocked:${B}:plus`);
    await repo.enqueueOpenAlerts();
    assert.deepEqual(await drain(), [`CARD_SUPPLY_FAULT:${faultA}`, `CARD_SUPPLY_BLOCKED:${blockedB}`],
      'A 台只推故障一条；B 台没有故障告警，缺卡照推');
    const [[row]] = await pool.query('SELECT status FROM alert_notifications WHERE alert_id = ?', [blockedA]);
    assert.equal(row.status, 'PENDING', '被盖住的只是不领取，告警本身还在后台');

    // 故障恢复（告警关掉）而这台仍缺卡：缺卡那条不再被盖，推一次。
    await pool.query("UPDATE operator_alerts SET status = 'RESOLVED' WHERE id = ?", [faultA]);
    await repo.enqueueOpenAlerts();
    assert.deepEqual(await drain(), [`CARD_SUPPLY_BLOCKED:${blockedA}`]);

    // 故障那条推送失败成 DEAD（手机没收到）：不能拿它去盖缺卡，缺卡要推出去。
    const C = randomUUID();
    const faultC = await open('CARD_SUPPLY_FAULT', `card-supply-fault:${C}`);
    await repo.enqueueOpenAlerts();
    const f = await repo.claimNext(); assert.equal(f.alertId, faultC);
    await repo.markFailed(f.id, { incidentVersion: f.incidentVersion, error: new Error('bark down'), retryable: false, attemptCount: 1, maxAttempts: 1 });
    const blockedC = await open('CARD_SUPPLY_BLOCKED', `card-supply-blocked:${C}:plus`);
    await repo.enqueueOpenAlerts();
    assert.deepEqual(await drain(), [`CARD_SUPPLY_BLOCKED:${blockedC}`]);
  } finally {
    for (const id of ids) { await pool.query('DELETE FROM alert_notifications WHERE alert_id = ?', [id]); await pool.query('DELETE FROM operator_alerts WHERE id = ?', [id]); }
    await pool.end();
  }
});
