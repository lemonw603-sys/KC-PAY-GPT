import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCurrentCardProviderAccount } from '../src/services/provider-route-service.js';

test('current card provider account is resolved from the active Plus route', async () => {
  let sql;
  const connection = {
    async query(statement) {
      sql = statement;
      return [[{ id: 'card-account-2' }]];
    }
  };
  assert.equal(await resolveCurrentCardProviderAccount(connection), 'card-account-2');
  assert.match(sql, /p\.product_code = 'chatgpt_plus'/);
  assert.match(sql, /fr\.accepts_new_orders = 1/);
  assert.match(sql, /pa\.purpose = 'CARD'/);
  assert.match(sql, /ORDER BY fr\.route_version DESC/);
});

test('missing active card route fails closed', async () => {
  const connection = { async query() { return [[]]; } };
  assert.equal(await resolveCurrentCardProviderAccount(connection), null);
});
