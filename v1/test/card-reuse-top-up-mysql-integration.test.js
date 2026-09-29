import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createOrderFromCdk } from '../src/db/repositories/order-intake-repository.js';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { createRechargeAttemptRepository } from '../src/db/repositories/recharge-attempt-repository.js';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';
import { markSending } from '../src/db/repositories/card-top-up-repository.js';
import { recordProviderCall } from '../src/providers/provider-call-recorder.js';
import { encryptSecret } from '../src/security/secret-box.js';
import { createWorkflowHandlers } from '../src/workers/workflow-handlers.js';
import { runWorkerIteration } from '../src/workers/worker-runtime.js';
import { createCardTopUpService, TopUpRetry, TOP_UP_ARRIVAL_WINDOW_MS } from '../src/services/card-top-up-service.js';
import { recordProviderBalanceSnapshot } from '../src/services/provider-balance-snapshot-service.js';
import { countEligibleCards } from '../src/services/card-source-selection-service.js';
import { reusableTopUpCardSql, ledgerSpendSql } from '../src/services/card-inventory-eligibility.js';
import { sessionFixture } from '../test-support/session-fixture.js';
import { zipSync, strToU8 } from 'fflate';
import { createManualCardImportService } from '../src/services/manual-card-import-service.js';

// D-411 一卡三单、按单补钱，在真实 MySQL（跑完全部迁移的隔离库）上验。
// 用法：v1/scripts/mysql-tests.sh test/card-reuse-top-up-mysql-integration.test.js
// 卡台（highvcc）和直充平台（ZZSHU）是假的；订单、任务循环、分卡、账本、付款前检查全是真的。
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';

const BACKUP_A = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';
const ROUTE_API = '00000000-0000-4000-8000-000000000301';
const KEY = Buffer.alloc(32, 7);
const id = () => crypto.randomUUID();

const headers = ['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
function workbook(rows) {
  const table = [['title', ...Array(16).fill('')], headers, ...rows]; const strings = table.flat();
  const shared = `<sst>${strings.map((value) => `<si><t>${String(value)}</t></si>`).join('')}</sst>`;
  let cursor = 0;
  const sheet = `<worksheet><sheetData>${table.map((row, ri) => `<row r="${ri + 1}">${row.map((_, ci) => {
    let n=ci+1,col=''; while(n){n--;col=String.fromCharCode(65+n%26)+col;n=Math.floor(n/26);} return `<c r="${col}${ri+1}" t="s"><v>${cursor++}</v></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return Buffer.from(zipSync({ 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
}
const sheetCard = (sequence, pan, balance) => [sequence,balance,'0',balance,pan,'123','12/29','已激活','x','Test','User','DE','Wilmington','1 Main St','19801','',''];

async function setSettings(pool, pairs) {
  for (const [key, value] of Object.entries(pairs)) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [key, value]);
  }
}

async function insertCard(pool, { providerAccountId, balance = '16.000000', funded = '16', last4 = '4022', inventory = 'AVAILABLE' }) {
  const cardId = id();
  await pool.query(
    `INSERT INTO cards
     (id, inventory_status, provider_card_id, card_type_id, last4, status, funded_amount, current_balance,
      currency, refund_status, card_credentials_ciphertext, provider_account_id, external_card_id, intake_status,
      sync_tier, source_present, last_synced_at)
     VALUES (?, ?, ?, '708', ?, 'active', ?, ?, 'USD', 'MONITORING', ?, ?, ?, 'ACCEPTED', 'MANUAL_IMPORT', 1, CURRENT_TIMESTAMP(3))`,
    [cardId, inventory, `hv-${cardId.slice(0, 8)}`, last4, funded, balance,
      encryptSecret(JSON.stringify({ cardNumber: `51398996000${last4.padStart(5, '0')}`, expMonth: 12, expYear: 2032, cvv: '123' }), KEY),
      providerAccountId, `ext-${cardId}`]);
  return cardId;
}

/** 一个能补钱的卡台（highvcc 适配器 + 能力位 + 押金 $20），和一条钱包快照。每个分支测试用自己的，互不串卡。 */
async function topUpAccount(pool, { wallet = '60' } = {}) {
  const account = id();
  await pool.query(
    `INSERT INTO provider_accounts
     (id, provider_code, account_code, display_name, environment, purpose, source_adapter, open_adapter,
      supports_api_recharge, supports_browser_recharge, supports_auto_funding, wallet_floor,
      operational_enabled, read_enabled, write_enabled, max_concurrency)
     VALUES (?, 'manual_excel', ?, 'TopUpIT', 'PRODUCTION', 'CARD', 'backup_card_export_v1', 'highvcc_api_v1',
       1, 1, 1, 20, 1, 0, 0, 1)`, [account, `topup-it-${account.slice(0, 8)}`]);
  await recordProviderBalanceSnapshot(pool, { providerAccountId: account, currency: 'USD', availableBalance: wallet, observedAt: new Date() });
  return account;
}

async function insertOrder(pool, { frozen, status = 'CREATED', assignedCardId = null }) {
  const cdkId = id(); const orderId = id();
  await pool.query(`INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
    [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, card_type_id, open_card_amount, minimum_required_card_balance,
      session_ciphertext, card_purchase_idempotency_key, product_id, fulfillment_route_id,
      frozen_card_provider_account_id, route_resolution_status, assigned_card_id)
     VALUES (?, ?, ?, ?, '708', '16.000000', '16.000000', ?, ?, ?, ?, ?, 'RESOLVED', ?)`,
    [orderId, `PJV1-tu-${orderId.slice(0, 8)}`, cdkId, status,
      encryptSecret(JSON.stringify(sessionFixture()), KEY), `purchase-${orderId}`, PLUS, ROUTE_API, frozen, assignedCardId]);
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  return orderId;
}

/** 一张「已经成功付过一单」的卡：与付款成功落账后同一形态（workflow-repository commitRechargeSuccess：账本 CONSUMED、卡 DEPLETED、余额清空）。 */
async function usedCard(pool, account, { last4 = '4022', uses = 1 } = {}) {
  const cardId = await insertCard(pool, { providerAccountId: account, balance: '0.000000', last4 });
  for (let i = 0; i < uses; i += 1) {
    const orderId = await insertOrder(pool, { frozen: account, status: 'RECHARGE_SUCCESS', assignedCardId: cardId });
    await pool.query(
      `INSERT INTO card_consumption_ledger (id, card_id, order_id, product_id, status, amount, currency, reserved_at, consumed_at)
       VALUES (?, ?, ?, ?, 'CONSUMED', '16.000000', 'USD', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [id(), cardId, orderId, PLUS]);
  }
  await pool.query(`UPDATE cards SET inventory_status = 'DEPLETED', current_balance = NULL WHERE id = ?`, [cardId]);
  return cardId;
}

/** 假 highvcc：钱包、卡详情、补钱、账户流水。补钱后卡详情要再读 arriveAfterReads 次才看到钱（实测 10～17 秒到账）。 */
function fakeHighvcc({ walletCents = 6000, cards = {}, arriveAfterReads = 1, recharge = null, flow = [] } = {}) {
  const calls = { recharge: [], detail: 0, flow: 0 };
  const pending = new Map();
  return {
    calls, cards,
    async wallet() { return { usdBalanceCents: walletCents }; },
    async detail(cardId) {
      calls.detail += 1;
      const card = cards[cardId];
      const waiting = pending.get(cardId);
      if (waiting) {
        if (waiting.reads <= 0) { card.balance += waiting.amount; pending.delete(cardId); } else waiting.reads -= 1;
      }
      return { card: { balance: card.balance, lastFour: card.lastFour } };
    },
    async recharge({ cardId, amountCents }) {
      calls.recharge.push({ cardId, amountCents });
      if (recharge) return recharge({ cardId, amountCents });
      walletCents -= amountCents;
      pending.set(cardId, { amount: amountCents, reads: arriveAfterReads });
      return { code: 200, msg: '充值提交成功,请稍后查询余额', data: 17 };
    },
    async accountFlow() { calls.flow += 1; return typeof flow === 'function' ? flow() : flow; }
  };
}

async function cardRow(pool, cardId) {
  const [[row]] = await pool.query(
    `SELECT inventory_status, funded_amount, current_balance, order_id FROM cards WHERE id = ?`, [cardId]);
  return row;
}
async function topUpRow(pool, orderId) {
  const [[row]] = await pool.query(
    `SELECT id, status, amount, balance_before, balance_after, error_code, order_detached
       FROM card_top_ups WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`, [orderId]);
  return row || null;
}
async function orderRow(pool, orderId) {
  const [[row]] = await pool.query('SELECT status, assigned_card_id FROM orders WHERE id = ?', [orderId]);
  return row;
}
async function reusableCount(pool, cardId) {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM cards c WHERE c.id = ? AND ${reusableTopUpCardSql('c')}`, [cardId]);
  return Number(row.n);
}

// ─────────────────────────────────────────────────────────────────────────────
// 全链路：同一张卡在真实任务循环里服务三单——API 路线两单（第 2 单补钱），切到 Browser 再一单（第 3 单补钱）。
// ─────────────────────────────────────────────────────────────────────────────
test('D-411 end to end: one card serves three Plus orders across both routes; orders 2 and 3 top up $16 once each before payment', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, {
      accept_new_orders: 'true', default_card_type_id: '708', default_open_card_amount: '16',
      default_minimum_required_card_balance: '16.00', worker_heartbeat_at: new Date().toISOString(),
      zzshu_points_remaining: '5', card_auto_replenishment_enabled: 'true',
      dispatch_new_recharges: 'true', recharge_dispatch_mode: 'AUTOMATIC', browser_dispatch_enabled: 'false'
    });
    await pool.query(`UPDATE fulfillment_routes SET accepts_new_orders = (executor_kind = 'API') WHERE product_id = ?`, [PLUS]);
    await pool.query(`UPDATE card_source_selections SET provider_account_id = ? WHERE product_id = ? AND executor_kind = 'API'`, [BACKUP_A, PLUS]);
    await pool.query(`UPDATE provider_accounts pa INNER JOIN fulfillment_routes fr ON fr.recharge_provider_account_id = pa.id
      SET pa.write_enabled = 1 WHERE fr.id = ?`, [ROUTE_API]);
    await recordProviderBalanceSnapshot(pool, { providerAccountId: BACKUP_A, currency: 'USD', availableBalance: '100', observedAt: new Date() });
    const cardId = await insertCard(pool, { providerAccountId: BACKUP_A, last4: '4022' });
    const [[{ provider_card_id: providerCardId }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardId]);

    const highvcc = fakeHighvcc({ walletCents: 10_000, cards: { [providerCardId]: { balance: 0, lastFour: '4022' } }, arriveAfterReads: 2 });
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    const cardTopUp = createCardTopUpService({ pool, workflow, provider: highvcc });
    let direct = 0;
    const handlers = createWorkflowHandlers({
      workflow,
      cardProvider: { card: async () => { throw new Error('backup-a has no card API'); } },
      rechargeProvider: {
        createDirectOrder: async () => { direct += 1; return { orderNo: `zz-${direct}`, cardKey: `DIRECT-${direct}` }; },
        queryStatus: async () => ({ status: 'success', isSubscriptionCancelled: 1 }),
        queryStatusWithSession: async () => ({ status: 'success', isSubscriptionCancelled: 1, latestSession: sessionFixture() })
      },
      recordCall: (input) => recordProviderCall({ pool, ...input }),
      mapCardProvisioning: () => ({ state: 'ready' }),
      mapCardCredentials: () => null,
      buildDirectOrderRequest: (input) => ({ method: 'POST', path: '/third-party/orders/direct', body: { ...input } }),
      rechargeAttemptRepository: createRechargeAttemptRepository(pool),
      browserDispatchRepository: createBrowserDispatchRepository(pool),
      cardTopUp,
      wait: async () => {}
    });
    // 跑任务循环直到订单到达目标状态；每轮把待跑任务的时间拨到现在（补钱查询 3 秒一次、轮询 5 秒一次，不真等）。
    const drain = async (orderId, target, max = 40) => {
      const seen = [];
      for (let i = 0; i < max; i += 1) {
        const { status } = await orderRow(pool, orderId);
        if (seen.at(-1) !== status) seen.push(status);
        if (status === target) return seen;
        await pool.query(`UPDATE tasks SET available_at = CURRENT_TIMESTAMP(3) WHERE status = 'PENDING'`);
        const result = await runWorkerIteration({ pool, workerId: 'topup-it', handlers, providerReadsEnabled: true, providerRechargeWritesEnabled: true });
        if (!result.handled) break;
      }
      assert.fail(`order did not reach ${target}; saw ${seen.join(' → ')}`);
    };
    const newOrder = async (n) => {
      const cdkId = id(); const orderId = id();
      await pool.query(`INSERT INTO cdks (id, code_hash, hash_version, status, batch_no, plan_type) VALUES (?, ?, 'test-v2', 'AVAILABLE', ?, 'plus')`,
        [cdkId, crypto.randomBytes(32).toString('hex'), `topup-e2e-${n}`]);
      const [[cdk]] = await pool.query('SELECT code_hash FROM cdks WHERE id = ?', [cdkId]);
      await createOrderFromCdk(pool, { orderId, publicNo: `TOPUP-E2E-${n}-${orderId.slice(0, 6)}`,
        cdkLookup: { current: { version: 'test-v2', hash: cdk.code_hash }, legacy: { version: 'none', hash: '0'.repeat(64) } },
        customerEmail: `topup${n}@example.invalid`, chatgptAccountId: `acct-topup-${n}`,
        sessionCiphertext: encryptSecret(JSON.stringify(sessionFixture()), KEY), cardPurchaseIdempotencyKey: `purchase-${orderId}` });
      return orderId;
    };
    const usable = () => countEligibleCards(pool, { providerAccountId: BACKUP_A, productCode: 'plus' });

    // 第 1 单：开卡的 $16，直接付，不补钱。
    const first = await newOrder(1);
    const seen1 = await drain(first, 'RECHARGE_SUCCESS');
    assert.equal(seen1.includes('CARD_PROVISIONING'), false, `第 1 单直接分卡：${seen1.join(' → ')}`);
    assert.equal(highvcc.calls.recharge.length, 0, '第 1 单不补钱');
    const afterFirst = await cardRow(pool, cardId);
    assert.equal(afterFirst.inventory_status, 'DEPLETED');
    assert.equal(afterFirst.current_balance, null, '付款成功后余额清空、等同步回填——正是这一刻下一单要能用上它');
    assert.equal(await usable(), 1, '用过一次、钱包够补：调度器 / 切换校验数得到这张卡');

    // 第 2 单（API）：分到这张旧卡 → 补钱中 → 到账 → 付款。
    const second = await newOrder(2);
    const seen2 = await drain(second, 'RECHARGE_SUCCESS');
    assert.deepEqual(seen2.slice(0, 3), ['CREATED', 'CARD_PROVISIONING', 'CARD_READY'], `第 2 单经过「正在准备支付卡」：${seen2.join(' → ')}`);
    assert.deepEqual(highvcc.calls.recharge, [{ cardId: providerCardId, amountCents: 1600 }], '补且只补一次 $16');
    const top2 = await topUpRow(pool, second);
    assert.equal(top2.status, 'CONFIRMED');
    assert.equal(top2.balance_before, '0.000000');
    assert.equal(top2.balance_after, '16.000000');
    assert.equal(String((await cardRow(pool, cardId)).funded_amount), '32.000000', '注资记 16 + 16');
    const [[checks]] = await pool.query(`SELECT check_count FROM card_top_ups WHERE id = ?`, [top2.id]);
    assert.ok(Number(checks.check_count) >= 2, '没到账时继续查，读到到账才放行付款');
    const [[{ n: topUpTasks }]] = await pool.query(`SELECT COUNT(*) AS n FROM tasks WHERE order_id = ? AND task_type = 'TOP_UP_CARD'`, [second]);
    assert.equal(Number(topUpTasks), 1);
    assert.equal(await usable(), 1, '两单用完、还剩一单额度：仍算一张能用的卡');

    // 第 3 单（切到 Browser 路线）：同一张卡再补一次，付款前检查放行，交给 Browser 执行器。
    await setSettings(pool, { browser_dispatch_enabled: 'true', browser_worker_heartbeat_at: new Date().toISOString() });
    await pool.query(`UPDATE executor_profiles SET status = 'ACTIVE' WHERE executor_kind = 'BROWSER'`);
    await pool.query(`UPDATE card_source_selections SET provider_account_id = ? WHERE product_id = ? AND executor_kind = 'BROWSER'`, [BACKUP_A, PLUS]);
    await pool.query(`UPDATE fulfillment_routes SET accepts_new_orders = (executor_kind = 'BROWSER') WHERE product_id = ?`, [PLUS]);
    const third = await newOrder(3);
    const seen3 = await drain(third, 'RECHARGE_PROCESSING');
    assert.deepEqual(seen3, ['CREATED', 'CARD_PROVISIONING', 'CARD_READY', 'RECHARGE_PROCESSING']);
    assert.equal(highvcc.calls.recharge.length, 2);
    assert.equal(String((await cardRow(pool, cardId)).funded_amount), '48.000000');
    const [[attempt]] = await pool.query(`SELECT executor_kind FROM recharge_attempts WHERE order_id = ?`, [third]);
    assert.equal(attempt.executor_kind, 'BROWSER');
    const [[job]] = await pool.query(`SELECT COUNT(*) AS n FROM browser_dispatch_jobs WHERE order_id = ?`, [third]);
    assert.equal(Number(job.n), 1, '付款前检查放行，交给 Browser 执行器');
    assert.equal(await usable(), 0, '第 3 单在跑：用满 3 单，不再算能用');
    assert.equal(await reusableCount(pool, cardId), 0, '用满的卡不再补钱');
    const [ledger] = await pool.query(`SELECT status FROM card_consumption_ledger WHERE card_id = ? ORDER BY reserved_at`, [cardId]);
    assert.deepEqual(ledger.map((r) => r.status), ['CONSUMED', 'CONSUMED', 'RESERVED']);
  } finally { await pool.end(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 分支：补钱没成，客户这一单不陪这张卡等。
// ─────────────────────────────────────────────────────────────────────────────
test('D-411 rejected by the platform: money did not move, the order leaves the card and is re-assigned; the card is not reused for 24h and its old reservation never counts as spend', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool);
    const oldCard = await usedCard(pool, account, { last4: '1111' });
    const [[{ provider_card_id: oldPc }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [oldCard]);
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    const orderId = await insertOrder(pool, { frozen: account });
    const claimed = await workflow.assignAvailableCard(orderId);
    assert.equal(claimed.topUpQueued, true);
    assert.deepEqual(await orderRow(pool, orderId), { status: 'CARD_PROVISIONING', assigned_card_id: oldCard });

    const rejectError = Object.assign(new Error('卡台拒绝'), { code: 'HIGHVCC_API_ERROR', providerMessage: '余额不足' });
    const highvcc = fakeHighvcc({ cards: { [oldPc]: { balance: 0, lastFour: '1111' } }, recharge: async () => { throw rejectError; } });
    const service = createCardTopUpService({ pool, workflow, provider: highvcc });
    assert.deepEqual(await service.send(orderId), { action: 'REJECTED', code: 'HIGHVCC_API_ERROR' });
    assert.equal((await topUpRow(pool, orderId)).status, 'REJECTED');
    assert.deepEqual(await orderRow(pool, orderId), { status: 'WAITING_FOR_CARD', assigned_card_id: null });
    const [[ledger]] = await pool.query(`SELECT status FROM card_consumption_ledger WHERE card_id = ? AND order_id = ?`, [oldCard, orderId]);
    assert.equal(ledger.status, 'RELEASED');
    const [[assign]] = await pool.query(`SELECT status FROM tasks WHERE order_id = ? AND task_type = 'ASSIGN_CARD'`, [orderId]);
    assert.equal(assign.status, 'PENDING', '重排分卡');
    const [[alert]] = await pool.query(`SELECT COUNT(*) AS n FROM operator_alerts WHERE alert_type = 'CARD_TOP_UP_UNRESOLVED' AND order_id = ?`, [orderId]);
    assert.equal(Number(alert.n), 0, '钱没动不叫人');
    assert.equal(await reusableCount(pool, oldCard), 0, '24 小时内被拒过的卡先不补');

    // 有一张现成的新卡：这一单换到它上面付款。
    const freshCard = await insertCard(pool, { providerAccountId: account, last4: '2222' });
    const again = await workflow.assignAvailableCard(orderId);
    assert.equal(again.topUpQueued, undefined);
    assert.deepEqual(await orderRow(pool, orderId), { status: 'CARD_READY', assigned_card_id: freshCard });

    // 这一单在新卡上成功后，旧卡上那条 RELEASED 不能算旧卡花了钱（ledgerSpendSql 的 D-411 条件）。
    await pool.query(`UPDATE orders SET status = 'RECHARGE_SUCCESS' WHERE id = ?`, [orderId]);
    const [[spend]] = await pool.query(`SELECT ${ledgerSpendSql('c')} AS spent FROM cards c WHERE c.id = ?`, [oldCard]);
    assert.equal(String(spend.spent), '16.000000', '旧卡只算第 1 单的 $16');
  } finally { await pool.end(); }
});

test('D-411 wallet too low at send time, or the auto-supply switch turned off after assignment: nothing is sent, the order is re-assigned', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool);
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });

    const cardA = await usedCard(pool, account, { last4: '3333' });
    const [[{ provider_card_id: pcA }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardA]);
    const orderA = await insertOrder(pool, { frozen: account });
    assert.equal((await workflow.assignAvailableCard(orderA)).topUpQueued, true);
    // 钱包 $50 本来够（50 − 16 = 34），但已排队一张没开出来的卡（预计 $16.50）：50 − 16.5 − 16 = 17.5 < 20。
    const jobId = id();
    await pool.query(`INSERT INTO card_stock_jobs (id, status, job_source, provider_account_id, product_code, card_type_id, amount, estimated_total, requested_count)
      VALUES (?, 'PENDING', 'AUTOMATIC', ?, 'plus', '708', '16', '16.5', 1)`, [jobId, account]);
    const midOpen = fakeHighvcc({ walletCents: 5000, cards: { [pcA]: { balance: 0, lastFour: '3333' } } });
    assert.deepEqual(await createCardTopUpService({ pool, workflow, provider: midOpen }).send(orderA), { action: 'REJECTED', code: 'WALLET_LOW' });
    assert.equal(midOpen.calls.recharge.length, 0, '开卡在途时不补');
    await pool.query(`UPDATE card_stock_jobs SET status = 'SUCCEEDED' WHERE id = ?`, [jobId]);
    // 实时钱包 $30：30 − 16 = 14 < 押金 20。
    assert.equal((await orderRow(pool, orderA)).status, 'WAITING_FOR_CARD');
    const cardA2 = await usedCard(pool, account, { last4: '3335' });
    const [[{ provider_card_id: pcA2 }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardA2]);
    assert.equal((await workflow.assignAvailableCard(orderA)).topUpQueued, true);
    const poor = fakeHighvcc({ walletCents: 3000, cards: { [pcA2]: { balance: 0, lastFour: '3335' } } });
    assert.deepEqual(await createCardTopUpService({ pool, workflow, provider: poor }).send(orderA), { action: 'REJECTED', code: 'WALLET_LOW' });
    assert.equal(poor.calls.recharge.length, 0);
    assert.equal((await orderRow(pool, orderA)).status, 'WAITING_FOR_CARD');
    // 发之前实时读到的钱包记成了最新快照：钱包不够时，其它旧卡也立刻不算能补（调度器随之按缺口开新卡或叫人）。
    await usedCard(pool, account, { last4: '3334' });
    assert.equal(await countEligibleCards(pool, { providerAccountId: account, productCode: 'plus' }), 0);
    await recordProviderBalanceSnapshot(pool, { providerAccountId: account, currency: 'USD', availableBalance: '60', observedAt: new Date() });

    // 总闸：分卡后被关 → 不发；关着时旧卡既不算能用、也分不到。
    const cardB = await usedCard(pool, account, { last4: '4444' });
    const [[{ provider_card_id: pcB }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardB]);
    const orderB = await insertOrder(pool, { frozen: account });
    assert.equal((await workflow.assignAvailableCard(orderB)).topUpQueued, true);
    assert.equal((await topUpRow(pool, orderB)).status, 'PREPARED');
    await setSettings(pool, { card_auto_replenishment_enabled: 'false' });
    const rich = fakeHighvcc({ cards: { [pcB]: { balance: 0, lastFour: '4444' } } });
    assert.deepEqual(await createCardTopUpService({ pool, workflow, provider: rich }).send(orderB), { action: 'REJECTED', code: 'AUTO_SUPPLY_OFF' });
    assert.equal(rich.calls.recharge.length, 0);
    const cardC = await usedCard(pool, account, { last4: '5555' });
    assert.equal(await reusableCount(pool, cardC), 0, '总闸关着：旧卡不算能补');
    assert.equal(await countEligibleCards(pool, { providerAccountId: account, productCode: 'plus' }), 0);
    const orderC = await insertOrder(pool, { frozen: account });
    const waiting = await workflow.assignAvailableCard(orderC);
    assert.equal(waiting.topUpQueued, undefined);
    assert.equal((await orderRow(pool, orderC)).status, 'WAITING_FOR_CARD');
    await setSettings(pool, { card_auto_replenishment_enabled: 'true' });
    assert.equal(await countEligibleCards(pool, { providerAccountId: account, productCode: 'plus' }), 2, '总闸打开后 3334、5555 又算能用（3333、3335、4444 被拒过，24 小时内不算）');
  } finally { await pool.end(); }
});

test('D-411 wallet covers one top-up but not two: the second order does not get a reusable card while the first top-up is still pending', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool, { wallet: '40' });   // 40 − 16 = 24 ≥ 20；再减 16 = 8 < 20
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    await usedCard(pool, account, { last4: '6601' });
    await usedCard(pool, account, { last4: '6602' });
    const first = await insertOrder(pool, { frozen: account });
    const second = await insertOrder(pool, { frozen: account });
    assert.equal((await workflow.assignAvailableCard(first)).topUpQueued, true);
    const next = await workflow.assignAvailableCard(second);
    assert.equal(next.topUpQueued, undefined, '待发的那 $16 先从钱包里扣掉再判');
    assert.equal((await orderRow(pool, second)).status, 'WAITING_FOR_CARD');
  } finally { await pool.end(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 分支：结果不明——绝不重发；卡锁住，订单换卡；之后按卡详情 / 账户流水了结。
// ─────────────────────────────────────────────────────────────────────────────
test('D-411 send interrupted (SENDING on rerun): never re-sent; the order leaves; the card stays locked until the flow shows nothing went out', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool);
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    const cardId = await usedCard(pool, account, { last4: '7701' });
    const [[{ provider_card_id: pc }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardId]);
    const orderId = await insertOrder(pool, { frozen: account });
    await workflow.assignAvailableCard(orderId);
    const topUp = await topUpRow(pool, orderId);
    // 上一次 worker 已经把它改成 SENDING，然后死了（发没发出去不知道）。
    assert.equal(await markSending(pool, topUp.id, { balanceBefore: '0' }), true);

    let clock = Date.now();
    const highvcc = fakeHighvcc({ cards: { [pc]: { balance: 0, lastFour: '7701' } }, flow: [] });
    const service = createCardTopUpService({ pool, workflow, provider: highvcc, now: () => clock });
    assert.deepEqual(await service.send(orderId), { action: 'UNKNOWN', code: 'SEND_INTERRUPTED' });
    assert.equal(highvcc.calls.recharge.length, 0, '发送中断的补钱绝不重发');
    assert.deepEqual(await orderRow(pool, orderId), { status: 'WAITING_FOR_CARD', assigned_card_id: null });
    assert.equal((await topUpRow(pool, orderId)).status, 'UNKNOWN');
    assert.equal((await cardRow(pool, cardId)).inventory_status, 'DEPLETED', '放卡：余额未知的卡回到「用过」，不是「可用」');
    assert.equal(await reusableCount(pool, cardId), 0, '结果不明的卡锁住，不分给任何单');
    const [[check]] = await pool.query(`SELECT status FROM tasks WHERE dedupe_key = ?`, [`check-top-up:${topUp.id}`]);
    assert.equal(check.status, 'PENDING');

    await assert.rejects(service.check(orderId), TopUpRetry, '3 分钟内只看余额');
    clock += TOP_UP_ARRIVAL_WINDOW_MS + 1_000;
    // 3 分钟后：卡余额没变、账户流水里也没有这张卡的补钱 → 证实没发出去，了结为 REJECTED，卡解锁。
    assert.deepEqual(await service.check(orderId), { action: 'REJECTED', code: 'NOT_SENT_PER_FLOW' });
    assert.equal(highvcc.calls.flow, 1);
    assert.equal((await topUpRow(pool, orderId)).status, 'REJECTED');
    const [[alerts]] = await pool.query(`SELECT COUNT(*) AS n FROM operator_alerts WHERE alert_type = 'CARD_TOP_UP_UNRESOLVED' AND order_id = ?`, [orderId]);
    assert.equal(Number(alerts.n), 0);
  } finally { await pool.end(); }
});

test('D-411 accepted but not arrived after 3 minutes: order leaves, one alert; when the money shows up later the card is credited once and the alert closes', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool);
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    const cardId = await usedCard(pool, account, { last4: '8801' });
    const [[{ provider_card_id: pc }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardId]);
    const orderId = await insertOrder(pool, { frozen: account });
    await workflow.assignAvailableCard(orderId);
    let clock = Date.now();
    const highvcc = fakeHighvcc({ cards: { [pc]: { balance: 0, lastFour: '8801' } }, arriveAfterReads: 1_000 });
    const service = createCardTopUpService({ pool, workflow, provider: highvcc, now: () => clock });
    assert.deepEqual(await service.send(orderId), { action: 'SUBMITTED' });
    const topUp = await topUpRow(pool, orderId);
    assert.equal(topUp.status, 'SUBMITTED');
    assert.equal((await orderRow(pool, orderId)).status, 'CARD_PROVISIONING', '受理后 3 分钟内订单陪着等');

    clock += TOP_UP_ARRIVAL_WINDOW_MS + 1_000;
    await assert.rejects(service.check(orderId), (e) => e instanceof TopUpRetry && e.code === 'TOP_UP_NOT_ARRIVED');
    assert.deepEqual(await orderRow(pool, orderId), { status: 'WAITING_FOR_CARD', assigned_card_id: null });
    const alertRows = async () => (await pool.query(
      `SELECT status, severity, incident_version FROM operator_alerts WHERE dedupe_key = ?`, [`card-top-up:${topUp.id}`]))[0];
    assert.deepEqual((await alertRows()).map((a) => [a.status, a.severity]), [['OPEN', 'critical']]);
    // 之后每次慢查都不重开告警（同一件事只推一条，D-407）。
    await assert.rejects(service.check(orderId), TopUpRetry);
    await assert.rejects(service.check(orderId), TopUpRetry);
    assert.equal(Number((await alertRows())[0].incident_version || 1), 1);

    // 钱终于到了：卡注资 +16 一次，卡恢复可用，告警关掉；订单早已换卡，不动它。
    highvcc.cards[pc].balance = 1600;
    assert.equal((await service.check(orderId)).action, 'CONFIRMED');
    const card = await cardRow(pool, cardId);
    assert.deepEqual([card.inventory_status, String(card.funded_amount), String(card.current_balance)], ['AVAILABLE', '32.000000', '16.000000']);
    assert.equal((await alertRows())[0].status, 'RESOLVED');
    assert.equal((await orderRow(pool, orderId)).status, 'WAITING_FOR_CARD');
    // 这张卡现在余额 $16、账本 32 − 16 = 16：下一单直接分到它，不用再补。
    const next = await insertOrder(pool, { frozen: account });
    const got = await workflow.assignAvailableCard(next);
    assert.equal(got.topUpQueued, undefined);
    assert.deepEqual(await orderRow(pool, next), { status: 'CARD_READY', assigned_card_id: cardId });
  } finally { await pool.end(); }
});

test('D-411 a card snapshot import during an open top-up does not record the same money a second time', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool);
    const importer = createManualCardImportService({ pool, encryptionKey: KEY, panHmacKey: Buffer.alloc(32, 4) });
    const pan = '5' + Array.from({ length: 15 }, () => crypto.randomInt(0, 10)).join('');
    const sequence = `seq-${id().slice(0, 8)}`;
    let snapshotNo = 0;
    const snapshot = async (balance) => {
      // 每次快照文件都不同（导入按文件哈希判重，同一份文件第二次只回放、不更新）。
      snapshotNo += 1;
      const row = sheetCard(sequence, pan, balance); row[15] = `snap-${snapshotNo}`;
      const bytes = workbook([row]);
      const preview = await importer.preview({ providerAccountId: account, fileBase64: bytes.toString('base64') });
      await importer.commit({ providerAccountId: account, fileBase64: bytes.toString('base64'), confirmation: preview.confirmation, filename: `snap-${balance}.xlsx` });
    };
    await snapshot('16.00');
    const [[card]] = await pool.query('SELECT id, provider_card_id, last4 FROM cards WHERE provider_account_id = ?', [account]);
    // 第 1 单付过：与付款成功落账同一形态。
    const paid = await insertOrder(pool, { frozen: account, status: 'RECHARGE_SUCCESS', assignedCardId: card.id });
    await pool.query(
      `INSERT INTO card_consumption_ledger (id, card_id, order_id, product_id, status, amount, currency, reserved_at, consumed_at)
       VALUES (?, ?, ?, ?, 'CONSUMED', '16.000000', 'USD', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`, [id(), card.id, paid, PLUS]);
    await pool.query(`UPDATE cards SET inventory_status = 'DEPLETED', current_balance = NULL WHERE id = ?`, [card.id]);
    await snapshot('0.00');

    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    const orderId = await insertOrder(pool, { frozen: account });
    assert.equal((await workflow.assignAvailableCard(orderId)).topUpQueued, true);
    // 补钱请求超时（结果不明）：订单换卡走、卡放回；卡台其实收到了，钱随后到了卡上。
    const highvcc = fakeHighvcc({ cards: { [card.provider_card_id]: { balance: 0, lastFour: card.last4 } },
      recharge: async () => { throw Object.assign(new Error('timeout'), { code: 'HIGHVCC_TIMEOUT' }); } });
    const service = createCardTopUpService({ pool, workflow, provider: highvcc });
    assert.deepEqual(await service.send(orderId), { action: 'UNKNOWN', code: 'HIGHVCC_TIMEOUT' });
    assert.notEqual((await cardRow(pool, card.id)).inventory_status, 'ASSIGNED', '卡已放回——快照导入会更新它');
    highvcc.cards[card.provider_card_id].balance = 1600;
    // 系统还没核对到时的快照看到余额从 0 涨到 16：这是那笔补钱，不能再记成「有人补钱」。
    await snapshot('16.00');
    assert.equal(String((await cardRow(pool, card.id)).current_balance), '16.000000', '快照确实更新了这张卡');
    const funded = async () => String((await cardRow(pool, card.id)).funded_amount);
    assert.equal(await funded(), '16.000000');
    assert.equal((await service.check(orderId)).action, 'CONFIRMED');
    assert.equal(await funded(), '32.000000', '只由补钱核对记一次');
    await snapshot('16.00');
    assert.equal(await funded(), '32.000000');
    const [events] = await pool.query(`SELECT event_type FROM card_state_events WHERE card_id = ? AND event_type LIKE 'CARD_TOPUP_%'`, [card.id]);
    assert.deepEqual(events.map((e) => e.event_type), ['CARD_TOPUP_CONFIRMED']);
  } finally { await pool.end(); }
});

test('D-411 recharge timed out (no answer): UNKNOWN, never re-sent; after 3 minutes the account flow shows the top-up went out, so a person is called once; arrival later settles it', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await setSettings(pool, { card_auto_replenishment_enabled: 'true', default_open_card_amount: '16' });
    const account = await topUpAccount(pool);
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: KEY });
    const cardId = await usedCard(pool, account, { last4: '7702' });
    const [[{ provider_card_id: pc }]] = await pool.query('SELECT provider_card_id FROM cards WHERE id = ?', [cardId]);
    const orderId = await insertOrder(pool, { frozen: account });
    await workflow.assignAvailableCard(orderId);
    let clock = Date.now();
    const initiated = new Date(clock + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
    const highvcc = fakeHighvcc({
      cards: { [pc]: { balance: 0, lastFour: '7702' } },
      recharge: async () => { throw Object.assign(new Error('timeout'), { code: 'HIGHVCC_TIMEOUT' }); },
      flow: [{ cardSeqNo: pc, tradeDesc: 'Add Balance To Card', initiated }]
    });
    const service = createCardTopUpService({ pool, workflow, provider: highvcc, now: () => clock });
    assert.deepEqual(await service.send(orderId), { action: 'UNKNOWN', code: 'HIGHVCC_TIMEOUT' });
    assert.deepEqual(await service.send(orderId), { action: 'NONE' }, '再跑一次也不会再发');
    assert.equal(highvcc.calls.recharge.length, 1);
    assert.deepEqual(await orderRow(pool, orderId), { status: 'WAITING_FOR_CARD', assigned_card_id: null });

    clock += TOP_UP_ARRIVAL_WINDOW_MS + 1_000;
    await assert.rejects(service.check(orderId), (e) => e instanceof TopUpRetry && e.code === 'TOP_UP_UNRESOLVED');
    const topUp = await topUpRow(pool, orderId);
    const [[alert]] = await pool.query(`SELECT status, severity, title FROM operator_alerts WHERE dedupe_key = ?`, [`card-top-up:${topUp.id}`]);
    assert.deepEqual([alert.status, alert.severity], ['OPEN', 'critical']);
    assert.match(alert.title, /补钱结果不明：卡 7702/);
    await assert.rejects(service.check(orderId), TopUpRetry);
    assert.equal(highvcc.calls.flow, 1, '叫过人之后只看余额，不再翻流水、不再重开告警');

    highvcc.cards[pc].balance = 1600;
    assert.equal((await service.check(orderId)).action, 'CONFIRMED');
    assert.equal(String((await cardRow(pool, cardId)).funded_amount), '32.000000');
    const [[closed]] = await pool.query(`SELECT status FROM operator_alerts WHERE dedupe_key = ?`, [`card-top-up:${topUp.id}`]);
    assert.equal(closed.status, 'RESOLVED');
  } finally { await pool.end(); }
});
