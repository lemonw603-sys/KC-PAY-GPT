import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardOperationalOverrideService } from '../src/services/card-operational-override-service.js';

/**
 * clear() 现在走事务并留痕（B3）：它成了运营会点的「撤销手动用卡登记」按钮，
 * 而此前前端一次都没调过。所以 stub 要有 getConnection —— 不是为了迁就实现，
 * 是因为「删一行 + 写一条审计」必须同生共死。
 */
function makeConnection(handler) {
  const calls = [];
  const connection = {
    calls,
    began: 0, committed: 0, rolledBack: 0, released: 0,
    beginTransaction: async () => { connection.began += 1; },
    commit: async () => { connection.committed += 1; },
    rollback: async () => { connection.rolledBack += 1; },
    release: () => { connection.released += 1; },
    query: async (sql, params) => { calls.push({ sql, params }); return handler(sql, params); }
  };
  return connection;
}

test('card operational overrides validate policy and upsert operator choice', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT')) return [{ affectedRows: 1 }];
    return [[{ id: 'x', provider_account_id: params?.[0], external_card_id: params?.[1], allocation_policy: 'RETIRED' }]];
  } };
  const service = createCardOperationalOverrideService({ pool });
  await assert.rejects(() => service.set({ providerAccountId: 'a', externalCardId: 'b', allocationPolicy: 'PRODUCT_ONLY', reason: 'retire' }), /Product is required/);
  const row = await service.set({ providerAccountId: 'a', externalCardId: 'b', allocationPolicy: 'RETIRED', reason: 'old batch', actorId: 'admin' });
  assert.equal(row.allocation_policy, 'RETIRED');
  assert.equal(calls.length, 2);
});

test('撤销手动用卡登记：删掉 override 的同时写一条审计，两件事同一个事务', async () => {
  const connection = makeConnection((sql) => {
    if (sql.includes('SELECT allocation_policy')) {
      return [[{ allocation_policy: 'RETIRED', product_code: null, reason: '我手动用了', set_by: 'admin' }]];
    }
    if (sql.startsWith('DELETE')) return [{ affectedRows: 1 }];
    if (sql.includes('SELECT id FROM cards')) return [[{ id: 'card-1' }]];
    return [{ affectedRows: 1 }];
  });
  const service = createCardOperationalOverrideService({ pool: { getConnection: async () => connection } });

  const result = await service.clear({ providerAccountId: 'a', externalCardId: 'b', reason: '点错了', actorId: 'lemon' });

  assert.equal(result.deleted, true);
  assert.equal(result.audited, true);
  assert.equal(connection.began, 1);
  assert.equal(connection.committed, 1);
  assert.equal(connection.rolledBack, 0);
  assert.equal(connection.released, 1);

  const audit = connection.calls.find((c) => c.sql.includes('card_state_events'));
  assert.ok(audit, '删了 override 却没写审计行');
  assert.match(audit.sql, /CARD_OVERRIDE_CLEARED/);
  assert.equal(audit.params[0], 'card-1');
  assert.equal(audit.params[1], 'lemon');
  // 原值必须进 previous_json，否则事后查不出「撤销之前它被标成什么」
  assert.match(audit.params[2], /"allocationPolicy":"RETIRED"/);
  assert.match(audit.params[3], /"reason":"点错了"/);
});

test('override 行没有对应的卡时如实说没留痕，不假装记过', async () => {
  const connection = makeConnection((sql) => {
    if (sql.includes('SELECT allocation_policy')) {
      return [[{ allocation_policy: 'RETIRED', product_code: null, reason: 'x', set_by: 'admin' }]];
    }
    if (sql.startsWith('DELETE')) return [{ affectedRows: 1 }];
    if (sql.includes('SELECT id FROM cards')) return [[]];   // 页面上那些 externalOnly 的行就是这种
    return [{ affectedRows: 1 }];
  });
  const service = createCardOperationalOverrideService({ pool: { getConnection: async () => connection } });

  const result = await service.clear({ providerAccountId: 'a', externalCardId: 'ghost', reason: '清理' });

  assert.equal(result.deleted, true);
  assert.equal(result.audited, false);
  assert.equal(connection.calls.some((c) => c.sql.includes('card_state_events')), false);
});

test('删不到行就不写审计，也不算成功', async () => {
  const connection = makeConnection((sql) => {
    if (sql.includes('SELECT allocation_policy')) return [[]];
    if (sql.startsWith('DELETE')) return [{ affectedRows: 0 }];
    return [{ affectedRows: 0 }];
  });
  const service = createCardOperationalOverrideService({ pool: { getConnection: async () => connection } });

  const result = await service.clear({ providerAccountId: 'a', externalCardId: 'b', reason: 'noop' });

  assert.equal(result.deleted, false);
  assert.equal(result.audited, false);
  assert.equal(connection.calls.some((c) => c.sql.includes('card_state_events')), false);
});
