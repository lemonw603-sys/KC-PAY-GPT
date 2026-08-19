import assert from 'node:assert/strict';
import test from 'node:test';
import { mapStockCard } from '../src/services/card-stock-service.js';

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
    ready: true
  });
});

test('keeps a newly opened but unreadable card in provisioning stock', () => {
  const card = mapStockCard({ data: {
    id: 'pending-1', cardTypeId: '7', status: 'provisioning'
  } }, { fundedAmount: 16 });
  assert.equal(card.ready, false);
  assert.equal(card.credentials, null);
  assert.equal(card.currentBalance, null);
  assert.equal(card.fundedAmount, '16');
});

test('rejects stock without stable card identity and type', () => {
  assert.throws(() => mapStockCard({ data: { status: 'active' } }), /lacks provider card ID or card type ID/);
});
