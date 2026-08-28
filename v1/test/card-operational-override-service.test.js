import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardOperationalOverrideService } from '../src/services/card-operational-override-service.js';

test('card operational overrides validate policy and upsert operator choice', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT')) return [{ affectedRows: 1 }];
    return [[{ id: 'x', provider_account_id: params?.[0], external_card_id: params?.[1], allocation_policy: 'RETIRED' }]];
  } };
  const service = createCardOperationalOverrideService({ pool });
  await assert.rejects(() => service.set({ providerAccountId: 'a', externalCardId: 'b', allocationPolicy: 'PRODUCT_ONLY', reason: 'retire' }), /Product is required/);
  const row = await service.set({ providerAccountId: 'a', externalCardId: 'b', allocationPolicy: 'RETIRED', reason: 'old batch', actorId: 'admin' });
  assert.equal(row.allocation_policy, 'RETIRED');
  assert.equal(calls.length, 2);
  const result = await service.clear({ providerAccountId: 'a', externalCardId: 'b' });
  assert.equal(result.deleted, false);
});
