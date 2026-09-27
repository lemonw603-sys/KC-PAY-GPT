import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { checkOrderAvailability } from '../src/db/repositories/order-intake-repository.js';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { encryptSecret } from '../src/security/secret-box.js';
import { createProviderRouteAdminService } from '../src/services/provider-route-admin-service.js';
import {
  createZzshuPointsMonitor, ZZSHU_ALERT_KEYS, ZZSHU_AUTO_SWITCHED_SETTING, ZZSHU_POINTS_ACTOR
} from '../src/services/zzshu-points-monitor.js';

// D-400 / D-401：API 路线（ZZSHU 直充）可用任何卡台的卡 + 点数监控，在真实 MySQL（跑完全部迁移的隔离库）上验。
// 用法：v1/scripts/mysql-tests.sh test/zzshu-api-route-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';

const HNSKJ = '00000000-0000-4000-8000-000000000101';
const BACKUP_A = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';
const ROUTE_API = '00000000-0000-4000-8000-000000000301';
const KEY = Buffer.alloc(32, 7);
const id = () => crypto.randomUUID();

async function setSettings(pool, pairs) {
  for (const [key, value] of Object.entries(pairs)) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [key, value]
    );
  }
}

async function insertCard(pool, { providerAccountId, syncTier, balance = '16.890000', inventory = 'AVAILABLE', orderId = null }) {
  const cardId = id();
  await pool.query(
    `INSERT INTO cards
     (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status, funded_amount, current_balance,
      currency, refund_status, card_credentials_ciphertext, provider_account_id, external_card_id, intake_status,
      sync_tier, source_present, last_synced_at, last_transaction_synced_at)
     VALUES (?, ?, ?, ?, '708', '4022', 'active', '16', ?, 'USD', 'MONITORING', ?, ?, ?, 'ACCEPTED', ?, 1,
       CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [cardId, orderId, inventory, `pc-${cardId}`, balance,
      encryptSecret(JSON.stringify({ cardNumber: '5139899600004022', expMonth: 12, expYear: 2032, cvv: '123' }), KEY),
      providerAccountId, `ext-${cardId}`, syncTier]
  );
  return cardId;
}

async function insertProcessingApiOrder(pool, { cardId, frozen }) {
  const cdkId = id(); const orderId = id(); const publicNo = `PJV1-it-${orderId.slice(0, 8)}`;
  await pool.query(`INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
    [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance,
      session_ciphertext, card_purchase_idempotency_key, product_id, fulfillment_route_id,
      frozen_card_provider_account_id, route_resolution_status, assigned_card_id)
     VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '708', '16.000000', '16.000000', ?, ?, ?, ?, ?, 'RESOLVED', ?)`,
    [orderId, publicNo, cdkId, encryptSecret(JSON.stringify({ accessToken: 'x' }), KEY), `purchase-${orderId}`,
      PLUS, ROUTE_API, frozen, cardId]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  await pool.query(
    `INSERT INTO recharge_attempts (id, order_id, executor_kind, status, funds_risk_state, submit_intent_at, submitted_at)
     VALUES (?, ?, 'API', 'PROCESSING', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`, [id(), orderId]);
  return { orderId, publicNo };
}

test('D-401 migration 062: backup-a can do API recharge, the Plus API row is unlocked (version bumped), Pro API rows stay locked', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
  try {
    const [[backup]] = await pool.query('SELECT supports_api_recharge, supports_browser_recharge FROM provider_accounts WHERE id = ?', [BACKUP_A]);
    assert.deepEqual(backup, { supports_api_recharge: 1, supports_browser_recharge: 1 });
    const [rows] = await pool.query(
      `SELECT p.product_code, s.locked, s.version, s.updated_by FROM card_source_selections s
         INNER JOIN products p ON p.id = s.product_id WHERE s.executor_kind = 'API' ORDER BY p.product_code`
    );
    assert.deepEqual(rows.map((r) => [r.product_code, Number(r.locked), r.updated_by]), [
      ['chatgpt_plus', 0, 'migration-062'], ['chatgpt_pro_20x', 1, 'migration-053'], ['chatgpt_pro_5x', 1, 'migration-053']
    ]);
    assert.equal(Number(rows[0].version), 2);
  } finally { await pool.end(); }
});

test('D-401 intake: an API route frozen to backup-a resolves on real SQL; zero points refuse it; losing the capability closes the route', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
  try {
    await setSettings(pool, {
      accept_new_orders: 'true', default_card_type_id: '708', default_open_card_amount: '16', default_minimum_required_card_balance: '16.00',
      worker_heartbeat_at: new Date().toISOString()
    });
    await pool.query(`UPDATE card_source_selections SET provider_account_id = ? WHERE product_id = ? AND executor_kind = 'API'`, [BACKUP_A, PLUS]);
    await setSettings(pool, { zzshu_points_remaining: '5' });
    assert.deepEqual(await checkOrderAvailability(pool, { planType: 'plus' }), { ok: true });
    await setSettings(pool, { zzshu_points_remaining: '0' });
    assert.deepEqual(await checkOrderAvailability(pool, { planType: 'plus' }), { ok: false, code: 'EXECUTOR_UNAVAILABLE' });
    await setSettings(pool, { zzshu_points_remaining: '5' });
    await pool.query('UPDATE provider_accounts SET supports_api_recharge = 0 WHERE id = ?', [BACKUP_A]);
    assert.deepEqual(await checkOrderAvailability(pool, { planType: 'plus' }), { ok: false, code: 'ORDER_ROUTE_UNAVAILABLE' });
  } finally {
    await pool.query('UPDATE provider_accounts SET supports_api_recharge = 1 WHERE id = ?', [BACKUP_A]);
    await pool.query(`UPDATE card_source_selections SET provider_account_id = ? WHERE product_id = ? AND executor_kind = 'API'`, [HNSKJ, PLUS]);
    await pool.query(`DELETE FROM app_settings WHERE setting_key = 'zzshu_points_remaining'`);
    await pool.end();
  }
});

test('D-401 provider-confirmed failure on API: alert raised; a manual-import (highvcc) card gets no doomed hnskj sync job, an API-sync card still does', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
  try {
    for (const [provider, tier, expectedJobs] of [[BACKUP_A, 'MANUAL_IMPORT', 0], [HNSKJ, 'ASSIGNED', 1]]) {
      const cardId = await insertCard(pool, { providerAccountId: provider, syncTier: tier, inventory: 'ASSIGNED' });
      const { orderId, publicNo } = await insertProcessingApiOrder(pool, { cardId, frozen: provider });
      await workflow.commitRechargeFailure(orderId, { status: 'failed', failureReason: '该卡交易过于频繁，请稍后再试或换卡' });
      const [[order]] = await pool.query('SELECT status, failure_code FROM orders WHERE id = ?', [orderId]);
      assert.deepEqual(order, { status: 'RECHARGE_FAILED', failure_code: 'PROVIDER_CONFIRMED_FAILURE' });
      const [[jobs]] = await pool.query('SELECT COUNT(*) AS n FROM card_sync_jobs WHERE card_id = ?', [cardId]);
      assert.equal(Number(jobs.n), expectedJobs, `${tier}: sync jobs`);
      const [[alert]] = await pool.query(
        `SELECT alert_type, status, severity, order_id, message, incident_version FROM operator_alerts WHERE dedupe_key = ?`,
        [`api-order-failed:${orderId}`]
      );
      assert.equal(alert.alert_type, 'API_ORDER_FAILED');
      assert.equal(alert.status, 'OPEN');
      assert.equal(alert.severity, 'critical');
      assert.equal(alert.order_id, orderId);
      assert.equal(Number(alert.incident_version), 1);
      assert.equal(alert.message, `订单 ${publicNo}｜直充平台返回失败：该卡交易过于频繁，请稍后再试或换卡。卡的占用已转对账、卡密没有自动退回；核对卡台扣款后到后台收口。`);
    }
  } finally { await pool.end(); }
});

async function prepareBrowserFallback(pool, { heartbeatFresh }) {
  await setSettings(pool, {
    default_minimum_required_card_balance: '16.00', browser_dispatch_enabled: 'true',
    browser_worker_heartbeat_at: new Date(Date.now() - (heartbeatFresh ? 5_000 : 600_000)).toISOString()
  });
  await pool.query(`UPDATE executor_profiles SET status = 'ACTIVE' WHERE executor_kind = 'BROWSER'`);
  await pool.query(`UPDATE card_source_selections SET provider_account_id = ? WHERE product_id = ? AND executor_kind = 'BROWSER'`, [BACKUP_A, PLUS]);
  await pool.query(`UPDATE fulfillment_routes SET accepts_new_orders = (executor_kind = 'API') WHERE product_id = ?`, [PLUS]);
  await setSettings(pool, { [ZZSHU_AUTO_SWITCHED_SETTING]: '' });
  await pool.query(`DELETE FROM operator_alerts WHERE dedupe_key LIKE 'zzshu-%'`);
}

async function plusRoutes(pool) {
  const [rows] = await pool.query(
    'SELECT executor_kind, accepts_new_orders FROM fulfillment_routes WHERE product_id = ? ORDER BY executor_kind', [PLUS]
  );
  return Object.fromEntries(rows.map((r) => [r.executor_kind, Number(r.accepts_new_orders)]));
}

async function alertState(pool, key) {
  const [[row]] = await pool.query('SELECT status, incident_version, message FROM operator_alerts WHERE dedupe_key = ?', [key]);
  return row || null;
}

test('D-401 points monitor: zero points on API switch Plus to Browser through the audited route service; top-up reminds once and never switches back', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const cardId = await insertCard(pool, { providerAccountId: BACKUP_A, syncTier: 'MANUAL_IMPORT' });
  try {
    await prepareBrowserFallback(pool, { heartbeatFresh: true });
    let points = 0;
    const monitor = createZzshuPointsMonitor({
      pool, provider: { readPoints: async () => ({ points }) }, routeAdmin: createProviderRouteAdminService({ pool })
    });
    const first = await monitor.check();
    assert.deepEqual({ autoSwitched: first.autoSwitched, executor: first.executor }, { autoSwitched: true, executor: 'API' });
    assert.deepEqual(await plusRoutes(pool), { API: 0, BROWSER: 1 });
    const [[event]] = await pool.query('SELECT actor_id FROM provider_route_switch_events ORDER BY created_at DESC LIMIT 1');
    assert.equal(event.actor_id, ZZSHU_POINTS_ACTOR);
    const [[flag]] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [ZZSHU_AUTO_SWITCHED_SETTING]);
    assert.ok(Date.parse(flag.setting_value) > 0, 'remembers the automatic switch');
    const empty = await alertState(pool, ZZSHU_ALERT_KEYS.EMPTY);
    assert.equal(empty.status, 'OPEN');
    assert.match(empty.message, /已自动改走 Browser/);
    assert.equal((await alertState(pool, ZZSHU_ALERT_KEYS.LOW)).status, 'OPEN');

    // 再跑一轮仍为 0：不重复切、告警不重开（incident 不涨 → 不重推）。
    await monitor.check();
    assert.equal(Number((await alertState(pool, ZZSHU_ALERT_KEYS.EMPTY)).incident_version), 1);

    points = 8;
    const restored = await monitor.check();
    assert.equal(restored.executor, 'BROWSER');
    assert.deepEqual(await plusRoutes(pool), { API: 0, BROWSER: 1 }, 'never switches back by itself');
    assert.equal((await alertState(pool, ZZSHU_ALERT_KEYS.EMPTY)).status, 'RESOLVED');
    assert.equal((await alertState(pool, ZZSHU_ALERT_KEYS.LOW)).status, 'RESOLVED');
    const reminder = await alertState(pool, ZZSHU_ALERT_KEYS.RESTORED);
    assert.equal(reminder.status, 'OPEN');
    assert.match(reminder.message, /恢复到 8。/);
    const [[cleared]] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [ZZSHU_AUTO_SWITCHED_SETTING]);
    assert.equal(cleared.setting_value, '');
  } finally {
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.end();
  }
});

test('D-401 points monitor: when Browser is not ready the switch is refused, routes stay put, and the alert says API intake is paused', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3, timezone: 'Z' });
  const cardId = await insertCard(pool, { providerAccountId: BACKUP_A, syncTier: 'MANUAL_IMPORT' });
  try {
    await prepareBrowserFallback(pool, { heartbeatFresh: false });
    const monitor = createZzshuPointsMonitor({
      pool, provider: { readPoints: async () => ({ points: 0 }) }, routeAdmin: createProviderRouteAdminService({ pool })
    });
    const result = await monitor.check();
    assert.equal(result.autoSwitched, false);
    assert.equal(result.switchRejected, 'BROWSER_RECHARGE_NOT_READY');
    assert.deepEqual(await plusRoutes(pool), { API: 1, BROWSER: 0 });
    assert.match((await alertState(pool, ZZSHU_ALERT_KEYS.EMPTY)).message, /没能自动切到 Browser（.+），API 路线的新单已暂停接单/);
  } finally {
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.end();
  }
});
