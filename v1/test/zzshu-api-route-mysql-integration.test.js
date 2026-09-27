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
import { reserveCardConsumptionInTransaction } from '../src/services/card-consumption-ledger-service.js';
import { apiFailureReleaseConfirmation, createApiFailureReleaseService } from '../src/services/api-failure-release-service.js';
import { createAdminReadService } from '../src/services/admin-read-service.js';
import { commitCardTransactionsForCard } from '../src/db/repositories/card-transaction-repository.js';
import { toCardTransactionRow } from '../src/services/highvcc-snapshot-sync-service.js';

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
      // 欠账 23：文案指向后台真实存在的按钮（以前写「到后台收口」，而这类单后台没有收口入口）。
      assert.equal(alert.message, `订单 ${publicNo}｜直充平台返回失败：该卡交易过于频繁，请稍后再试或换卡。卡先锁着、卡密没退。到卡台看这张卡：没被扣钱就在后台订单点「放卡退卡密」，客户可用原卡密重交（卡台有被拒记录的，约 1 小时内也会自动放卡）；被扣了钱先别动，找执行者。`);
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

// ---- 欠账 23（2026-09-27 整体排查）：API 失败单卡锁在对账 → 放卡退卡密 / 自动放卡，与「成功扣款」同一口径 ----

async function failedApiOrderWithLockedHighvccCard(pool, workflow) {
  const cardId = await insertCard(pool, { providerAccountId: BACKUP_A, syncTier: 'MANUAL_IMPORT', inventory: 'ASSIGNED', balance: '16.000000' });
  const { orderId, publicNo } = await insertProcessingApiOrder(pool, { cardId, frozen: BACKUP_A });
  // 真实 API 单提交后带直充单号与卡键（手工收口守卫认它们）
  await pool.query('UPDATE orders SET recharge_order_no = ?, recharge_card_key = ? WHERE id = ?',
    [`9${orderId.slice(0, 5)}`, `DIRECT-it-${orderId.slice(0, 8)}`, orderId]);
  const [[attempt]] = await pool.query('SELECT id FROM recharge_attempts WHERE order_id = ?', [orderId]);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await reserveCardConsumptionInTransaction(connection, {
      cardId, orderId, rechargeAttemptId: attempt.id, productId: PLUS, amount: '16.000000', currency: 'USD'
    });
    await connection.commit();
  } finally { connection.release(); }
  await pool.query(
    `INSERT INTO card_assignment_history (id, card_id, order_id, assignment_kind, status, assigned_by, assignment_reason)
     VALUES (UUID(), ?, ?, 'NORMAL', 'ACTIVE', 'test:fixture', 'api failure release')`, [cardId, orderId]);
  await workflow.commitRechargeFailure(orderId, { status: 'failed', failureReason: '该卡交易过于频繁，请稍后再试或换卡' });
  return { cardId, orderId, publicNo };
}

// 「需要我处理」分段器点进去的那条筛选（status=REVIEW_REQUIRED）——顶部数字与列表必须同一口径。
async function inReviewFilter(pool, publicNo) {
  const list = await createAdminReadService({ pool, sessionEncryptionKey: KEY })
    .listOrders({ page: 1, pageSize: 100, includeSummary: false, groupByCdk: false, timeField: 'CREATED', status: 'REVIEW_REQUIRED' });
  return (list.orders || list.items || []).some((row) => row.publicNo === publicNo);
}

async function listRow(pool, publicNo) {
  const list = await createAdminReadService({ pool, sessionEncryptionKey: KEY })
    .listOrders({ page: 1, pageSize: 100, includeSummary: false, groupByCdk: false, timeField: 'CREATED' });
  return (list.orders || list.items || []).find((row) => row.publicNo === publicNo);
}

const authorization = (orderId, status) => toCardTransactionRow({
  cardAuthId: `auth-${status}-${orderId}`, cardId: 'hg-x', amount: 1575, unit: 'USD', status,
  reason: status === 'COMPLETE' ? 'APPROVE' : 'DECLINE', merchantAmount: 98214, merchantCurrency: 'PHP',
  desc: 'OPENAI *CHATGPT SUBSCR', merchantCountry: 'US', tradeTimeEpochMs: Date.now()
});

test('欠账 23 release: a provider-confirmed API failure on a highvcc card needs a person, releases on real SQL, returns the CDK, closes the alert, and cannot run twice', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
  try {
    const f = await failedApiOrderWithLockedHighvccCard(pool, workflow);
    const [[ledgerBefore]] = await pool.query('SELECT status FROM card_consumption_ledger WHERE order_id = ?', [f.orderId]);
    assert.equal(ledgerBefore.status, 'RECONCILIATION');

    const before = await listRow(pool, f.publicNo);
    assert.equal(before.bucket, 'action', 'a locked API failure is in 需要我处理');
    assert.deepEqual(before.primaryAction, { key: 'release', label: '放卡退卡密' });
    assert.equal(await inReviewFilter(pool, f.publicNo), true, 'clicking 需要我处理 lists it (the count and the list share one rule)');
    const detail = await createAdminReadService({ pool, sessionEncryptionKey: KEY }).getOrder(f.publicNo);
    assert.deepEqual(detail.apiFailureRelease, { eligible: true, locked: true, reasonCode: null });
    assert.equal(detail.manualFulfillment.blocked, true, 'the manual button the backend would refuse is not offered');

    const release = createApiFailureReleaseService({ pool });
    await assert.rejects(release(f.publicNo, { confirmation: '确认没扣款' }), { code: 'API_FAILURE_RELEASE_CONFIRMATION_REQUIRED' });
    const result = await release(f.publicNo, { confirmation: apiFailureReleaseConfirmation(f.publicNo), note: '卡台只有被拒记录', actorId: 'it-admin' });
    assert.deepEqual(result, { publicNo: f.publicNo, released: 1, cdkReturned: true, cardLast4: '4022' });

    const [[ledger]] = await pool.query('SELECT status, release_reason, JSON_UNQUOTE(JSON_EXTRACT(evidence_json, \'$.source\')) AS source FROM card_consumption_ledger WHERE order_id = ?', [f.orderId]);
    assert.deepEqual(ledger, { status: 'RELEASED', release_reason: 'operator verified the failed API order did not charge the card', source: 'admin_api_failure_release' });
    const [[assignment]] = await pool.query('SELECT status, released_by FROM card_assignment_history WHERE order_id = ?', [f.orderId]);
    assert.deepEqual(assignment, { status: 'RELEASED', released_by: 'admin:it-admin' });
    const [[cdk]] = await pool.query('SELECT c.status, c.order_id FROM cdks c INNER JOIN orders o ON o.cdk_id = c.id WHERE o.id = ?', [f.orderId]);
    assert.deepEqual(cdk, { status: 'AVAILABLE', order_id: null });
    const [[alert]] = await pool.query('SELECT status FROM operator_alerts WHERE dedupe_key = ?', [`api-order-failed:${f.orderId}`]);
    assert.equal(alert.status, 'RESOLVED');
    const [[order]] = await pool.query('SELECT status FROM orders WHERE id = ?', [f.orderId]);
    assert.equal(order.status, 'RECHARGE_FAILED');
    const [events] = await pool.query(`SELECT actor_type, actor_id FROM order_events WHERE order_id = ? AND actor_type = 'ADMIN'`, [f.orderId]);
    assert.deepEqual(events.map((e) => [e.actor_type, e.actor_id]), [['ADMIN', 'it-admin']]);

    const after = await listRow(pool, f.publicNo);
    assert.equal(after.bucket, 'failed', 'released: no longer needs a person');
    assert.equal(await inReviewFilter(pool, f.publicNo), false);
    assert.equal(after.primaryAction, null, 'no doomed manual button (the order carries a provider order number)');
    await assert.rejects(release(f.publicNo, { confirmation: apiFailureReleaseConfirmation(f.publicNo) }), { code: 'API_FAILURE_RELEASE_NOTHING_LOCKED' });
  } finally { await pool.end(); }
});

test('欠账 23 release: a COMPLETE (highvcc) purchase after the reservation blocks both the button and the automatic release; a DECLINED one lets the card sync release it and close the alert', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
  try {
    const charged = await failedApiOrderWithLockedHighvccCard(pool, workflow);
    await commitCardTransactionsForCard(pool, { cardId: charged.cardId, transactions: [authorization(charged.orderId, 'COMPLETE')], cardSnapshot: null });
    const [[stillLocked]] = await pool.query('SELECT status FROM card_consumption_ledger WHERE order_id = ?', [charged.orderId]);
    assert.equal(stillLocked.status, 'RECONCILIATION', 'a COMPLETE purchase is a charge: the card sync must not release');
    const row = await listRow(pool, charged.publicNo);
    assert.equal(row.bucket, 'action');
    assert.deepEqual(row.primaryAction, { key: 'verify', label: '去核实' });
    await assert.rejects(createApiFailureReleaseService({ pool })(charged.publicNo, { confirmation: apiFailureReleaseConfirmation(charged.publicNo) }),
      { code: 'API_FAILURE_RELEASE_CHARGE_OBSERVED' });
    const [[openAlert]] = await pool.query('SELECT status FROM operator_alerts WHERE dedupe_key = ?', [`api-order-failed:${charged.orderId}`]);
    assert.equal(openAlert.status, 'OPEN');

    const declined = await failedApiOrderWithLockedHighvccCard(pool, workflow);
    await commitCardTransactionsForCard(pool, { cardId: declined.cardId, transactions: [authorization(declined.orderId, 'DECLINED')], cardSnapshot: null });
    const [[released]] = await pool.query('SELECT status, release_reason FROM card_consumption_ledger WHERE order_id = ?', [declined.orderId]);
    assert.deepEqual(released, { status: 'RELEASED', release_reason: 'provider failure confirmed; card sync found no successful purchase' });
    const [[closed]] = await pool.query('SELECT status FROM operator_alerts WHERE dedupe_key = ?', [`api-order-failed:${declined.orderId}`]);
    assert.equal(closed.status, 'RESOLVED', 'the automatic release closes the 充值失败 alert too');
    assert.equal((await listRow(pool, declined.publicNo)).bucket, 'failed');
    const [[untouched]] = await pool.query('SELECT status FROM operator_alerts WHERE dedupe_key = ?', [`api-order-failed:${charged.orderId}`]);
    assert.equal(untouched.status, 'OPEN', 'only the released order\'s alert is closed');
  } finally { await pool.end(); }
});

