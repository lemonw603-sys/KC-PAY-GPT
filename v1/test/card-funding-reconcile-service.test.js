import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileNextCardFundingAttempt } from '../src/services/card-funding-reconcile-service.js';

function fixture({ balance }) {
  const calls = [];
  const attempt = {
    id: 'funding-1', card_id: 'card-1', order_id: 'order-1',
    provider_card_id: 'provider-card-1', card_type_id: '7', funded_amount: '16'
  };
  return {
    calls,
    pool: {
      async query() { return [[{ setting_value: '16' }]]; }
    },
    repository: {
      async nextPending() { calls.push('claim'); return attempt; },
      async reconcile(input) { calls.push(['reconcile', input]); return {
        attemptId: input.attemptId,
        state: Number(input.currentBalance) >= 16 ? 'SETTLED' : 'PENDING'
      }; }
    },
    provider: {
      async card() { calls.push('card'); return { success: true, data: {
        id: 'provider-card-1', cardTypeId: '7', status: 'active',
        cardBalance: String(balance), currency: 'USD', cardNumber: '4242424242424242',
        cvv: '123', expiryMonth: 12, expiryYear: 2032
      } }; },
      async transactions() { calls.push('transactions'); return { data: { transactions: [{ id: 'topup-1' }] } }; }
    },
    stock: {
      async register(snapshot) { calls.push(['register', snapshot.currentBalance, snapshot.ready]); }
    },
    async commitTransactions(_pool, input) { calls.push(['commit', input.transactions.length, input.cardSnapshot.currentBalance]); }
  };
}

test('pending funding checks balance only and does not spend a transaction-list API call', async () => {
  const state = fixture({ balance: 8 });
  const outcome = await reconcileNextCardFundingAttempt({ ...state, providerAccountId: 'provider-1' });
  assert.equal(outcome.result.state, 'PENDING');
  assert.equal(state.calls.includes('transactions'), false);
  assert.deepEqual(state.calls.find((call) => Array.isArray(call) && call[0] === 'commit'), ['commit', 0, '8']);
  assert.deepEqual(state.calls.find((call) => Array.isArray(call) && call[0] === 'register'), ['register', '8', false]);
});

test('settled funding persists transaction evidence and makes the refreshed card ready', async () => {
  const state = fixture({ balance: 16 });
  const outcome = await reconcileNextCardFundingAttempt({ ...state, providerAccountId: 'provider-1' });
  assert.equal(outcome.result.state, 'SETTLED');
  assert.equal(state.calls.filter((call) => call === 'transactions').length, 1);
  assert.deepEqual(state.calls.find((call) => Array.isArray(call) && call[0] === 'commit'), ['commit', 1, '16']);
  assert.deepEqual(state.calls.find((call) => Array.isArray(call) && call[0] === 'register'), ['register', '16', true]);
});

test('no pending attempt performs no provider read', async () => {
  const state = fixture({ balance: 16 });
  state.repository.nextPending = async () => null;
  const outcome = await reconcileNextCardFundingAttempt({ ...state, providerAccountId: 'provider-1' });
  assert.deepEqual(outcome, { handled: false });
  assert.equal(state.calls.includes('card'), false);
});
