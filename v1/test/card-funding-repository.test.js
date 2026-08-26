import assert from 'node:assert/strict';
import test from 'node:test';
import { createCardFundingRepository } from '../src/db/repositories/card-funding-repository.js';

test('card funding preparation requires a caller-owned stable idempotency key', async () => {
  let connections = 0;
  const repository = createCardFundingRepository({
    async getConnection() {
      connections += 1;
      throw new Error('database access should not occur');
    }
  });

  await assert.rejects(
    repository.prepare({
      cardId: 'card-1', amount: '12', providerAccountId: 'provider-1'
    }),
    (error) => error?.code === 'CARD_FUNDING_IDENTITY_INVALID'
  );
  assert.equal(connections, 0);
});
