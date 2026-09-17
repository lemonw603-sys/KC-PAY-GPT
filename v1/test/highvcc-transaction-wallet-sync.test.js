import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centsToFixedString, toCardTransactionRow, createHighvccSnapshotSyncService,
} from '../src/services/highvcc-snapshot-sync-service.js';

// 夹具是 2026-09-17 15:0x UTC 对生产 highvcc 账户 103 拉到的真实响应里的行（22 笔中取样），
// 只把 cardAuthId 换成同形状的值。字段名/类型/取值都没有改：
//   status 实见 COMPLETE 与 PENDING 两种；unit 实见 'USD'；merchantCurrency 实见 'PHP' 与 'USD'；
//   merchantCountry 实见 'US' 与 null；tags 实见 null（不是数组）；amount/merchantAmount 是整数分。
// 不用自造形状当外部合同（D-172 惯犯 3：曾把 cardNo 同时写进代码与夹具，真实字段是 lastFour，
// 测试全绿而功能恒不生效）。
const realCompleteRow = {
  cardAuthId: 'BLU_543274_1e9d53b2-641f-4e47-beff-9f05e6ea08d0',
  amount: 1575,
  cardId: 'HG81e125e48bc6475a9541b1080fb43bac',
  desc: 'OPENAI',
  cardSeqNo: 'HG81e125e48bc6475a9541b1080fb43bac',
  lastFour: '1657',
  tradeTime: 1789319532000,
  approveTime: 1789395556000,
  unit: 'USD',
  status: 'COMPLETE',
  reason: 'APPROVE',
  tags: null,
  merchantAmount: 98214,
  merchantCurrency: 'PHP',
  merchantCountry: 'US',
  tradeTimeEpochMs: 1789319532000,
  approveTimeEpochMs: 1789395556000,
};

// $0 的验证授权，merchantCountry 是 null —— 生产里真有两条这样的行。
const realZeroPendingRow = {
  cardAuthId: 'BLU_543177_2b192f42-fb13-43c8-9c6e-8969da97130e',
  amount: 0,
  cardId: 'HGf8d2bfe63fa6402cb7f93c60961029bb',
  desc: 'OPENAI                 SAN FRANCISCOCAUS',
  cardSeqNo: 'HGf8d2bfe63fa6402cb7f93c60961029bb',
  lastFour: '3336',
  tradeTime: 1789547884000,
  approveTime: 1789547884000,
  unit: 'USD',
  status: 'PENDING',
  reason: 'APPROVE',
  tags: null,
  merchantAmount: 0,
  merchantCurrency: 'USD',
  merchantCountry: null,
  tradeTimeEpochMs: 1789547884000,
  approveTimeEpochMs: 1789547884000,
};

test('centsToFixedString: 整数分 → 定点字符串，不走浮点', () => {
  assert.equal(centsToFixedString(1575), '15.75');
  assert.equal(centsToFixedString(0), '0.00');
  assert.equal(centsToFixedString(2368), '23.68');
  assert.equal(centsToFixedString(-1597), '-15.97');
  assert.equal(centsToFixedString(5), '0.05');
  assert.equal(centsToFixedString(94240), '942.40');
  for (const bad of [null, undefined, '', 'abc', 15.5, NaN]) assert.equal(centsToFixedString(bad), null);
});

test('toCardTransactionRow: 真实 COMPLETE 行映射到 card_transactions 的列', () => {
  const row = toCardTransactionRow(realCompleteRow);
  assert.equal(row.id, realCompleteRow.cardAuthId);
  assert.equal(row.type, 'PURCHASE');
  assert.equal(row.status, 'COMPLETE', '卡台的状态值原样存，不翻译成 success');
  assert.equal(row.amount, '15.75');
  assert.equal(row.currency, 'USD');
  assert.equal(row.fee, null, '这个接口没有手续费字段：null 表示卡台没给，不是 0');
  assert.equal(row.originalAmount, '982.14');
  assert.equal(row.originalCurrency, 'PHP');
  assert.equal(row.merchantName, 'OPENAI');
  assert.equal(row.merchantCountry, 'US');
  assert.equal(row.settlementStatus, 'APPROVE');
  assert.match(row.rawHash, /^[a-f0-9]{64}$/);
});

test('toCardTransactionRow: 时间戳直读 UTC，不做任何平移', () => {
  const row = toCardTransactionRow(realCompleteRow);
  // 1789319532000 直读就是 2026-09-13T17:12:12Z，对得上 G3Ni 那单 17:09:29 建仓、17:11:41 释放。
  // 任何 ±8 小时的平移都会让这条对账错位一整天的一半。
  assert.equal(row.tradeTime, '2026-09-13T17:12:12.000Z');
});

test('toCardTransactionRow: $0 验证授权与 null merchantCountry 都要能落库', () => {
  const row = toCardTransactionRow(realZeroPendingRow);
  assert.equal(row.amount, '0.00', '0 分是有效金额，不能被当成缺值丢掉');
  assert.equal(row.status, 'PENDING');
  assert.equal(row.merchantCountry, null);
  assert.equal(row.originalAmount, '0.00');
});

test('toCardTransactionRow: 分类算出来是 UNKNOWN，不会触发退款个案与告警', () => {
  // persistRefundCandidate 只对 REFUND_CANDIDATE 动作（插 refund_cases + operator_alerts +
  // 把卡标 REFUND_DETECTED）。授权流水一律不该走到那里。
  for (const source of [realCompleteRow, realZeroPendingRow]) {
    assert.equal(toCardTransactionRow(source).classification, 'UNKNOWN');
  }
});

test('toCardTransactionRow: 缺 id / 金额非整数分 / 币种不合法的行一律丢弃，不猜', () => {
  assert.equal(toCardTransactionRow({ ...realCompleteRow, cardAuthId: null }), null);
  assert.equal(toCardTransactionRow({ ...realCompleteRow, cardAuthId: '  ' }), null);
  assert.equal(toCardTransactionRow({ ...realCompleteRow, amount: '15.75' }), null);
  assert.equal(toCardTransactionRow({ ...realCompleteRow, unit: '' }), null);
  assert.equal(toCardTransactionRow({ ...realCompleteRow, unit: 'DOLLAR' }), null);
});

test('toCardTransactionRow: merchantCurrency 不合法时只丢这一个字段，不丢整行', () => {
  const row = toCardTransactionRow({ ...realCompleteRow, merchantCurrency: '' });
  assert.equal(row.originalCurrency, null);
  assert.equal(row.amount, '15.75', '主币种金额仍然要入库');
});

function serviceWith({ transactions = [], wallet = null, cards = [] }) {
  const commits = [];
  const snapshots = [];
  const pool = {
    async query(sql, params) {
      assert.match(sql, /FROM cards/);
      assert.deepEqual(params, ['00000000-0000-4000-8000-000000000103']);
      return [cards];
    },
    getConnection() { throw new Error('not used by these paths'); },
  };
  const service = createHighvccSnapshotSyncService({
    pool,
    encryptionKey: Buffer.alloc(32, 1),
    panHmacKey: Buffer.alloc(32, 2),
    provider: {
      allTransactions: async () => transactions,
      wallet: async () => wallet,
    },
    importService: { preview: async () => { throw new Error('not used'); }, commit: async () => { throw new Error('not used'); } },
    now: () => new Date('2026-09-17T15:30:00.000Z'),
    writeCardTransactions: async (_pool, input) => { commits.push(input); },
    writeBalanceSnapshot: async (_pool, input) => {
      snapshots.push(input);
      return { inserted: true, observedAt: input.observedAt.toISOString() };
    },
  });
  return { service, commits, snapshots };
}

test('syncTransactions: 按 cardId 归到 cards.external_card_id，一卡一次提交', async () => {
  const { service, commits } = serviceWith({
    transactions: [realCompleteRow, { ...realCompleteRow, cardAuthId: 'BLU_x_2' }, realZeroPendingRow],
    cards: [
      { id: 'card-1657', external_card_id: 'HG81e125e48bc6475a9541b1080fb43bac' },
      { id: 'card-3336', external_card_id: 'HGf8d2bfe63fa6402cb7f93c60961029bb' },
    ],
  });
  const result = await service.syncTransactions();

  assert.equal(result.fetched, 3);
  assert.equal(result.cardCount, 2);
  assert.equal(result.written, 3);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(commits.length, 2, '两张卡各提交一次，不是每条流水一个事务');
  const byCard = Object.fromEntries(commits.map((c) => [c.cardId, c]));
  assert.equal(byCard['card-1657'].transactions.length, 2);
  assert.equal(byCard['card-3336'].transactions.length, 1);
  assert.equal(byCard['card-1657'].cardSnapshot, null, '不得顺手改 cards.current_balance');
});

test('syncTransactions: 归不到卡的流水只报数，绝不按 lastFour 兜底猜', async () => {
  const { service, commits } = serviceWith({
    transactions: [realCompleteRow],
    // 库里有一张 lastFour 同样是 1657 的卡，但 external_card_id 不同。
    cards: [{ id: 'card-other', external_card_id: 'HG0000000000000000000000000000000' }],
  });
  const result = await service.syncTransactions();

  assert.equal(result.written, 0);
  assert.equal(commits.length, 0, 'lastFour 会重复，猜错就是把扣款记到别人卡上');
  assert.equal(result.unmatchedCount, 1);
  assert.deepEqual(result.unmatchedAuthIds, [realCompleteRow.cardAuthId]);
});

test('syncWallet: 只入可用余额；含义不明的 usdDeposit 不填进 pendingBalance', async () => {
  const { service, snapshots: calls } = serviceWith({
    // 生产实读：usdBalance 2368 分 = $23.68，usdDeposit 94240 分 = $942.40（含义卡台没说清）。
    wallet: { usdBalanceCents: 2368, usdDepositCents: 94240, usdConsumeCents: 0 },
  });
  const result = await service.syncWallet();

  assert.equal(result.availableBalance, '23.68');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerAccountId, '00000000-0000-4000-8000-000000000103');
  assert.equal(calls[0].currency, 'USD');
  assert.equal(calls[0].availableBalance, '23.68');
  assert.equal(calls[0].pendingBalance, null, 'usdDeposit 的业务含义未确认，不得当 pending 余额');
  assert.deepEqual(calls[0].rawPayload, { usdBalanceCents: 2368, usdDepositCents: 94240, usdConsumeCents: 0 });
});

test('syncWallet: 卡台没给可用余额时报错，不写一行 0 进去', async () => {
  const { service } = serviceWith({ wallet: { usdBalanceCents: null, usdDepositCents: 0, usdConsumeCents: 0 } });
  await assert.rejects(service.syncWallet(), (error) => error.code === 'HIGHVCC_WALLET_UNUSABLE');
});
