import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, fromCents, maxPlausibleFeeCents, computeIssueFee, issueFeeTransactionId,
} from '../src/domain/card-issue-fee.js';

test('toCents / fromCents: 定点往返，不走浮点', () => {
  assert.equal(toCents('106.06'), 10606);
  assert.equal(toCents('89.48'), 8948);
  assert.equal(toCents('16'), 1600);
  assert.equal(toCents('0.58'), 58);
  assert.equal(toCents('-1.50'), -150);
  assert.equal(fromCents(58), '0.58');
  assert.equal(fromCents(0), '0.00');
  assert.equal(fromCents(-150), '-1.50');
  assert.equal(fromCents(16580), '165.80');
});

test('toCents: 读不懂的值返回 null，不猜也不四舍五入', () => {
  for (const bad of [null, undefined, '', 'abc', '1.2.3', '1,000.00']) assert.equal(toCents(bad), null);
  // 第三位小数非 0：说明读到的不是我以为的那个东西，宁可算不出。
  assert.equal(toCents('16.001'), null);
  assert.equal(toCents('16.000'), 1600, '尾数是 0 则无歧义，照收');
});

test('computeIssueFee: 生产实测样本 —— 开卡 $16，余额 106.06→89.48，成本 $0.58', () => {
  // 2026-09-17 01:34 那次开卡（5276）。相邻两条余额快照之间只有这一笔动账。
  const result = computeIssueFee({ balanceBefore: '106.06', balanceAfter: '89.48', openCardAmount: '16' });
  assert.equal(result.ok, true);
  assert.equal(result.fee, '0.58');
  assert.equal(result.spent, '16.58');
});

test('computeIssueFee: 另一个生产样本 —— 补值 $50 扣 50.25，成本 $0.25', () => {
  // 2026-09-14 08:42 给 1652 补值：121.77 → 71.52。同一个算法对补值也成立。
  const result = computeIssueFee({ balanceBefore: '121.77', balanceAfter: '71.52', openCardAmount: '50' });
  assert.equal(result.ok, true);
  assert.equal(result.fee, '0.25');
});

test('computeIssueFee: 费用为 0 也是有效结果（卡台免费开卡时不该报错）', () => {
  const result = computeIssueFee({ balanceBefore: '100.00', balanceAfter: '84.00', openCardAmount: '16' });
  assert.equal(result.ok, true);
  assert.equal(result.fee, '0.00');
});

test('computeIssueFee: 窗口内有人往账户充钱 → 认出污染，不写一个假数', () => {
  // 2026-09-14 06:57→07:02 真实发生过：那五分钟里账户被充值，余额不降反升。
  const richer = computeIssueFee({ balanceBefore: '18.25', balanceAfter: '121.77', openCardAmount: '16' });
  assert.equal(richer.ok, false);
  assert.equal(richer.reason, 'BALANCE_DID_NOT_DROP');

  // 扣的比开卡金额还少：也只可能是中途进了钱。
  const partial = computeIssueFee({ balanceBefore: '100.00', balanceAfter: '90.00', openCardAmount: '16' });
  assert.equal(partial.ok, false);
  assert.equal(partial.reason, 'SPENT_LESS_THAN_CARD_AMOUNT');
});

test('computeIssueFee: 差值大得离谱 → 多半混进了另一笔动账，标不可信', () => {
  // 开 $16 的卡却少了 $60：窗口里还有别的事发生。
  const result = computeIssueFee({ balanceBefore: '100.00', balanceAfter: '40.00', openCardAmount: '16' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'FEE_ABOVE_PLAUSIBLE_RANGE');
  assert.equal(result.fee, '44.00');
  assert.equal(result.limit, '2.60');
});

test('闸门宽度：小额卡的正常成本不能被误伤', () => {
  // 只用「金额的 10%」做上限时，$5 卡的正常成本（$0.50 开卡费 + 0.5%）就会超线被误判。
  // 所以上限是 10% 再加 $1 的底。
  assert.equal(maxPlausibleFeeCents(500), 150);
  const small = computeIssueFee({ balanceBefore: '50.00', balanceAfter: '44.47', openCardAmount: '5' });
  assert.equal(small.ok, true, '$5 卡的 $0.53 成本必须算得出来');
  assert.equal(small.fee, '0.53');

  // 大额卡（20X 的 $150）：成本约 0.50 + 0.75 = 1.25，闸门 16.00，绰绰有余。
  const large = computeIssueFee({ balanceBefore: '400.00', balanceAfter: '248.75', openCardAmount: '150' });
  assert.equal(large.ok, true);
  assert.equal(large.fee, '1.25');
});

test('computeIssueFee: 读不出来的输入一律 ok:false，不退化成 0', () => {
  assert.equal(computeIssueFee({ balanceBefore: null, balanceAfter: '1', openCardAmount: '16' }).reason, 'UNREADABLE_AMOUNTS');
  assert.equal(computeIssueFee({ balanceBefore: '1', balanceAfter: undefined, openCardAmount: '16' }).reason, 'UNREADABLE_AMOUNTS');
  assert.equal(computeIssueFee({ balanceBefore: '100', balanceAfter: '80', openCardAmount: '0' }).reason, 'INVALID_OPEN_CARD_AMOUNT');
  assert.equal(computeIssueFee({}).ok, false);
});

test('issueFeeTransactionId: 带 LOCAL_ 前缀，一眼看出不是卡台流水', () => {
  assert.equal(issueFeeTransactionId('5276'), 'LOCAL_ISSUE_FEE_5276');
  assert.equal(issueFeeTransactionId(''), null);
  assert.equal(issueFeeTransactionId(null), null);
});
