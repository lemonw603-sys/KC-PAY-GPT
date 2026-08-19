import assert from 'node:assert/strict';
import test from 'node:test';
import { openStockCards } from '../scripts/card-stock.js';

function readyDetails(id) {
  return { data: {
    id,
    cardTypeId: 7,
    status: 'active',
    cardBalance: '16',
    currency: 'USD',
    cardNumber: `424242424242${String(id).padStart(4, '0')}`,
    cvv: '123',
    expiryMonth: 12,
    expiryYear: 2032
  } };
}

test('batch opening uses one idempotency key per card and registers every result', async () => {
  const purchases = [];
  const registered = [];
  const ids = ['1001', '1002'];
  const provider = {
    cards: async ({ page, pageSize }) => ({ data: { cards: [], total: 0, page, pageSize } }),
    purchaseCard: async (input) => {
      purchases.push(input);
      return { data: { card: { id: ids[purchases.length - 1] } } };
    },
    card: async (id) => readyDetails(id)
  };
  const stock = {
    register: async (card) => {
      registered.push(card);
      return { providerCardId: card.providerCardId, inventoryStatus: card.ready ? 'AVAILABLE' : 'PROVISIONING' };
    }
  };
  let uuid = 0;
  const result = await openStockCards({
    provider, stock, count: 2, amount: 16, cardTypeId: '7',
    randomUUID: () => `uuid-${++uuid}-1234567890`, waitFn: async () => {}
  });
  assert.equal(result.opened, 2);
  assert.deepEqual(purchases.map((item) => item.idempotencyKey), [
    'stock-uuid-1-1234567890', 'stock-uuid-2-1234567890'
  ]);
  assert.deepEqual(registered.filter((card) => card.ready).map((card) => card.providerCardId), ids);
  assert.equal(registered.filter((card) => !card.ready).length, 2);
});

test('uncertain opening recovers one new ID but never reports completion before detail readiness', async () => {
  let listCalls = 0;
  const provider = {
    cards: async ({ page, pageSize }) => {
      listCalls += 1;
      const cards = listCalls === 1 ? [{ id: 'old' }] : [{ id: 'old' }, { id: 'new-1' }];
      return { data: { cards, total: cards.length, page, pageSize } };
    },
    purchaseCard: async () => {
      const error = new Error('timeout');
      error.uncertain = true;
      throw error;
    },
    card: async () => {
      const error = new Error('read timeout');
      error.code = 'READ_TIMEOUT';
      throw error;
    }
  };
  const registered = [];
  const stock = {
    register: async (card) => {
      registered.push(card);
      return { providerCardId: card.providerCardId, inventoryStatus: 'PROVISIONING' };
    }
  };
  await assert.rejects(() => openStockCards({
    provider, stock, count: 1, amount: 16, cardTypeId: '7',
    randomUUID: () => 'uuid-recovery-123456', maxDetailPolls: 1, waitFn: async () => {}
  }), (error) => error.code === 'READ_TIMEOUT');
  assert.equal(registered[0].providerCardId, 'new-1');
});

test('live preflight failure makes zero paid purchase calls', async () => {
  let purchases = 0;
  const provider = {
    cards: async ({ page, pageSize }) => ({ data: { cards: [], total: 0, page, pageSize } }),
    purchaseCard: async () => { purchases += 1; }
  };
  await assert.rejects(() => openStockCards({
    provider,
    stock: { register: async () => ({}) },
    count: 1,
    amount: 16,
    cardTypeId: '7',
    beforeCard: async () => {
      const error = new Error('balance changed');
      error.code = 'CARD_STOCK_BALANCE_INSUFFICIENT';
      throw error;
    },
    waitFn: async () => {}
  }), (error) => error.code === 'CARD_STOCK_BALANCE_INSUFFICIENT');
  assert.equal(purchases, 0);
});

test('waits for processing cards and rejects terminal failures', async () => {
  let reads = 0;
  const registered = [];
  const provider = {
    cards: async ({ page, pageSize }) => ({ data: { cards: [], total: 0, page, pageSize } }),
    purchaseCard: async () => ({ data: { card: { id: '2001' } } }),
    card: async () => {
      reads += 1;
      if (reads === 1) return { data: { id: '2001', cardTypeId: 7, status: 'processing' } };
      return readyDetails('2001');
    }
  };
  const stock = { register: async (card) => { registered.push(card); return card; } };
  const result = await openStockCards({
    provider, stock, count: 1, amount: 16, cardTypeId: '7', waitFn: async () => {}
  });
  assert.equal(result.opened, 1);
  assert.equal(reads, 2);
  assert.equal(registered.at(-1).ready, true);

  provider.purchaseCard = async () => ({ data: { card: { id: '2002' } } });
  provider.card = async () => ({
    data: { id: '2002', cardTypeId: 7, status: 'failed', cardBalance: '0' }
  });
  await assert.rejects(() => openStockCards({
    provider, stock, count: 1, amount: 16, cardTypeId: '7', waitFn: async () => {}
  }), (error) => error.code === 'CARD_STOCK_CARD_FAILED');
  assert.equal(registered.at(-1).failed, true);
});
