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
    provider, stock, count: 2, amount: 16, cardTypeId: '7', randomUUID: () => `uuid-${++uuid}-1234567890`
  });
  assert.equal(result.opened, 2);
  assert.deepEqual(purchases.map((item) => item.idempotencyKey), [
    'stock-uuid-1-1234567890', 'stock-uuid-2-1234567890'
  ]);
  assert.deepEqual(registered.filter((card) => card.ready).map((card) => card.providerCardId), ids);
  assert.equal(registered.filter((card) => !card.ready).length, 2);
});

test('uncertain opening recovers one new ID and persists it before detail sync', async () => {
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
  const result = await openStockCards({
    provider, stock, count: 1, amount: 16, cardTypeId: '7', randomUUID: () => 'uuid-recovery-123456'
  });
  assert.equal(result.opened, 1);
  assert.equal(registered[0].providerCardId, 'new-1');
  assert.equal(result.cards[0].detailSyncPending, true);
  assert.equal(result.cards[0].detailError, 'READ_TIMEOUT');
});
