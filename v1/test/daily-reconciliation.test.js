import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChargeKind, classifyCharge, countsAsCharge, isChargeback, isChargebackFee
} from '../src/domain/card-transaction-audit.js';
import {
  AmountFinding, CountFinding, UnverifiableReason, fingerprintOf, isRealDiscrepancy,
  isCriticalEligibleFinding, inputVerified, reconcileCard, signedAmountCents, summaryMessage,
  createDailyReconciliationService, reconciliationAlertPlan, reconciliationAlertKey
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

// ————— 次数判据（domain/card-transaction-audit.js）：收窄没动这一半 —————

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
  assert.equal(countsAsCharge(rows.anthropic), true);
});

// ————— reconcileCard 次数侧 —————

const card = (over = {}) => ({
  id: 'card-1', last4: '1657', provider_card_id: 'HG81', provider_account_id: '…103',
  inventory_status: 'AVAILABLE', funded_amount: '50.000000', current_balance: '2.80000',
  last_synced_at: '2026-09-18 07:00:00', ...over
});

test('次数对上 = MATCHED', () => {
  const result = reconcileCard({
    card: card(), transactions: [rows.highvccComplete, rows.highvccComplete, rows.highvccComplete], ledgerConsumed: 3
  });
  assert.equal(result.count.finding, CountFinding.MATCHED);
});

test('反例 一单两笔扣款（F-48）：没登记手动用卡 → 无主扣款差异，不再被隐藏成「待登记」', () => {
  const tx = rows.highvccComplete;
  const result = reconcileCard({ card: card(), transactions: [tx, { ...tx }], ledgerConsumed: 1 });
  assert.equal(result.count.finding, CountFinding.UNEXPLAINED_CHARGE);
  assert.equal(isRealDiscrepancy(result.count.finding), true, '无主扣款是差异、进报告、不隐藏');
});

test('反例 一单两笔扣款（F-48）：登记了手动用卡（3336 那类）→ 待登记、不算差异', () => {
  const tx = rows.highvccComplete;
  const result = reconcileCard({ card: card(), transactions: [tx, { ...tx }], ledgerConsumed: 1, manualUseRegistered: true });
  assert.equal(result.count.finding, CountFinding.PENDING_MANUAL_REGISTRATION);
  assert.equal(isRealDiscrepancy(result.count.finding), false);
});

test('账本比卡台多 → LEDGER_AHEAD（真差异，够格升级）', () => {
  const result = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 3 });
  assert.equal(result.count.finding, CountFinding.LEDGER_AHEAD);
  assert.equal(isRealDiscrepancy(result.count.finding), true);
});

test('有没见过的状态时，先报状态本身（UNKNOWN_STATUS）', () => {
  const result = reconcileCard({ card: card(), transactions: [rows.unknownStatus, rows.highvccComplete], ledgerConsumed: 1 });
  assert.equal(result.count.finding, CountFinding.UNKNOWN_STATUS);
  assert.equal(result.count.unknownStatus, 1);
});

test('账本里的 RECONCILIATION 占位不是消费，不该报成「账本多于卡台」', () => {
  const result = reconcileCard({
    card: card({ last4: '4643', inventory_status: 'RETIRED' }),
    transactions: [], ledgerConsumed: 0, ledgerReconciliation: 1
  });
  assert.equal(result.count.finding, CountFinding.AWAITING_RESOLUTION);
  assert.equal(isRealDiscrepancy(result.count.finding), false);
});

test('确认消费真的多于卡台扣款时，仍然报 LEDGER_AHEAD', () => {
  const result = reconcileCard({
    card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 2, ledgerReconciliation: 1
  });
  assert.equal(result.count.finding, CountFinding.LEDGER_AHEAD);
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

// ————— reconcileCard 金额侧：收窄成「无法核对」（D-275 ①，F-49/F-53）—————

test('金额默认无法核对：没有可验证期初余额就不判异常也不判一致', () => {
  const result = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 1 });
  assert.equal(result.amount.finding, AmountFinding.UNVERIFIABLE);
  assert.equal(result.amount.unverifiableReason, UnverifiableReason.NO_VERIFIABLE_BASELINE);
  assert.equal(result.amount.expected, null);
  assert.equal(result.amount.delta, null);
  assert.equal(isRealDiscrepancy(result.amount.finding), false);
});

test('反例 消费后导入（F-49）：funded 是下单额不是入卡额 → 金额无法核对（不硬算假差异）', () => {
  // 首次导入余额 40、导入前已消费 10、之后无变化：旧算法会拿 funded 再扣那 10 报假差异。
  const result = reconcileCard({
    card: card({ last4: '1657', funded_amount: '50.000000', current_balance: '1.800000' }),
    transactions: [rows.highvccComplete, rows.highvccComplete, rows.highvccComplete],
    ledgerConsumed: 3
  });
  assert.equal(result.amount.finding, AmountFinding.UNVERIFIABLE);
  assert.equal(result.amount.unverifiableReason, UnverifiableReason.NO_VERIFIABLE_BASELINE);
  assert.equal(isRealDiscrepancy(result.amount.finding), false);
});

test('反例 负余额（F-53）：余额有符号解析、明确标未知，不 abs 成「正好对上」', () => {
  const result = reconcileCard({
    card: card({ funded_amount: '50.000000', current_balance: '-10.000000' }),
    transactions: [{ ...rows.highvccComplete, amount: '40.000000' }],
    ledgerConsumed: 1
  });
  assert.equal(result.amount.finding, AmountFinding.UNVERIFIABLE);
  assert.equal(result.amount.unverifiableReason, UnverifiableReason.NEGATIVE_BALANCE);
  assert.equal(result.amount.balance, '-10.00', '余额保留负号，不取绝对值');
  assert.equal(result.amount.expected, null);
});

test('余额读不出 → 无法核对（UNREADABLE_BALANCE）', () => {
  const result = reconcileCard({ card: card({ current_balance: null }), transactions: [rows.highvccComplete], ledgerConsumed: 1 });
  assert.equal(result.amount.finding, AmountFinding.UNVERIFIABLE);
  assert.equal(result.amount.unverifiableReason, UnverifiableReason.UNREADABLE_BALANCE);
});

test('作废卡也走无法核对（不再单列 CARD_IN_TERMINAL_STATE，余额清零无基准）', () => {
  const result = reconcileCard({
    card: card({ last4: '1013', inventory_status: 'RETIRED', funded_amount: '16.000000', current_balance: '0.000000' }),
    transactions: [rows.hnskjUpperSettled], ledgerConsumed: 1
  });
  assert.equal(result.amount.finding, AmountFinding.UNVERIFIABLE);
  assert.equal(isRealDiscrepancy(result.amount.finding), false);
});

test('给了可验证期初基准的卡：对得上 → MATCHED', () => {
  const result = reconcileCard({
    card: card({ funded_amount: '50.000000', current_balance: '2.750000' }),
    transactions: [rows.highvccComplete, rows.highvccComplete, rows.highvccComplete],
    ledgerConsumed: 3, verifiableBaselineCents: 5000
  });
  assert.equal(result.amount.finding, AmountFinding.MATCHED);
  assert.equal(result.amount.delta, '0.00');
});

test('给了可验证期初基准的卡：对不上 → AMOUNT_DIFF（真差异）', () => {
  const result = reconcileCard({
    card: card({ funded_amount: '50.000000', current_balance: '1.800000' }),
    transactions: [rows.highvccComplete, rows.highvccComplete, rows.highvccComplete],
    ledgerConsumed: 3, verifiableBaselineCents: 5000
  });
  assert.equal(result.amount.finding, AmountFinding.AMOUNT_DIFF);
  assert.equal(result.amount.expected, '2.75');
  assert.equal(result.amount.delta, '-0.95');
  assert.equal(isRealDiscrepancy(result.amount.finding), true);
});

test('signedAmountCents：负数保留符号、读不出返回 null（F-53 的解析基元）', () => {
  assert.equal(signedAmountCents('-10'), -1000);
  assert.equal(signedAmountCents('2.46'), 246);
  assert.equal(signedAmountCents(''), null);
  assert.equal(signedAmountCents('abc'), null);
});

test('isCriticalEligibleFinding：无主扣款/待登记/无法核对不够格升级；真差异够格', () => {
  assert.equal(isCriticalEligibleFinding(CountFinding.UNEXPLAINED_CHARGE), false);
  assert.equal(isCriticalEligibleFinding(CountFinding.PENDING_MANUAL_REGISTRATION), false);
  assert.equal(isCriticalEligibleFinding(AmountFinding.UNVERIFIABLE), false);
  assert.equal(isCriticalEligibleFinding(CountFinding.LEDGER_AHEAD), true);
  assert.equal(isCriticalEligibleFinding(AmountFinding.AMOUNT_DIFF), true);
  assert.equal(isCriticalEligibleFinding(CountFinding.UNKNOWN_STATUS), true);
});

test('指纹按「卡 + 两个结论」定，用来判断连续两次是不是同一个差异', () => {
  const a = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 3 });
  const b = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 3 });
  assert.equal(fingerprintOf(a), fingerprintOf(b));
  const c = reconcileCard({ card: card(), transactions: [rows.highvccComplete], ledgerConsumed: 0 });
  assert.notEqual(fingerprintOf(a), fingerprintOf(c));
});

// ————— 「连续两次」只由正式批次推进（D-275 ③，F-50/F-51）—————

function reconServicePool({ cards = [], transactions = [], lastReport = null }) {
  let stored = lastReport;
  return {
    stored: () => stored,
    async query(sql, args = []) {
      if (sql.includes('SELECT c.id, c.last4')) return [cards];
      if (sql.includes('SELECT card_id, provider_transaction_id')) return [transactions];
      if (sql.includes('SELECT setting_value FROM app_settings')) {
        return [stored ? [{ setting_value: JSON.stringify(stored) }] : []];
      }
      if (sql.includes('INSERT INTO app_settings')) { stored = JSON.parse(args[1]); return [{ affectedRows: 1 }]; }
      if (sql.includes('SELECT c.id, c.provider_account_id') || sql.includes('FROM card_state_events')) return [[]];
      throw new Error('unexpected sql: ' + sql.slice(0, 60));
    }
  };
}

const ledgerAheadCard = (over = {}) => ({
  id: 'c1', last4: '9001', provider_account_id: 'a', funded_amount: '50', current_balance: '34',
  inventory_status: 'AVAILABLE', sync_tier: 'LEGACY', sync_consecutive_failures: 0,
  ledger_consumed: 3, ledger_reconciliation: 0, manual_use_registered: 0, ...over
});
const oneCharge = [{ card_id: 'c1', transaction_type: 'PURCHASE', status: 'COMPLETE', amount: '15', currency: 'USD' }];

test('反例 首跑后立即只读 GET（F-50）：只读不推进「连续两次」', async () => {
  const pool = reconServicePool({ cards: [ledgerAheadCard()], transactions: oneCharge });
  const svc = createDailyReconciliationService({ pool, clock: () => new Date('2026-09-18T04:00:00Z') });
  const first = await svc.run({ persist: true });
  assert.equal(first.persistentCount, 0);
  for (let i = 0; i < 3; i++) {
    const ro = await svc.run({ persist: false });
    assert.equal(ro.persistentCount, 0, '只读 GET 不能把当次差异当成第二次出现');
  }
});

test('首跑后只读 GET 的跨日版：只读不推进（F-50 补充）', async () => {
  const pool = reconServicePool({ cards: [ledgerAheadCard()], transactions: oneCharge });
  await createDailyReconciliationService({ pool, clock: () => new Date('2026-09-18T04:00:00Z') }).run({ persist: true });
  const r = await createDailyReconciliationService({ pool, clock: () => new Date('2026-09-19T04:00:00Z') }).run({ persist: false });
  assert.equal(r.persistentCount, 0, '只读不推进，即使跨日');
});

test('反例 同步失败跨日（F-51/F-58）：正式 timer 面对输入存疑的卡，连续两天也不自动升级', async () => {
  // 真实 timer 路径是 persist:true。同步失败时 sync_consecutive_failures>0（hnskj），或 MANUAL_IMPORT
  // 无成功水位（highvcc）——两天都拿同一份旧数据，不能当成两次有效核验。旧版单测把次日设 persist:false
  // 绕开了这条路径（F-58），这里用真实 persist:true 覆盖。
  const staleHnskj = ledgerAheadCard({ sync_consecutive_failures: 3 });
  const poolA = reconServicePool({ cards: [staleHnskj], transactions: oneCharge });
  await createDailyReconciliationService({ pool: poolA, clock: () => new Date('2026-09-18T04:00:00Z') }).run({ persist: true });
  const a = await createDailyReconciliationService({ pool: poolA, clock: () => new Date('2026-09-19T04:00:00Z') }).run({ persist: true });
  assert.equal(a.persistentCount, 0, '同步连续失败：正式 timer 也不升级');
  assert.equal(a.inputUnverifiedCount, 1, '进报告、标输入存疑');

  const highvcc = ledgerAheadCard({ sync_tier: 'MANUAL_IMPORT', sync_consecutive_failures: 0 });
  const poolB = reconServicePool({ cards: [highvcc], transactions: oneCharge });
  await createDailyReconciliationService({ pool: poolB, clock: () => new Date('2026-09-18T04:00:00Z') }).run({ persist: true });
  const b = await createDailyReconciliationService({ pool: poolB, clock: () => new Date('2026-09-19T04:00:00Z') }).run({ persist: true });
  assert.equal(b.persistentCount, 0, 'MANUAL_IMPORT 无成功水位：正式 timer 也不升级');
});

test('inputVerified：MANUAL_IMPORT 与连续失败判存疑，正常 hnskj 判可信（F-51）', () => {
  assert.equal(inputVerified({ sync_tier: 'MANUAL_IMPORT', sync_consecutive_failures: 0 }), false);
  assert.equal(inputVerified({ sync_tier: 'LEGACY', sync_consecutive_failures: 2 }), false);
  assert.equal(inputVerified({ sync_tier: 'LEGACY', sync_consecutive_failures: 0 }), true);
});

test('连续两次由正式批次推进：够格差异连续两个正式批次 → 升 critical', async () => {
  const pool = reconServicePool({ cards: [ledgerAheadCard()], transactions: oneCharge });
  const r0 = await createDailyReconciliationService({ pool, clock: () => new Date('2026-09-18T04:00:00Z') }).run({ persist: true });
  assert.equal(r0.persistentCount, 0);
  const r1 = await createDailyReconciliationService({ pool, clock: () => new Date('2026-09-19T04:00:00Z') }).run({ persist: true });
  assert.equal(r1.persistentCount, 1);
});

test('同日重跑正式批次幂等：不把当天的差异错当成连续两天', async () => {
  const pool = reconServicePool({ cards: [ledgerAheadCard()], transactions: oneCharge });
  const clock = () => new Date('2026-09-18T04:00:00Z');
  const r1 = await createDailyReconciliationService({ pool, clock }).run({ persist: true });
  const r2 = await createDailyReconciliationService({ pool, clock }).run({ persist: true });
  assert.equal(r1.persistentCount, 0);
  assert.equal(r2.persistentCount, 0, '同一天第二个正式批次不推进连续性');
});

test('无主扣款连续两天也不升 critical（D-275 ②：进报告但先不升级）', async () => {
  const cards = [{ id: 'c1', last4: '8590', provider_account_id: 'a', funded_amount: '16', current_balance: '0.03',
    inventory_status: 'AVAILABLE', ledger_consumed: 0, ledger_reconciliation: 0, manual_use_registered: 0 }];
  const transactions = [{ card_id: 'c1', transaction_type: 'PURCHASE', status: 'COMPLETE', amount: '15.97', currency: 'USD' }];
  const pool = reconServicePool({ cards, transactions });
  const r0 = await createDailyReconciliationService({ pool, clock: () => new Date('2026-09-18T04:00:00Z') }).run({ persist: true });
  assert.equal(r0.unexplainedChargeCount, 1);
  assert.equal(r0.discrepancyCount, 1);
  const r1 = await createDailyReconciliationService({ pool, clock: () => new Date('2026-09-19T04:00:00Z') }).run({ persist: true });
  assert.equal(r1.discrepancyCount, 1);
  assert.equal(r1.persistentCount, 0, '无主扣款不进 critical 升级');
});

test('service 级：已登记手动用卡 → 待登记（不算差异）；没登记 → 无主扣款差异', async () => {
  const registered = reconServicePool({
    cards: [{ id: 'c1', last4: '3336', provider_account_id: 'a', funded_amount: '145', current_balance: '2.46',
      inventory_status: 'RETIRED', ledger_consumed: 0, ledger_reconciliation: 0, manual_use_registered: 1 }],
    transactions: [{ card_id: 'c1', transaction_type: 'PURCHASE', status: 'PENDING', amount: '142.54', currency: 'USD', merchant_name: 'OPENAI' }]
  });
  const r = await createDailyReconciliationService({ pool: registered, clock: () => new Date('2026-09-18T04:00:00Z') }).run({ persist: true });
  assert.equal(r.pendingRegistrationCount, 1);
  assert.equal(r.unexplainedChargeCount, 0);
  assert.equal(r.discrepancyCount, 0);
});

// ————— 汇总文案与告警计划 —————

test('汇总文案：待销到期并进这一条；无主扣款 / 无法核对分列（D-275）', () => {
  const message = summaryMessage({
    cardCount: 16, discrepancyCount: 2, persistentCount: 1,
    pendingRegistrationCount: 1, unexplainedChargeCount: 2, unverifiableAmountCount: 4, retirementDueCount: 5
  });
  assert.match(message, /对账 16 张卡：差异 2 张/);
  assert.match(message, /连续两天还在/);
  assert.match(message, /无主扣款 2 张/);
  assert.match(message, /金额无法核对 4 张/);
  assert.match(message, /待销到期 5 张/);
});

test('风平浪静那天的汇总也是一句话读完', () => {
  const message = summaryMessage({
    cardCount: 16, discrepancyCount: 0, persistentCount: 0,
    pendingRegistrationCount: 0, unexplainedChargeCount: 0, unverifiableAmountCount: 0, retirementDueCount: 0
  });
  assert.match(message, /差异 0 张/);
  assert.match(message, /待销到期 0 张/);
  assert.doesNotMatch(message, /连续两天/);
});

test('反例 异常次日恢复（F-54/F-56/F-59）：按天 key + 每次收掉除今天外的历史日报', () => {
  const base = {
    cardCount: 1, persistentCount: 0, pendingRegistrationCount: 0,
    unexplainedChargeCount: 0, unverifiableAmountCount: 0, inputUnverifiedCount: 0, retirementDueCount: 0
  };
  const day18 = reconciliationAlertPlan({ ...base, discrepancyCount: 1, reconciliationDate: '2026-09-18' });
  assert.equal(day18.action, 'upsert');
  assert.equal(day18.key, reconciliationAlertKey('2026-09-18'));
  assert.equal(day18.historyLike, 'daily-reconciliation%');

  // 次日持续差异升 critical：新 key → 新通知行 → 能重推到手机（F-56，固定 key 会只推一次）。
  const day19 = reconciliationAlertPlan({ ...base, discrepancyCount: 1, persistentCount: 1, reconciliationDate: '2026-09-19' });
  assert.equal(day19.key, reconciliationAlertKey('2026-09-19'));
  assert.notEqual(day19.key, day18.key);
  assert.equal(day19.severity, 'critical');

  // 无内容那天：连今天的也 resolve；runner 再用 historyLike 收掉昨天与生产遗留旧 key（F-54/F-59）。
  const clean = reconciliationAlertPlan({ ...base, discrepancyCount: 0, reconciliationDate: '2026-09-20' });
  assert.equal(clean.action, 'resolve');
  assert.equal(clean.historyLike, 'daily-reconciliation%');
});

test('reconciliationAlertPlan：够格差异连续两天 → critical；只有无主扣款 → info', () => {
  const critical = reconciliationAlertPlan({
    cardCount: 1, discrepancyCount: 1, persistentCount: 1, pendingRegistrationCount: 0,
    unexplainedChargeCount: 0, unverifiableAmountCount: 0, retirementDueCount: 0, reconciliationDate: '2026-09-19'
  });
  assert.equal(critical.severity, 'critical');
  const info = reconciliationAlertPlan({
    cardCount: 1, discrepancyCount: 1, persistentCount: 0, pendingRegistrationCount: 0,
    unexplainedChargeCount: 1, unverifiableAmountCount: 0, retirementDueCount: 0, reconciliationDate: '2026-09-18'
  });
  assert.equal(info.severity, 'info');
});
