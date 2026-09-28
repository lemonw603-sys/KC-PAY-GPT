import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '../src/db/pool.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';
import { assertIsolatedTestDatabase } from './helpers/isolated-database.js';

// D-365（Lemon 同意）：同一台卡台的「卡台故障」推过，这台的「缺卡但开不出来」只进后台不另推。
// 真实 MySQL（含 057 触发器）上跑，因为覆盖条件是一段 SQL，假库测不出它对不对。
const url = process.env.SUPPLY_ALERT_TEST_DATABASE_URL;
test('卡台故障推过 → 同台缺卡告警不推；别的台、故障没推成、故障已恢复 → 照推', { skip: !url && 'requires isolated SUPPLY_ALERT_TEST_DATABASE_URL' }, async () => {
  assertIsolatedTestDatabase(url);
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

// D-407（Lemon 2026-09-28）：同一台已推「余额不够开新卡」或「卡台故障」，这台的「卡不够」只进后台。
test('余额不够 / 故障推过 → 同台卡不够不推；别的台、覆盖那条已关、覆盖那条推送 DEAD → 照推', { skip: !url && 'requires isolated SUPPLY_ALERT_TEST_DATABASE_URL' }, async () => {
  assertIsolatedTestDatabase(url);
  const pool = createDatabasePool({ url, tls: { enabled: false } });
  const repo = createAlertNotificationRepository(pool);
  const ids = [];
  const open = async (type, key, severity = 'warning') => {
    const id = randomUUID(); ids.push(id);
    await pool.query("INSERT INTO operator_alerts (id, alert_type, dedupe_key, severity, title, message, status) VALUES (?, ?, ?, ?, 't', 'm', 'OPEN')", [id, type, key, severity]);
    return id;
  };
  const drain = async () => { const got = []; for (;;) { const n = await repo.claimNext(); if (!n) return got; got.push(n.type + ':' + n.alertId); await repo.markSent(n.id, { incidentVersion: n.incidentVersion }); } };
  const statusOf = async (alertId) => (await pool.query('SELECT status FROM alert_notifications WHERE alert_id = ?', [alertId]))[0][0].status;
  try {
    const W = randomUUID(); const F = randomUUID(); const B = randomUUID();
    // 09-28 03:29 的样子：同一轮先写余额不够（critical），再写卡不够（warning）。
    const walletW = await open('CARD_SUPPLY_WALLET_LOW', `card-supply-wallet-low:${W}`, 'critical');
    const stockW = await open('CARD_STOCK_LOW', `card-stock-low:${W}:plus`);
    const faultF = await open('CARD_SUPPLY_FAULT', `card-supply-fault:${F}`, 'critical');
    const stockF = await open('CARD_STOCK_LOW', `card-stock-low:${F}:plus`);
    const stockB = await open('CARD_STOCK_LOW', `card-stock-low:${B}:plus`);
    await repo.enqueueOpenAlerts();
    assert.deepEqual((await drain()).sort(), [`CARD_STOCK_LOW:${stockB}`, `CARD_SUPPLY_FAULT:${faultF}`, `CARD_SUPPLY_WALLET_LOW:${walletW}`].sort(),
      '余额不够、故障各推一条；没有覆盖的 B 台卡不够照推');
    assert.equal(await statusOf(stockW), 'PENDING', '被盖住的只是不领取，后台照有');
    assert.equal(await statusOf(stockF), 'PENDING');

    // 余额不够那条关了（充过钱）而这台仍缺卡：卡不够不再被盖，推一次。
    await pool.query("UPDATE operator_alerts SET status = 'RESOLVED' WHERE id = ?", [walletW]);
    await repo.enqueueOpenAlerts();
    assert.deepEqual(await drain(), [`CARD_STOCK_LOW:${stockW}`]);

    // 余额不够那条推送 DEAD（手机没收到）：不能拿它去盖。
    const D = randomUUID();
    const walletD = await open('CARD_SUPPLY_WALLET_LOW', `card-supply-wallet-low:${D}`, 'critical');
    await repo.enqueueOpenAlerts();
    const w = await repo.claimNext(); assert.equal(w.alertId, walletD);
    await repo.markFailed(w.id, { incidentVersion: w.incidentVersion, error: new Error('bark down'), retryable: false, attemptCount: 1, maxAttempts: 1 });
    const stockD = await open('CARD_STOCK_LOW', `card-stock-low:${D}:plus`);
    await repo.enqueueOpenAlerts();
    assert.deepEqual(await drain(), [`CARD_STOCK_LOW:${stockD}`]);
  } finally {
    for (const id of ids) { await pool.query('DELETE FROM alert_notifications WHERE alert_id = ?', [id]); await pool.query('DELETE FROM operator_alerts WHERE id = ?', [id]); }
    await pool.end();
  }
});
