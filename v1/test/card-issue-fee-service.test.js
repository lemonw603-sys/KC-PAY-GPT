import test from 'node:test';
import assert from 'node:assert/strict';
import { recordIssueFee } from '../src/services/card-issue-fee-service.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000101';

function fakePool({ cardRows = [{ id: 'card-uuid-5276' }] } = {}) {
  const queries = [];
  const lookups = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async query(sql, params) { queries.push({ sql, params }); return [{ affectedRows: 1 }]; },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
  };
  return {
    queries,
    lookups,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    // 卡行查询走 pool.query（服务自己解析 cards.id）；写入走 getConnection 的事务。
    async query(sql, params) { lookups.push({ sql, params }); return [cardRows]; },
    async getConnection() { return connection; },
  };
}

test('recordIssueFee: 算得出就写一条独立费用行', async () => {
  const pool = fakePool();
  // 2026-09-17 那次真实开卡的数：106.06 → 89.48，卡里进 $16。
  const result = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT,
    providerCardId: '5276',
    balanceBefore: '106.06',
    balanceAfter: '89.48',
    openCardAmount: 16,
    observedAt: new Date('2026-09-17T01:34:35.000Z'),
  });

  assert.equal(result.recorded, true);
  assert.equal(result.fee, '0.58');
  assert.equal(result.spent, '16.58');
  assert.equal(result.transactionId, 'LOCAL_ISSUE_FEE_5276');
  assert.equal(pool.committed, true);
  assert.equal(pool.queries.length, 1, '只插一行，不做别的');

  const [insert] = pool.queries;
  assert.match(insert.sql, /INSERT INTO card_transactions/);
  assert.doesNotMatch(insert.sql, /UPDATE cards/, '不得刷 last_transaction_synced_at —— 那是分配资格的判据');
  assert.doesNotMatch(insert.sql, /card_consumption_ledger/, '不得碰消费账本');
  const [cardId, providerTransactionId, type, status, amount, currency, fee] = insert.params;
  assert.equal(cardId, 'card-uuid-5276');
  assert.equal(providerTransactionId, 'LOCAL_ISSUE_FEE_5276');
  assert.equal(type, 'CARD_ISSUE_FEE');
  assert.equal(status, 'OBSERVED', '不是卡台状态，不能写成 success');
  assert.equal(amount, '0.58');
  assert.equal(currency, 'USD');
  assert.equal(fee, null, 'amount 已经是费用本身，fee 再填一遍会被重复计算');
});

test('recordIssueFee: 同一张卡重跑是幂等的（唯一键 + ON DUPLICATE KEY）', async () => {
  const pool = fakePool();
  const once = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: '5276',
    balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: 16,
  });
  const twice = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: '5276',
    balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: 16,
  });
  assert.equal(once.transactionId, twice.transactionId, '交易号由 providerCardId 决定，不是随机的');
  assert.match(pool.queries[0].sql, /ON DUPLICATE KEY UPDATE/);
});

test('recordIssueFee: 余额差被污染时一个字都不写', async () => {
  const pool = fakePool();
  // 2026-09-14 06:57→07:02 真实发生过：窗口里账户被充值，余额不降反升。
  const result = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: '4458',
    balanceBefore: '18.25', balanceAfter: '121.77', openCardAmount: 16,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'BALANCE_DID_NOT_DROP');
  assert.equal(pool.queries.length, 0, '算不准就不写，绝不退化成 0');
  assert.equal(pool.committed, false);
});

test('recordIssueFee: 差值离谱时也不写', async () => {
  const pool = fakePool();
  const result = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: 'x',
    balanceBefore: '100.00', balanceAfter: '40.00', openCardAmount: 16,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'FEE_ABOVE_PLAUSIBLE_RANGE');
  assert.equal(pool.queries.length, 0);
});

test('recordIssueFee: 读不到余额（卡台没回）时不写，也不报错拖垮开卡', async () => {
  const pool = fakePool();
  const result = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: 'x',
    balanceBefore: null, balanceAfter: '89.48', openCardAmount: 16,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'UNREADABLE_AMOUNTS');
  assert.equal(pool.queries.length, 0);
});

test('recordIssueFee: 没有卡台账户可挂时不写', async () => {
  const pool = fakePool();
  const noCard = await recordIssueFee(pool, {
    providerAccountId: null, providerCardId: '5276',
    balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: 16,
  });
  assert.equal(noCard.reason, 'NO_CARD_TO_ATTACH_THE_FEE_TO');
  assert.equal(pool.queries.length, 0);
});

test('recordIssueFee: 卡行 id 由服务自己按 providerCardId 查出来', async () => {
  // 这条是给 D-172 惯犯 3 设的闸门：card-stock-service 的 register() 不返回 id，
  // 一旦有人把这里改回「让调用方传 cardId」，真实调用点就会传进 undefined，
  // 而假 id 的单测照样全绿。所以这里断言的是「服务确实去查了卡」。
  const pool = fakePool({ cardRows: [{ id: 'card-uuid-from-lookup' }] });
  const result = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: '5276',
    balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: 16,
  });
  assert.equal(result.recorded, true);
  assert.equal(pool.lookups.length, 1);
  assert.match(pool.lookups[0].sql, /SELECT id FROM cards/);
  assert.deepEqual(pool.lookups[0].params, [ACCOUNT, '5276']);
  assert.equal(pool.queries[0].params[0], 'card-uuid-from-lookup', '写入用的是查出来的那个 id');
});

test('recordIssueFee: 卡台开出来的卡还没入库时不写', async () => {
  const pool = fakePool({ cardRows: [] });
  const result = await recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: 'not-registered-yet',
    balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: 16,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'CARD_NOT_FOUND_IN_INVENTORY');
  assert.equal(pool.queries.length, 0);
});

test('recordIssueFee: 写库出错时回滚并抛出，由调用方兜住', async () => {
  const pool = fakePool();
  const connection = await pool.getConnection();
  connection.query = async () => { const e = new Error('boom'); e.code = 'ER_LOCK_DEADLOCK'; throw e; };
  await assert.rejects(recordIssueFee(pool, {
    providerAccountId: ACCOUNT, providerCardId: 'x',
    balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: 16,
  }), (error) => error.code === 'ER_LOCK_DEADLOCK');
  assert.equal(pool.rolledBack, true);
});
