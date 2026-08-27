import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveCardConsumption, consumeCardConsumption, releaseCardConsumption } from '../src/services/card-consumption-ledger-service.js';

function fakePool() {
  const rows = []; const cards = new Set(['card-1']);
  const conn = { async beginTransaction(){}, async commit(){}, async rollback(){}, release(){}, async query(sql, params=[]) {
    if (sql.startsWith('SELECT id FROM cards')) return [[cards.has(params[0]) ? { id: params[0] } : undefined].filter(Boolean)];
    if (sql.includes('SELECT id, status, recharge_attempt_id')) {
      const row = rows.find(r => r.cardId === params[0] && r.orderId === params[1]);
      return [row ? [{ id: row.id, status: row.status, recharge_attempt_id: row.rechargeAttemptId || null }] : []];
    }
    if (sql.includes('SELECT COUNT(*) AS used')) return [[{ used: rows.filter(r => r.cardId === params[0] && ['RESERVED','CONSUMED'].includes(r.status)).length }]];
    if (sql.startsWith('INSERT INTO card_consumption_ledger')) { rows.push({ id: params[0], cardId: params[1], orderId: params[2], rechargeAttemptId: params[3], status: 'RESERVED' }); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE card_consumption_ledger') && sql.includes('WHERE id = ? AND status IN')) {
      const targetStatus = params[0];
      const id = params.find(value => rows.some(row => row.id === value));
      const r=rows.find(x=>x.id===id&&x.status==='RESERVED');
      if(r){r.status=targetStatus;return[{affectedRows:1}];}
      return[{affectedRows:0}];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  return { rows, async getConnection(){ return conn; }, async query(...args){ return conn.query(...args); } };
}

test('reserves up to configured capacity and consumes/releases exactly once', async () => {
  const pool = fakePool();
  const a = await reserveCardConsumption(pool, { cardId: 'card-1', orderId: 'o1', maxPayments: 2 });
  const b = await reserveCardConsumption(pool, { cardId: 'card-1', orderId: 'o2', maxPayments: 2 });
  assert.equal(a.remaining, 1); assert.equal(b.remaining, 0);
  await assert.rejects(() => reserveCardConsumption(pool, { cardId: 'card-1', orderId: 'o3', maxPayments: 2 }), { code: 'CARD_CONSUMPTION_LIMIT' });
  await consumeCardConsumption(pool, { id: a.id, providerTransactionId: 'tx-1' });
  await releaseCardConsumption(pool, { id: b.id, reason: 'not submitted' });
  assert.equal(pool.rows.filter(r => r.status === 'CONSUMED').length, 1);
  assert.equal(pool.rows.filter(r => r.status === 'RELEASED').length, 1);
});
