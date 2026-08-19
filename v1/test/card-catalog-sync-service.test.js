import assert from 'node:assert/strict';
import test from 'node:test';
import { syncCardCatalog } from '../src/services/card-catalog-sync-service.js';

function detail(id, balance) {
  return { data: {
    id, cardTypeId: 7, status: 'active', cardBalance: String(balance), currency: 'USD',
    cardNumber: `42424242424${String(id).padStart(5, '0')}`, cvv: '123',
    expiryMonth: 12, expiryYear: 2032
  } };
}

test('catalog sync imports every active provider card and records reconciliation counts', async () => {
  const registered = [];
  const writes = [];
  const listed = [
    { id: 617, status: 'active' }, { id: 616, status: 'active' },
    { id: 612, status: 'active' }, { id: 493, status: 'active' },
    { id: 444, status: 'active' }, { id: 100, status: 'inactive' }
  ];
  const pool = {
    async query(sql, values = []) {
      if (/FROM app_settings/.test(sql)) return [[
        { setting_key: 'default_card_type_id', setting_value: '7' },
        { setting_key: 'default_minimum_required_card_balance', setting_value: '15.5' }
      ], []];
      if (/SELECT provider_card_id, status FROM cards/.test(sql)) return [listed
        .filter((card) => card.status === 'active')
        .map((card) => ({ provider_card_id: String(card.id), status: card.status })), []];
      if (/FROM cards/.test(sql)) return [[{
        available: 3, assigned: 1, depleted: 1, provisioning: 0
      }], []];
      if (/INSERT INTO card_catalog_snapshots/.test(sql)) {
        writes.push({ sql, values });
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const provider = {
    async cards() { return { data: { cards: listed, total: listed.length } }; },
    async card(id) { return detail(id, id === '493' ? 0.02 : 16); }
  };
  const stock = { async register(card) { registered.push(card); } };
  const checkedAt = new Date('2026-08-20T01:00:00.000Z');
  const result = await syncCardCatalog({ pool, provider, stock, checkedAt });

  assert.equal(registered.length, 5);
  assert.equal(registered.find((card) => card.providerCardId === '493').depleted, true);
  assert.equal(result.providerTotal, 6);
  assert.equal(result.providerActive, 5);
  assert.equal(result.providerInactive, 1);
  assert.equal(result.available, 3);
  assert.equal(result.assigned, 1);
  assert.equal(result.depleted, 1);
  assert.equal(result.unresolvedActive, 0);
  assert.equal(result.providerOnlyActiveCount, 0);
  assert.equal(result.localMissingProviderCount, 0);
  assert.equal(result.statusConflictCount, 0);
  assert.equal(writes.length, 1);
});

test('catalog sync blocks opening when an active provider card cannot be resolved', async () => {
  let snapshot;
  const pool = {
    async query(sql, values = []) {
      if (/FROM app_settings/.test(sql)) return [[
        { setting_key: 'default_card_type_id', setting_value: '7' },
        { setting_key: 'default_minimum_required_card_balance', setting_value: '15.5' }
      ], []];
      if (/SELECT provider_card_id, status FROM cards/.test(sql)) return [[], []];
      if (/FROM cards/.test(sql)) return [[{}], []];
      if (/INSERT INTO card_catalog_snapshots/.test(sql)) {
        snapshot = JSON.parse(values[0]);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const provider = {
    async cards() { return { data: { cards: [{ id: 617, status: 'active' }], total: 1 } }; },
    async card() { throw Object.assign(new Error('read failed'), { code: 'UPSTREAM_TIMEOUT' }); }
  };
  const result = await syncCardCatalog({ pool, provider, stock: { async register() {} } });
  assert.equal(result.unresolvedActive, 1);
  assert.deepEqual(snapshot.unresolved, [{ providerCardId: '617', code: 'UPSTREAM_TIMEOUT' }]);
});
