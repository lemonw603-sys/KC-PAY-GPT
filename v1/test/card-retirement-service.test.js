import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRetirementRow, createCardRetirementService, retirementCandidateSql } from '../src/services/card-retirement-service.js';

const now = new Date('2026-09-18T12:00:00Z');
const base = { id: 'c1', provider_account_id: 'acct', provider_code: 'hnskj', provider_card_id: '5622', external_card_id: '5622',
  last4: '6754', inventory_status: 'AVAILABLE', status: 'active', sync_tier: 'AVAILABLE', source_present: 1,
  funded_amount: '50', current_balance: '2.46', currency: 'USD', created_at: new Date('2026-09-18T00:00:00Z'),
  used_count: 0, pro_used_count: 0, active_assignment: 0, retired_override: 0, cancellation_unconfirmed: 0,
  max_payments: 3, min_age_hours: 6 };

test('used-up card (3/3) past the minimum age is due; the cap value itself is read from settings, not hard-coded', () => {
  const row = classifyRetirementRow({ ...base, used_count: 3 }, { now });
  assert.deepEqual(row.reasons, ['USED_UP']);
  assert.equal(row.due, true);
  assert.equal(row.dueAt, '2026-09-18T06:00:00.000Z');
  assert.equal(classifyRetirementRow({ ...base, used_count: 3, max_payments: 4 }, { now }).candidate, false);
});

test('DEPLETED card is a candidate; one that is younger than the minimum age is listed as notYetDue, not due', () => {
  const due = classifyRetirementRow({ ...base, inventory_status: 'DEPLETED' }, { now });
  assert.deepEqual(due.reasons, ['DEPLETED']);
  assert.equal(due.due, true);
  const young = classifyRetirementRow({ ...base, inventory_status: 'DEPLETED', created_at: new Date('2026-09-18T09:00:00Z') }, { now });
  assert.equal(young.candidate, true);
  assert.equal(young.due, false);
  assert.equal(young.dueAt, '2026-09-18T15:00:00.000Z');
});

test('取消续费未确认**不再**进待销清单（D-309 改写 D-248 打架 4）；有活动分配的卡仍然不进', () => {
  // D-248 打架 4 当初加这条，关切是「取消续费没确认的卡是客户可能续费扣我们钱的卡」。
  // 关切成立，落点错了：待销清单的动作是「去卡台删掉这张卡」，而这件事要做的是
  // 「去订单里把续费关掉」。而且实查两件事——资格规则里没有任何 cancellation/subscription
  // 条件，待销清单又是派生查询不建表——**进这个清单从来没有阻止过这张卡被继续分配**，
  // 它的效果只有「提醒」。所以关切原样搬去工作台队列（那条待办的文案就是
  // 「不关下个周期会再扣一次」），落点改成跳订单页的「需要处理」。
  const row = classifyRetirementRow({ ...base, cancellation_unconfirmed: 1 }, { now });
  assert.deepEqual(row.reasons, []);
  assert.equal(row.candidate, false);

  // 「有活动分配的不进」是另一条规则，与本次改动无关，必须还在
  const busy = classifyRetirementRow({ ...base, used_count: 3, active_assignment: 1 }, { now });
  assert.equal(busy.candidate, false, '卡还绑着在跑的订单时，哪怕用满也不能催人去销');
});

test('a card that served a Pro order is one-and-done (D-221) even below the Plus cap; a healthy card is not a candidate', () => {
  assert.deepEqual(classifyRetirementRow({ ...base, used_count: 1, pro_used_count: 1 }, { now }).reasons, ['PRO_USED']);
  assert.equal(classifyRetirementRow(base, { now }).candidate, false);
  assert.deepEqual(classifyRetirementRow({ ...base, retired_override: 1 }, { now }).reasons, ['RETIRED_OVERRIDE']);
  // 生产实跑（2026-09-18）：hnskj 12 张作废卡是 FAILED，其中 7 张没 override——FAILED 也是「不再服务新单」。
  assert.deepEqual(classifyRetirementRow({ ...base, inventory_status: 'FAILED', current_balance: '0' }, { now }).reasons, ['FAILED']);
});

test('candidate SQL reads the cap and the minimum age from app_settings and excludes already-retired cards', () => {
  const sql = retirementCandidateSql();
  assert.match(sql, /card_max_successful_payments/);
  assert.match(sql, /card_min_retire_age_hours/);
  assert.match(sql, /inventory_status <> 'RETIRED'/);
  // 那条理由去掉后，这个每行都要跑一次的 EXISTS 也跟着删了（D-309）
  assert.doesNotMatch(sql, /cancellation_review_required/);
});

function poolWith(cardRow) {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => { queries.push({ sql: 'COMMIT' }); },
    rollback: async () => { queries.push({ sql: 'ROLLBACK' }); }, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      if (flat.startsWith('SELECT c.id')) return [cardRow ? [cardRow] : []];
      return [{ affectedRows: 1 }];
    }
  };
  return { queries, pool: { getConnection: async () => connection, query: connection.query } };
}

test('confirmRetired writes the terminal state, the RETIRED override and an audited CARD_RETIRED_CONFIRMED event with ageHours', async () => {
  const { pool, queries } = poolWith({ id: 'c1', provider_account_id: 'acct', external_card_id: 'HG1', last4: '3241', provider_card_id: 'HG1',
    inventory_status: 'HELD_FOR_REVIEW', sync_tier: 'MANUAL_IMPORT', source_present: 0, created_at: new Date('2026-09-10T09:52:18Z'), current_balance: '1.00', active_assignment: 0 });
  const service = createCardRetirementService({ pool, clock: () => new Date('2026-09-18T12:00:00Z') });
  const result = await service.confirmRetired({ providerAccountId: 'acct', externalCardId: 'HG1', actorId: 'lemon', note: 'cancelled on highvcc', source: 'admin' });
  assert.equal(result.replayed, false);
  assert.equal(result.inventoryStatus, 'RETIRED');
  assert.equal(result.ageHours, 194.13);
  const update = queries.find((q) => q.sql.startsWith('UPDATE cards SET inventory_status'));
  assert.equal(update.params[0], 'RETIRED');
  assert.match(update.sql, /IF\(sync_tier = 'MANUAL_IMPORT', sync_tier, 'ARCHIVED'\)/);
  const override = queries.find((q) => /INSERT INTO card_operational_overrides/.test(q.sql));
  assert.equal(override.params[2].startsWith('retired confirmed (admin): cancelled on highvcc'), true);
  const event = queries.find((q) => /INSERT INTO card_state_events/.test(q.sql));
  assert.equal(event.params[1], 'CARD_RETIRED_CONFIRMED');
  assert.equal(JSON.parse(event.params[4]).ageHours, 194.13);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('confirmRetired refuses a card that still has an active order and replays an already-retired card without writing', async () => {
  const busy = poolWith({ id: 'c1', provider_account_id: 'acct', external_card_id: 'X', last4: '0001', inventory_status: 'ASSIGNED', sync_tier: 'AVAILABLE', created_at: new Date(), active_assignment: 1 });
  await assert.rejects(() => createCardRetirementService({ pool: busy.pool }).confirmRetired({ cardId: 'c1' }), (error) => error.code === 'CARD_RETIREMENT_CARD_BUSY');
  assert.equal(busy.queries.at(-1).sql, 'ROLLBACK');
  const done = poolWith({ id: 'c1', provider_account_id: 'acct', external_card_id: 'X', last4: '0001', inventory_status: 'RETIRED', sync_tier: 'ARCHIVED', created_at: new Date(), active_assignment: 0 });
  const result = await createCardRetirementService({ pool: done.pool }).confirmRetired({ cardId: 'c1' });
  assert.equal(result.replayed, true);
  assert.equal(done.queries.some((q) => q.sql.startsWith('UPDATE') || q.sql.startsWith('INSERT')), false);
});
