// 撤销「我已在卡台删掉」（B3 的硬前置）。
//
// 为什么这条路必须有：D-301 定了去掉确认词，而这个动作原本是单向的——一点就把卡
// inventory_status 改成 RETIRED、sync_tier 转 ARCHIVED、next_sync_at 推到 10 年后、
// override 盖成 RETIRED，卡从待销清单里消失。去掉闸门之前得先有回头路。
//
// 这里守的重点不是「能不能撤」，是**撤不回去的时候会不会瞎猜**：没有退役事件、
// 事件里没记原状态，都必须拒绝，而不是给一个「大概是 AVAILABLE」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardRetirementService } from '../src/services/card-retirement-service.js';

function makePool({ card, event }) {
  const calls = [];
  const connection = {
    calls,
    committed: 0, rolledBack: 0,
    beginTransaction: async () => {},
    commit: async () => { connection.committed += 1; },
    rollback: async () => { connection.rolledBack += 1; },
    release: () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM cards c')) return [card ? [card] : []];
      if (sql.includes('FROM card_state_events')) return [event ? [event] : []];
      return [{ affectedRows: 1 }];
    }
  };
  return { pool: { getConnection: async () => connection }, connection };
}

const RETIRED_CARD = {
  id: 'c2', provider_account_id: 'pa-1', external_card_id: 'h-2', last4: '7726',
  inventory_status: 'RETIRED', sync_tier: 'ARCHIVED'
};
const now = new Date('2026-09-20T09:00:00.000Z');

test('撤销把卡放回退役前的状态，并留下审计', async () => {
  const { pool, connection } = makePool({
    card: RETIRED_CARD,
    event: { previous_json: JSON.stringify({ inventoryStatus: 'DEPLETED', syncTier: 'AUTO', override: null }) }
  });
  const service = createCardRetirementService({ pool, clock: () => now });

  const result = await service.undoRetired({ cardId: 'c2', reason: '点错了', actorId: 'lemon' });

  assert.equal(result.inventoryStatus, 'DEPLETED');
  assert.equal(result.syncTier, 'AUTO');
  assert.equal(result.replayed, false);
  assert.equal(connection.committed, 1);
  assert.equal(connection.rolledBack, 0);

  const update = connection.calls.find((c) => c.sql.includes('UPDATE cards'));
  assert.deepEqual(update.params.slice(0, 2), ['DEPLETED', 'AUTO']);
  // next_sync_at 放回「现在」：撤销之后最该发生的就是再同步一次，核这张卡到底还在不在
  assert.equal(update.params[2], now);

  const audit = connection.calls.find((c) => c.sql.includes('card_state_events') && c.sql.includes('INSERT'));
  assert.ok(audit, '撤销没有留审计');
  assert.equal(audit.params[1], 'CARD_RETIREMENT_UNDONE');
  assert.match(audit.params[4], /"reason":"点错了"/);
});

test('退役前本来就没有 override：删掉退役建的那行，且不谎报「系统没记」', async () => {
  const { pool, connection } = makePool({
    card: RETIRED_CARD,
    event: { previous_json: JSON.stringify({ inventoryStatus: 'DEPLETED', syncTier: 'AUTO', override: null }) }
  });
  const service = createCardRetirementService({ pool, clock: () => now });

  const result = await service.undoRetired({ cardId: 'c2', reason: 'x' });

  assert.equal(result.overrideRestored, false);
  // 「知道退役前没有」和「不知道退役前是什么」是两件事。混成一个布尔，页面就会对着
  // 一个其实记得清清楚楚的 case 说「系统没记」——给观察补原因。
  assert.equal(result.previousOverrideKnown, true);
  assert.ok(connection.calls.some((c) => c.sql.startsWith('DELETE FROM card_operational_overrides')));
});

test('退役前标过 PRODUCT_ONLY：原样还原，不是一律抹成普通', async () => {
  const { pool, connection } = makePool({
    card: RETIRED_CARD,
    event: { previous_json: JSON.stringify({ inventoryStatus: 'AVAILABLE', syncTier: 'AUTO',
      override: { allocationPolicy: 'PRODUCT_ONLY', productCode: 'pro_20x', reason: '20X 专用', setBy: 'lemon' } }) }
  });
  const service = createCardRetirementService({ pool, clock: () => now });

  const result = await service.undoRetired({ cardId: 'c2', reason: 'x' });

  assert.equal(result.overrideRestored, true);
  assert.equal(result.previousOverrideKnown, true);
  const upsert = connection.calls.find((c) => c.sql.includes('INSERT INTO card_operational_overrides'));
  assert.deepEqual(upsert.params.slice(2, 4), ['PRODUCT_ONLY', 'pro_20x']);
  // 一张 $150 的 20X 卡，撤销时把 PRODUCT_ONLY 丢了就会掉进 Plus 池（D-296 的病根）
  assert.ok(!connection.calls.some((c) => c.sql.startsWith('DELETE FROM card_operational_overrides')));
});

test('老数据没记 override：删掉并如实说「原值不详」', async () => {
  const { pool } = makePool({
    card: RETIRED_CARD,
    event: { previous_json: JSON.stringify({ inventoryStatus: 'DEPLETED', syncTier: 'AUTO' }) }
  });
  const service = createCardRetirementService({ pool, clock: () => now });

  const result = await service.undoRetired({ cardId: 'c2', reason: 'x' });

  assert.equal(result.previousOverrideKnown, false);
  assert.equal(result.overrideRestored, false);
});

test('没有退役事件就拒绝，不猜一个状态出来', async () => {
  const { pool, connection } = makePool({ card: RETIRED_CARD, event: null });
  const service = createCardRetirementService({ pool, clock: () => now });

  await assert.rejects(() => service.undoRetired({ cardId: 'c2', reason: 'x' }),
    (error) => error.code === 'CARD_RETIREMENT_NOTHING_TO_UNDO');
  assert.equal(connection.rolledBack, 1);
  assert.equal(connection.committed, 0);
});

test('事件里记的原状态就是 RETIRED（还原不了）也拒绝', async () => {
  const { pool } = makePool({
    card: RETIRED_CARD,
    event: { previous_json: JSON.stringify({ inventoryStatus: 'RETIRED', syncTier: 'ARCHIVED' }) }
  });
  const service = createCardRetirementService({ pool, clock: () => now });

  await assert.rejects(() => service.undoRetired({ cardId: 'c2', reason: 'x' }),
    (error) => error.code === 'CARD_RETIREMENT_UNDO_UNKNOWN_PREVIOUS');
});

test('没退役的卡撤销是幂等的 no-op，不动任何状态', async () => {
  const { pool, connection } = makePool({
    card: { ...RETIRED_CARD, inventory_status: 'AVAILABLE' },
    event: { previous_json: '{}' }
  });
  const service = createCardRetirementService({ pool, clock: () => now });

  const result = await service.undoRetired({ cardId: 'c2', reason: 'x' });

  assert.equal(result.replayed, true);
  assert.equal(result.inventoryStatus, 'AVAILABLE');
  assert.ok(!connection.calls.some((c) => c.sql.includes('UPDATE cards')));
});

test('撤销必须带理由——没有理由的撤销在审计里等于没发生过', async () => {
  const { pool } = makePool({ card: RETIRED_CARD, event: { previous_json: '{}' } });
  const service = createCardRetirementService({ pool, clock: () => now });
  await assert.rejects(() => service.undoRetired({ cardId: 'c2' }),
    (error) => error.code === 'INVALID_CARD_RETIREMENT');
});

test('退役确认把 override 的原值记进事件——不记就没得还原', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM cards c')) {
        return [[{ id: 'c2', provider_account_id: 'pa-1', external_card_id: 'h-2', last4: '7726',
          provider_card_id: 'h-2', inventory_status: 'DEPLETED', sync_tier: 'AUTO', next_sync_at: null,
          source_present: 1, created_at: new Date('2026-09-14T00:00:00.000Z'), current_balance: '0.35',
          active_assignment: 0 }]];
      }
      if (sql.includes('SELECT allocation_policy')) {
        return [[{ allocation_policy: 'PRODUCT_ONLY', product_code: 'pro_20x', reason: '20X 专用', set_by: 'lemon' }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = createCardRetirementService({ pool: { getConnection: async () => connection }, clock: () => now });

  await service.confirmRetired({ cardId: 'c2', actorId: 'lemon' });

  const audit = calls.find((c) => c.sql.includes('INSERT INTO card_state_events'));
  const previous = JSON.parse(audit.params[3]);
  assert.equal(previous.inventoryStatus, 'DEPLETED');
  assert.equal(previous.syncTier, 'AUTO');
  assert.deepEqual(previous.override, { allocationPolicy: 'PRODUCT_ONLY', productCode: 'pro_20x',
    reason: '20X 专用', setBy: 'lemon' });
});

/* ===== 待销理由（D-309）===== */

test('「取消续费未确认」不再算待销理由——那是去关续费，不是去销卡', async () => {
  const { classifyRetirementRow } = await import('../src/services/card-retirement-service.js');
  // cancellation_unconfirmed 必须**是 1** —— 少了这个字段，断言就是空转：
  // 把那条理由加回代码里测试照样全绿（本轮变异测试当场抓到我这个疏漏）。
  const base = {
    id: 'c1', created_at: new Date('2026-09-01T00:00:00.000Z'), used_count: 0, max_payments: 3,
    pro_used_count: 0, inventory_status: 'AVAILABLE', retired_override: 0, min_age_hours: 6,
    cancellation_unconfirmed: 1
  };
  const row = classifyRetirementRow(base, { now: new Date('2026-09-20T00:00:00.000Z') });
  assert.deepEqual(row.reasons, [], '一张正常服役的卡不该因为订单没关续费就进待销清单');
  assert.equal(row.candidate, false);

  // 该留的理由一个都不能少
  const cases = [
    [{ used_count: 3 }, 'USED_UP'],
    [{ pro_used_count: 1 }, 'PRO_USED'],
    [{ inventory_status: 'DEPLETED' }, 'DEPLETED'],
    [{ inventory_status: 'FAILED' }, 'FAILED'],
    [{ retired_override: 1 }, 'RETIRED_OVERRIDE']
  ];
  for (const [patch, expected] of cases) {
    const got = classifyRetirementRow({ ...base, ...patch }, { now: new Date('2026-09-20T00:00:00.000Z') });
    assert.ok(got.reasons.includes(expected), `${expected} 这条理由丢了`);
  }
});

test('待销的取数 SQL 不再跑那个没人用的续费子查询', async () => {
  const { retirementCandidateSql } = await import('../src/services/card-retirement-service.js');
  const sql = retirementCandidateSql();
  assert.doesNotMatch(sql, /cancellation_unconfirmed/,
    '理由去掉了，这个每行都跑一次的 EXISTS 也该跟着去掉');
  assert.doesNotMatch(sql, /cancellation_review_required/);
  // 其余判定用的列必须还在
  for (const col of ['used_count', 'pro_used_count', 'retired_override', 'max_payments', 'min_age_hours']) {
    assert.match(sql, new RegExp(col), `${col} 丢了`);
  }
});
