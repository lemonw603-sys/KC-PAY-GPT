import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { encryptSecret } from '../src/security/secret-box.js';
import { createCardStockService } from '../src/services/card-stock-service.js';
import { createCardRetirementService } from '../src/services/card-retirement-service.js';

// D-405（2026-09-28）：卡片列表「暂不可用」的具体原因、待销清单「卡台上」——在真 MySQL 上跑一遍，
// 确认逐条检查的 SQL（chk_* 列）和分卡资格同一份规则：可分配 ⇔ 每条都过。
// 用法：v1/scripts/mysql-tests.sh test/card-reasons-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';
const HNSKJ = '00000000-0000-4000-8000-000000000101';
const MANUAL = '00000000-0000-4000-8000-000000000103';
const key = Buffer.alloc(32, 7);
const creds = () => encryptSecret(JSON.stringify({ cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123' }), key);

async function card(pool, { account = HNSKJ, status = 'active', inventory = 'AVAILABLE', balance = '16.000000', funded = '16.000000',
  txSyncMinutesAgo = 1, syncTier = 'ACTIVE_WATCH', sourcePresent = 1, sourceStatus = null, syncedMinutesAgo = 1, createdHoursAgo = 1 } = {}) {
  const cardId = crypto.randomUUID();
  const ext = `reason-${cardId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO cards (id, inventory_status, provider_card_id, card_type_id, status, funded_amount, current_balance, currency,
       card_credentials_ciphertext, provider_account_id, external_card_id, last4, intake_status, sync_tier,
       source_present, source_operational_status, last_synced_at, last_successful_sync_at, last_transaction_synced_at, created_at)
     VALUES (?, ?, ?, '708', ?, ?, ?, 'USD', ?, ?, ?, ?, 'ACCEPTED', ?, ?, ?,
       CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE, CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE,
       CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE, CURRENT_TIMESTAMP(3) - INTERVAL ? HOUR)`,
    [cardId, inventory, ext, status, funded, balance, creds(), account, ext, cardId.slice(0, 4), syncTier,
      sourcePresent, sourceStatus, syncedMinutesAgo, syncedMinutesAgo, txSyncMinutesAgo, createdHoursAgo]);
  return ext;
}

test('D-405 card list: each blocked card names its decisive failing check on real MySQL; allocatable ⇔ no reason', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    await pool.query(`INSERT INTO app_settings (setting_key, setting_value) VALUES ('default_minimum_required_card_balance', '16')
      ON DUPLICATE KEY UPDATE setting_value = '16'`);
    const ready = await card(pool);
    const low = await card(pool, { balance: '1.080000' });
    const stale = await card(pool, { txSyncMinutesAgo: 60 });
    const lowAndStale = await card(pool, { balance: '2.000000', txSyncMinutesAgo: 60 });
    const bad = await card(pool, { status: 'invalid' });
    const stock = createCardStockService({ pool, sessionEncryptionKey: key });
    const { cards } = await stock.status();
    const by = (ext) => cards.find((c) => c.providerCardId === ext);
    assert.equal(by(ready).isAllocatable, true);
    assert.equal(by(ready).blockedReason, null);
    assert.equal(by(low).blockedReason, '余额 $1.08，不够 $16');
    assert.equal(by(low).category, 'BLOCKED');
    assert.equal(by(stale).blockedReason, '流水 15 分钟内没同步（有单时会自动同步）');
    assert.equal(by(lowAndStale).blockedReason, '余额 $2.00，不够 $16', '余额比同步更决定性');
    assert.ok(by(bad).blockedReason, 'provider-invalid card has a reason');
    for (const c of cards.filter((x) => x.providerCardId?.startsWith('reason-'))) {
      assert.equal(c.isAllocatable, c.blockedReason == null, `${c.providerCardId}: allocatable must equal "every check passed"`);
    }
  } finally { await pool.end(); }
});

test('D-405 retirement list: 「卡台上」 from real rows — there / void / gone, login expired → unknown', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  try {
    const manual = { account: MANUAL, syncTier: 'MANUAL_IMPORT', inventory: 'DEPLETED', createdHoursAgo: 30, syncedMinutesAgo: 3000 };
    const there = await card(pool, { ...manual, sourcePresent: 1, sourceStatus: 'ACTIVE' });
    const voided = await card(pool, { ...manual, sourcePresent: 1, sourceStatus: 'CARD_NOT_ACTIVE' });
    const gone = await card(pool, { ...manual, sourcePresent: 0, sourceStatus: 'MISSING_FROM_SNAPSHOT' });
    const hnVoid = await card(pool, { inventory: 'FAILED', status: 'invalid', createdHoursAgo: 30 });
    // 卡上同步时间已两天前（快照没变化不刷），但钱包快照 5 分钟前刚写过 → 算核对过
    await pool.query(`INSERT INTO provider_balance_snapshots (provider_account_id, currency, available_balance, observed_at)
      VALUES (?, 'USD', 20.26, CURRENT_TIMESTAMP(3) - INTERVAL 5 MINUTE)`, [MANUAL]);
    const retirement = createCardRetirementService({ pool });
    const state = async () => {
      const { due } = await retirement.list();
      return Object.fromEntries(due.map((d) => [d.providerCardId, d.platform.state]));
    };
    const first = await state();
    assert.equal(first[there], 'THERE');
    assert.equal(first[voided], 'VOID');
    assert.equal(first[gone], 'GONE');
    assert.equal(first[hnVoid], 'VOID');
    await pool.query(`INSERT INTO operator_alerts (id, alert_type, dedupe_key, severity, title, message, status)
      VALUES (?, 'PROVIDER_TOKEN_EXPIRED', ?, 'warning', 't', 'm', 'OPEN')`, [crypto.randomUUID(), `provider-token-expired:${MANUAL}`]);
    const second = await state();
    assert.equal(second[there], 'UNKNOWN');
    assert.equal(second[voided], 'UNKNOWN', 'login expired: last snapshot may be outdated');
    assert.equal(second[hnVoid], 'VOID', 'other provider unaffected');
  } finally { await pool.end(); }
});
