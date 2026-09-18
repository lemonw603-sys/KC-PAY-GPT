import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChargeKind, classifyCharge, countsAsCharge, isChargeback, isChargebackFee
} from '../src/domain/card-transaction-audit.js';
import {
  AmountFinding, CountFinding, fingerprintOf, isRealDiscrepancy, reconcileCard, summaryMessage
} from '../src/services/daily-reconciliation-service.js';

// 下面每一行的形状都抄自 2026-09-18 生产 `card_transactions` 的真实行，不是自造的。
const rows = {
  hnskjLowerSuccess: { transaction_type: 'purchase', status: 'success', amount: '-15.970000', currency: 'USD', merchant_name: 'OPENAI' },
  hnskjUpperSettled: { transaction_type: 'PURCHASE', status: 'SETTLED', amount: '15.710000', currency: 'USD', merchant_name: 'OPENAI' },
  hnskjUpperSuccess: { transaction_type: 'PURCHASE', status: 'SUCCESS', amount: '15.930000', currency: 'USD', merchant_name: 'OPENAI *CHATGPT SUBSCR' },
  hnskjFailed: { transaction_type: 'purchase', status: 'failed', amount: '-78.240000', currency: 'USD' },
  highvccComplete: { transaction_type: 'PURCHASE', status: 'COMPLETE', amount: '15.750000', currency: 'USD', merchant_name: 'OPENAI' },
  highvccPendingReal: { transaction_type: 'PURCHASE', status: 'PENDING', amount: '142.540000', currency: 'USD', merchant_name: 'OPENAI *CHATGPT SUBSCR' },
  highvccPendingZero: { transaction_type: 'PURCHASE', status: 'PENDING', amount: '0.000000', currency: 'USD', merchant_name: 'OPENAI' },
  anthropic: { transaction_type: 'PURCHASE', status: 'COMPLETE', amount: '100.000000', currency: 'USD', merchant_name: 'ANTHROPIC* CLAUDE SUB' },
  chargeback: { transaction_type: 'chargeback', status: '平台监控已登记拒付', amount: '76.000000', currency: 'USD' },
  chargebackFee: { transaction_type: 'chargeback_fee', status: '已扣账户余额', amount: '0.400000', currency: 'USD' },
  recharge: { transaction_type: 'card_recharge', status: 'success', amount: '50.000000', currency: 'USD' },
  issueFee: { transaction_type: 'CARD_ISSUE_FEE', status: 'OBSERVED', amount: '0.750000', currency: 'USD' },
  unknownStatus: { transaction_type: 'PURCHASE', status: 'SOMETHING_NEW', amount: '15.750000', currency: 'USD' }
};

test('旧判据漏掉的那三种，现在都算扣款', () => {
  assert.equal(classifyCharge(rows.hnskjUpperSettled), ChargeKind.SETTLED);
  assert.equal(classifyCharge(rows.highvccComplete), ChargeKind.SETTLED);
  assert.equal(classifyCharge(rows.highvccPendingReal), ChargeKind.PENDING);
});

test('负号不影响判定——符号不统一是卡台的事实，对账比绝对值', () => {
  assert.equal(classifyCharge(rows.hnskjLowerSuccess), ChargeKind.SETTLED);
  assert.equal(countsAsCharge(rows.hnskjLowerSuccess), true);
});

test('failed 不算扣款，0 元授权不算扣款', () => {
  assert.equal(classifyCharge(rows.hnskjFailed), ChargeKind.NOT_A_CHARGE);
  assert.equal(classifyCharge(rows.highvccPendingZero), ChargeKind.ZERO_AUTH);
  assert.equal(countsAsCharge(rows.highvccPendingZero), false);
});

test('没见过的状态归 UNKNOWN_STATUS，不静默丢掉也不当成功', () => {
  assert.equal(classifyCharge(rows.unknownStatus), ChargeKind.UNKNOWN_STATUS);
  assert.equal(countsAsCharge(rows.unknownStatus), false);
});

test('非购买类流水不会混进扣款计数', () => {
  for (const row of [rows.chargeback, rows.chargebackFee, rows.recharge, rows.issueFee]) {
    assert.equal(countsAsCharge(row), false);
  }
  assert.equal(isChargeback(rows.chargeback), true);
  assert.equal(isChargebackFee(rows.chargebackFee), true);
});

test('判据不认商户名：ANTHROPIC 的扣款一样算扣款', () => {
  // 0237 卡上真有一笔 ANTHROPIC 100.00。把 OPENAI 写进判据会让它凭空消失。
  assert.equal(countsAsCharge(rows.anthropic), true);
});

const card = (over = {}) => ({
  id: 'card-1', last4: '1657', provider_card_id: 'HG81', provider_account_id: '…103',
  inventory_status: 'AVAILABLE', funded_amount: '50.000000', current_balance: '2.80000',
  last_synced_at: '2026-09-18 07:00:00', ...over
});

test('次数对上、金额对上 = MATCHED', () => {
  const result = reconcileCard({
    card: card({ funded_amount: '50.000000', current_balance: '2.750000' }),
    transactions: [rows.highvccComplete, rows.highvccComplete, rows.highvccComplete],
    ledgerConsumed: 3
  });
  assert.equal(result.count.finding, CountFinding.MATCHED);
  assert.equal(result.amount.finding, AmountFinding.MATCHED);
  assert.equal(isRealDiscrepancy(result.count.finding), false);
});

test('卡台扣了、账本没记 → 待登记，不算差异（3336 那笔手动 20X）', () => {
  const result = reconcileCard({
    card: card({ last4: '3336', funded_amount: '145.000000', current_balance: '2.460000' }),
    transactions: [rows.highvccPendingReal],
    ledgerConsumed: 0
  });
  assert.equal(result.count.finding, CountFinding.PENDING_MANUAL_REGISTRATION);
  assert.equal(isRealDiscrepancy(result.count.finding), false);
  assert.equal(result.amount.finding, AmountFinding.MATCHED, '145 − 142.54 = 2.46，正好对上');
  assert.equal(result.count.pending, 1);
});

test('账本比卡台多 → 真差异（反向缺口，要人看）', () => {
  const result = reconcileCard({
    card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 3
  });
  assert.equal(result.count.finding, CountFinding.LEDGER_AHEAD);
  assert.equal(isRealDiscrepancy(result.count.finding), true);
});

test('有没见过的状态时，先报状态本身，别忙着比数字', () => {
  const result = reconcileCard({
    card: card(), transactions: [rows.unknownStatus, rows.highvccComplete], ledgerConsumed: 1
  });
  assert.equal(result.count.finding, CountFinding.UNKNOWN_STATUS);
  assert.equal(result.count.unknownStatus, 1);
});

test('开卡金额比扣款合计还小 → 公式立不起来，如实标出而不是硬算差异', () => {
  // 5501 的真实数字：funded 2.00，扣款合计 159.16。
  const result = reconcileCard({
    card: card({ last4: '5501', funded_amount: '2.000000', current_balance: '1.790000' }),
    transactions: [rows.highvccComplete, rows.highvccPendingReal],
    ledgerConsumed: 2
  });
  assert.equal(result.amount.finding, AmountFinding.FUNDING_SOURCE_INCOMPLETE);
  assert.equal(isRealDiscrepancy(result.amount.finding), false);
});

test('一行流水都没有 → 没东西可对，不算差异', () => {
  const result = reconcileCard({ card: card(), transactions: [], ledgerConsumed: 0 });
  assert.equal(result.amount.finding, AmountFinding.NO_TRANSACTION_COVERAGE);
});

test('拒付与手续费计入花掉的钱，但不计入购买次数', () => {
  const result = reconcileCard({
    card: card({ last4: '1652', funded_amount: '100.000000', current_balance: '0.000000' }),
    transactions: [rows.hnskjUpperSettled, rows.chargeback, rows.chargebackFee],
    ledgerConsumed: 1
  });
  assert.equal(result.count.providerCharges, 1);
  assert.equal(result.amount.chargebacks, '76.40');
  assert.equal(result.amount.charged, '15.71');
});

test('金额对不上就是对不上，差额如实给出', () => {
  const result = reconcileCard({
    card: card({ funded_amount: '50.000000', current_balance: '1.800000' }),
    transactions: [rows.highvccComplete, rows.highvccComplete, rows.highvccComplete],
    ledgerConsumed: 3
  });
  assert.equal(result.amount.finding, AmountFinding.AMOUNT_DIFF);
  assert.equal(result.amount.expected, '2.75');
  assert.equal(result.amount.delta, '-0.95');
  assert.equal(isRealDiscrepancy(result.amount.finding), true);
});

test('指纹按「卡 + 两个结论」定，用来判断连续两次是不是同一个差异', () => {
  const a = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 3 });
  const b = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 3 });
  assert.equal(fingerprintOf(a), fingerprintOf(b));
  const c = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 0 });
  assert.notEqual(fingerprintOf(a), fingerprintOf(c));
});

test('汇总文案：待销到期并进这一条，不单推（Lemon 2026-09-18 定）', () => {
  const message = summaryMessage({
    cardCount: 16, discrepancyCount: 2, persistentCount: 1,
    pendingRegistrationCount: 3, fundingIncompleteCount: 4, retirementDueCount: 5
  });
  assert.match(message, /对账 16 张卡：差异 2 张/);
  assert.match(message, /连续两天还在/);
  assert.match(message, /待销到期 5 张/);
});

test('风平浪静那天的汇总也是一句话读完', () => {
  const message = summaryMessage({
    cardCount: 16, discrepancyCount: 0, persistentCount: 0,
    pendingRegistrationCount: 0, fundingIncompleteCount: 0, retirementDueCount: 0
  });
  assert.match(message, /差异 0 张/);
  assert.match(message, /待销到期 0 张/);
  assert.doesNotMatch(message, /连续两天/);
});

test('已作废的卡不做金额对账——余额被清零，公式不适用（生产 7 条假差异的来源）', () => {
  const result = reconcileCard({
    card: card({ last4: '1013', inventory_status: 'RETIRED', funded_amount: '16.000000', current_balance: '0.000000' }),
    transactions: [rows.hnskjUpperSettled],
    ledgerConsumed: 1
  });
  assert.equal(result.amount.finding, AmountFinding.CARD_IN_TERMINAL_STATE);
  assert.equal(isRealDiscrepancy(result.amount.finding), false);
});

test('账本里的 RECONCILIATION 占位不是消费，不该报成「账本多于卡台」', () => {
  // 1013 / 4643 的真实形态：账本一行 RECONCILIATION，卡台零笔扣款——付款未知、资金锁着。
  const result = reconcileCard({
    card: card({ last4: '4643', inventory_status: 'RETIRED' }),
    transactions: [],
    ledgerConsumed: 0, ledgerReconciliation: 1
  });
  assert.equal(result.count.finding, CountFinding.AWAITING_RESOLUTION);
  assert.equal(isRealDiscrepancy(result.count.finding), false);
  assert.equal(result.count.ledgerConsumed, 0);
  assert.equal(result.count.ledgerReconciliation, 1);
});

test('确认消费真的多于卡台扣款时，仍然报 LEDGER_AHEAD', () => {
  const result = reconcileCard({
    card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 2, ledgerReconciliation: 1
  });
  assert.equal(result.count.finding, CountFinding.LEDGER_AHEAD);
});
