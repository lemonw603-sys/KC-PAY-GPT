import test from 'node:test';
import assert from 'node:assert/strict';
import { findCustomerOrder } from '../src/db/repositories/order-status-query-repository.js';

// D-386：两条都在生产上实测过（卡密多单时查到旧失败单；判未扣款关单后永远「正在核对」）。
// 这里锁住 SQL 的写法，防止回退。真正的可执行性由 customer-sql-probe.sh 在生产 schema 上验。
function capturingPool() {
  const sqls = [];
  return { sqls, async query(sql) { sqls.push(sql); return [[]]; } };
}

test('a code with several orders resolves to the order it is bound to, else the newest — never an arbitrary old one', async () => {
  const pool = capturingPool();
  await findCustomerOrder(pool, { cdkLookup: { current: { version: 2, hash: 'h2' }, legacy: { version: 1, hash: 'h1' } } });
  assert.match(pool.sqls[0], /ORDER BY \(o\.id = c\.order_id\) DESC, o\.created_at DESC, o\.id DESC\s+LIMIT 1/);
});

test('a closed order shows success only if it succeeded before closing; every other close shows as not completed', async () => {
  const pool = capturingPool();
  await findCustomerOrder(pool, { publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  const sql = pool.sqls[0];
  assert.match(sql, /\) = 'RECHARGE_SUCCESS' THEN 'RECHARGE_SUCCESS' ELSE 'CARD_FAILED' END/);
  assert.doesNotMatch(sql, /failure_code = 'CANCELLED_PRE_SUBMISSION' THEN 'CARD_FAILED' ELSE \(/, 'the old rule that surfaced the pre-close status is gone');
});
