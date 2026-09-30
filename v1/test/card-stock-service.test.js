import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStockCardOperationalState,
  mapStockCard,
  summarizeStockCardOperationalState
} from '../src/services/card-stock-service.js';

test('maps a ready provider card into safe assignable stock', () => {
  const card = mapStockCard({ data: {
    id: 123,
    cardTypeId: 7,
    status: 'active',
    cardBalance: '16.00',
    currency: 'USD',
    cardNumber: '4242424242424242',
    cvv: '123',
    expiryMonth: 12,
    expiryYear: 2032
  } });
  assert.deepEqual(card, {
    providerCardId: '123',
    cardTypeId: '7',
    status: 'active',
    fundedAmount: null,
    currentBalance: '16',
    currency: 'USD',
    last4: '4242',
    credentials: {
      cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
    },
    ready: true,
    depleted: false,
    failed: false
  });
});

test('classifies an active underfunded card as depleted instead of available', () => {
  const card = mapStockCard({ data: {
    id: 'low-1', cardTypeId: '7', status: 'active', cardBalance: '0.02',
    cardNumber: '4242424242424242', cvv: '123', expiryMonth: 12, expiryYear: 2032
  } }, { minimumRequiredBalance: 15.5 });
  assert.equal(card.ready, false);
  assert.equal(card.depleted, true);
  assert.equal(card.failed, false);
});

test('keeps a newly opened but unreadable card in provisioning stock', () => {
  const card = mapStockCard({ data: {
    id: 'pending-1', cardTypeId: '7', status: 'provisioning'
  } }, { fundedAmount: 16 });
  assert.equal(card.ready, false);
  assert.equal(card.failed, false);
  assert.equal(card.credentials, null);
  assert.equal(card.currentBalance, null);
  assert.equal(card.fundedAmount, '16');
});

test('classifies a terminal provider card as failed stock', () => {
  const card = mapStockCard({ data: {
    id: 'failed-1', cardTypeId: '7', status: 'failed', cardBalance: '0'
  } }, { fundedAmount: 16 });
  assert.equal(card.ready, false);
  assert.equal(card.failed, true);
});

test('rejects stock without stable card identity and type', () => {
  assert.throws(() => mapStockCard({ data: { status: 'active' } }), /lacks provider card ID or card type ID/);
});

test('collapses card operations into four operator-facing categories', () => {
  assert.deepEqual(classifyStockCardOperationalState({
    effectiveInventoryStatus: 'AVAILABLE', isAllocatable: true
  }), { category: 'READY', reason: '可直接分配 Plus' });
  assert.deepEqual(classifyStockCardOperationalState({
    effectiveInventoryStatus: 'ASSIGNED', assigned: true, publicNo: 'PJV1-TEST'
  }), { category: 'IN_USE', reason: '已绑定订单 PJV1-TEST' });
  assert.deepEqual(classifyStockCardOperationalState({
    effectiveInventoryStatus: 'DEPLETED', reconciliationStatus: 'OK'
  }), { category: 'BLOCKED', reason: '余额不足，充值后可重新判定' });
  assert.deepEqual(classifyStockCardOperationalState({
    effectiveInventoryStatus: 'RETIRED', assigned: true
  }), { category: 'RETIRED', reason: '已永久停用，不参与分配' });
});

test('does not call a temporarily blocked card permanently unusable', () => {
  const productOnly = classifyStockCardOperationalState({
    effectiveInventoryStatus: 'PRODUCT_ONLY', allocationProductCode: 'claude'
  });
  const stale = classifyStockCardOperationalState({
    effectiveInventoryStatus: 'AVAILABLE', reconciliationStatus: 'STALE'
  });
  assert.deepEqual(productOnly, { category: 'BLOCKED', reason: '仅限 claude' });
  assert.deepEqual(stale, { category: 'BLOCKED', reason: '等待只读同步' });
});

test('operational summary includes provider-only cards shown in the same list', () => {
  assert.deepEqual(summarizeStockCardOperationalState([
    { category: 'READY' },
    { category: 'IN_USE' },
    { category: 'BLOCKED' },
    { category: 'BLOCKED', effectiveInventoryStatus: 'PRODUCT_ONLY', externalOnly: true },
    { category: 'RETIRED' },
    { category: 'RETIRED', externalOnly: true }
  ]), { ready: 1, inUse: 1, blocked: 1, retired: 2 });
});

// D-405：卡片页「暂不可用」写具体原因——用分卡资格同一份条件逐条算，只写最关键的一条。
test('D-405 blocked reason: the most decisive failing check, in plain words, from the shared eligibility checks', async () => {
  const { blockedReasonText, classifyStockCardOperationalState } = await import('../src/services/card-stock-service.js');
  const { eligibilityChecks } = await import('../src/services/card-inventory-eligibility.js');
  const pass = Object.fromEntries(eligibilityChecks('c', '?').map((k) => [`chk_${k.code.toLowerCase()}`, 1]));
  const row = (patch) => ({ ...pass, effective_balance: '1.000000', min_balance: '16.000000', used_capacity: 3, ...patch });
  assert.equal(blockedReasonText(row({})), null, '全过就没有原因');
  assert.equal(blockedReasonText(row({ chk_balance_low: 0 })), '余额 $1.00，不够 $16');
  assert.equal(blockedReasonText(row({ chk_balance_low: 0, chk_used_up: 0 }), { maxCapacity: 3 }), '3 次已用满', '次数用满比余额更决定性');
  assert.equal(blockedReasonText(row({ chk_used_up: 0, chk_pro_used: 0 }), { maxCapacity: 3 }), '跑过 Pro，不再分配');
  assert.equal(blockedReasonText(row({ chk_sync_stale: 0 })), '流水 15 分钟内没同步（有单时会自动同步）');
  assert.equal(blockedReasonText(row({ chk_balance_low: null })), '余额 $1.00，不够 $16', 'NULL（余额读不到）也算没过');
  const card = { effectiveInventoryStatus: 'AVAILABLE', isAllocatable: false, blockedReason: '余额 $1.08，不够 $16' };
  assert.deepEqual(classifyStockCardOperationalState(card), { category: 'BLOCKED', reason: '余额 $1.08，不够 $16' });
  assert.equal(classifyStockCardOperationalState({ ...card, blockedReason: null }).reason, '当前不满足 Plus 安全分配条件', '算不出时才用兜底');
});

test('D-405 eligibility is exactly the AND of the named checks (one rule); freshness sentence still findable for the stock basis', async () => {
  const m = await import('../src/services/card-inventory-eligibility.js');
  for (const productCode of ['plus', 'pro_5x', 'pro_20x']) {
    const checks = m.eligibilityChecks('c', '?', { productCode });
    assert.equal(m.eligibleInventoryCardSql('c', '?', { productCode }), checks.map((k) => k.sql).join('\n    AND '));
    assert.equal(new Set(checks.map((k) => k.code)).size, checks.length, 'codes unique');
    assert.deepEqual(checks.map((k) => k.code), ['NOT_IN_INVENTORY', 'MISSING_AT_PLATFORM', 'NOT_ACCEPTED', 'PLATFORM_STATUS',
      'NO_CREDENTIALS', 'SYNC_STALE', 'BALANCE_LOW', 'USED_UP', 'PRO_USED', 'IN_USE', 'TOP_UP_PENDING', 'REFUND_CASE', 'OVERRIDE',
      ...(productCode === 'plus' ? ['PLUS_LARGE_CARD'] : [])], 'the full rule set; dropping one would widen allocation');
    assert.equal(checks.some((k) => k.code === 'PLUS_LARGE_CARD'), productCode === 'plus');
    assert.doesNotThrow(() => m.stockCountingCardSql('c', '?', { productCode }));
    assert.doesNotMatch(m.stockCountingCardSql('c', '?', { productCode }), /INTERVAL 15 MINUTE/);
  }
});


test('D-411：卡片页把「能补钱复用」的旧卡算可分配并说清要先补；钱包不够补时说清卡在哪；补钱中的占用写明', async () => {
  const { classifyStockCardOperationalState } = await import('../src/services/card-stock-service.js');
  const base = { effectiveInventoryStatus: 'DEPLETED', isAllocatable: false, usedCapacity: 1, maxCapacity: 3, topUpAmount: '16.000000' };
  assert.deepEqual(classifyStockCardOperationalState({ ...base, reusableTopUp: true, walletCoversTopUp: true }),
    { category: 'READY', reason: '轮到它时先补 $16（已用 1/3 次）' });
  assert.deepEqual(classifyStockCardOperationalState({ ...base, reusableTopUp: true, walletCoversTopUp: false }),
    { category: 'BLOCKED', reason: '钱包不够补 $16，充钱包后可用' });
  assert.equal(classifyStockCardOperationalState({ ...base, reusableTopUp: false }).category, 'BLOCKED');
  assert.deepEqual(classifyStockCardOperationalState({ ...base, effectiveInventoryStatus: 'ASSIGNED', assigned: true,
    publicNo: 'PJV1-X', openTopUpStatus: 'SUBMITTED' }), { category: 'IN_USE', reason: '正在补 $16，到账后付款' });
  assert.deepEqual(classifyStockCardOperationalState({ ...base, effectiveInventoryStatus: 'ASSIGNED', assigned: true,
    publicNo: 'PJV1-X', openTopUpStatus: null }), { category: 'IN_USE', reason: '已绑定订单 PJV1-X' });
});
