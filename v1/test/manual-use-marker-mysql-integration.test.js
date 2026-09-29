import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createCardRetirementService } from '../src/services/card-retirement-service.js';
import { createCardOperationalOverrideService } from '../src/services/card-operational-override-service.js';
import { createDailyReconciliationService } from '../src/services/daily-reconciliation-service.js';

// 欠账 36（D-412 补记三）：后台「已销卡」和「停用」都会整句覆盖停用原因。手动用过的卡被覆盖后，
// 日对账不能把它的历史扣款改判成「无主扣款」；没登记过手动用卡的卡也不能凭空被认成手动用卡。
// 用法：v1/scripts/mysql-tests.sh test/manual-use-marker-mysql-integration.test.js
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL 未配置；用 v1/scripts/mysql-tests.sh 在隔离库上跑';
const HV = '00000000-0000-4000-8000-000000000103';

/** 一张 highvcc 卡：卡台 1 笔已清算扣款、账本 0 行（卡台多出一笔），停用原因由调用方给。 */
async function cardWithExtraCharge(pool, last4, reason) {
  const cardId = crypto.randomUUID();
  const ext = `mu-${cardId}`;
  await pool.query(`INSERT INTO cards (id, provider_account_id, provider_card_id, external_card_id, card_type_id, status, intake_status,
      inventory_status, sync_tier, currency, funded_amount, current_balance, last4, source_present)
    VALUES (?, ?, ?, ?, '23', 'active', 'ACCEPTED', 'AVAILABLE', 'MANUAL_IMPORT', 'USD', 16, 1, ?, 0)`, [cardId, HV, ext, ext, last4]);
  await pool.query(`INSERT INTO card_transactions (card_id, provider_transaction_id, transaction_type, status, amount, currency, raw_hash)
    VALUES (?, ?, 'PURCHASE', 'COMPLETE', '15.750000', 'USD', ?)`, [cardId, `mu-tx-${cardId}`, crypto.randomBytes(32).toString('hex')]);
  await pool.query(`INSERT INTO card_operational_overrides (id, provider_account_id, external_card_id, allocation_policy, product_code, reason, set_by)
    VALUES (UUID(), ?, ?, 'RETIRED', NULL, ?, 'admin')`, [HV, ext, reason]);
  return ext;
}

async function findings(pool) {
  const report = await createDailyReconciliationService({ pool }).run({ persist: false });
  return new Map((report.cards || []).map((card) => [card.last4, card.count?.finding]));
}

async function storedReason(pool, ext) {
  const [[row]] = await pool.query('SELECT reason FROM card_operational_overrides WHERE provider_account_id = ? AND external_card_id = ?', [HV, ext]);
  return row?.reason;
}

test('欠账 36: 已销卡 / 重新停用改写原因后，手动用过的卡在日对账里仍是「已登记手动用卡」；没登记过的仍是无主扣款', { skip }, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
  try {
    const retired = await cardWithExtraCharge(pool, '7701', 'MANUAL_USED: 自用期手动用卡');
    const restopped = await cardWithExtraCharge(pool, '7702', 'MANUAL_USED: 自用期手动用卡');
    const plain = await cardWithExtraCharge(pool, '7703', 'OTHER: 不是手动用卡');

    const before = await findings(pool);
    assert.equal(before.get('7701'), 'PENDING_MANUAL_REGISTRATION');
    assert.equal(before.get('7702'), 'PENDING_MANUAL_REGISTRATION');
    assert.equal(before.get('7703'), 'UNEXPLAINED_CHARGE', '对照：没登记手动用卡的多出扣款本来就是无主扣款');

    const retirement = createCardRetirementService({ pool });
    await retirement.confirmRetired({ providerAccountId: HV, externalCardId: retired, actorId: 'test', note: '已在卡台删', source: 'admin' });
    await retirement.confirmRetired({ providerAccountId: HV, externalCardId: plain, actorId: 'test', note: '已在卡台删', source: 'admin' });
    await createCardOperationalOverrideService({ pool }).set({ providerAccountId: HV, externalCardId: restopped,
      allocationPolicy: 'RETIRED', reason: 'OTHER: 重新停用', actorId: 'test' });

    assert.equal(await storedReason(pool, retired), 'retired confirmed (admin): 已在卡台删｜manual-used');
    assert.equal(await storedReason(pool, restopped), 'OTHER: 重新停用｜manual-used');
    assert.equal(await storedReason(pool, plain), 'retired confirmed (admin): 已在卡台删', '没登记过手动用卡的不能凭空加标记');

    const after = await findings(pool);
    assert.equal(after.get('7701'), 'PENDING_MANUAL_REGISTRATION', '已销卡后仍认得出是手动用卡');
    assert.equal(after.get('7702'), 'PENDING_MANUAL_REGISTRATION', '重新停用后仍认得出是手动用卡');
    assert.equal(after.get('7703'), 'UNEXPLAINED_CHARGE');
  } finally { await pool.end(); }
});
