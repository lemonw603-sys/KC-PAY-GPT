import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRetirementRow, createCardRetirementService, platformPresence, retirementCandidateSql } from '../src/services/card-retirement-service.js';

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

test('欠账 36: confirmRetired 覆盖一张登记过手动用卡的卡，新原因带上标记；原 override 仍完整存进事件', async () => {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      if (flat.startsWith('SELECT c.id')) return [[{ id: 'c1', provider_account_id: 'acct', external_card_id: 'HG1', last4: '7402',
        provider_card_id: 'HG1', inventory_status: 'HELD_FOR_REVIEW', sync_tier: 'MANUAL_IMPORT', source_present: 0,
        created_at: new Date('2026-09-08T14:20:00Z'), current_balance: '1.08', active_assignment: 0 }]];
      if (flat.startsWith('SELECT allocation_policy')) return [[{ allocation_policy: 'RETIRED', product_code: null,
        reason: 'MANUAL_USED: 自用期手动用卡', set_by: 'admin' }]];
      return [{ affectedRows: 1 }];
    }
  };
  await createCardRetirementService({ pool: { getConnection: async () => connection }, clock: () => new Date('2026-09-29T12:00:00Z') })
    .confirmRetired({ providerAccountId: 'acct', externalCardId: 'HG1', actorId: 'lemon', note: '已在卡台删', source: 'admin' });
  const override = queries.find((q) => /INSERT INTO card_operational_overrides/.test(q.sql));
  assert.equal(override.params[2], 'retired confirmed (admin): 已在卡台删｜manual-used');
  const event = queries.find((q) => /INSERT INTO card_state_events/.test(q.sql));
  assert.equal(JSON.parse(event.params[3]).override.reason, 'MANUAL_USED: 自用期手动用卡', '撤销要靠这份原值还原');
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

// D-405：待销清单「卡台上」——只用最近一次和卡台核对留下的事实，不猜。
test('D-405 platform presence: there / gone / void / unknown from the last check, highvcc and hnskj each by their own facts', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const hv = { sync_tier: 'MANUAL_IMPORT', source_present: 1, source_operational_status: 'ACTIVE',
    last_synced_at: '2026-09-27T10:20:12Z', provider_checked_at: '2026-09-29T11:00:00Z', provider_login_expired: 0,
    inventory_status: 'AVAILABLE', status: 'active' };
  // 卡台列表两天没变（快照 NO_CHANGE 不刷卡上时间），但一小时前钱包快照证明核对过 → 还在，时间取较晚的
  assert.deepEqual(platformPresence(hv, { now }), { state: 'THERE', syncedAt: '2026-09-29T11:00:00.000Z', note: null });
  assert.equal(platformPresence({ ...hv, provider_checked_at: '2026-09-27T11:00:00Z' }, { now }).state, 'UNKNOWN', '一天多没核对上就说查不了');
  assert.equal(platformPresence({ ...hv, provider_login_expired: 1 }, { now }).note, '卡台登录失效，同步不了');
  assert.equal(platformPresence({ ...hv, source_present: 0, source_operational_status: 'MISSING_FROM_SNAPSHOT' }, { now }).state, 'GONE');
  assert.equal(platformPresence({ ...hv, source_operational_status: 'CARD_NOT_ACTIVE' }, { now }).state, 'VOID');
  const hn = { sync_tier: 'REFUND_WATCH', status: 'invalid', inventory_status: 'FAILED', last_successful_sync_at: '2026-09-29T10:00:00Z' };
  assert.equal(platformPresence(hn, { now }).state, 'VOID', 'hnskj 卡台说失效');
  assert.equal(platformPresence({ ...hn, status: 'active', inventory_status: 'AVAILABLE' }, { now }).state, 'THERE');
  assert.equal(platformPresence({ ...hn, status: 'active', inventory_status: 'AVAILABLE', last_successful_sync_at: '2026-09-27T10:00:00Z' }, { now }).state, 'UNKNOWN');
  assert.equal(platformPresence({ ...hn, source_present: 0, status: 'active', inventory_status: 'AVAILABLE' }, { now }).state, 'THERE',
    'hnskj 卡不写 source_present，默认值不能拿来判「不见了」');
  // 分类结果带上 platform，前端只显示不另判
  const row = { ...hv, id: 'c1', used_count: 3, max_payments: 3, created_at: '2026-09-01T00:00:00Z', min_age_hours: 6 };
  assert.equal(classifyRetirementRow(row, { now }).platform.state, 'THERE');
  assert.match(retirementCandidateSql(), /provider_checked_at/);
  assert.match(retirementCandidateSql(), /provider-token-expired:/);
});

