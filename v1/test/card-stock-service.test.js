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
