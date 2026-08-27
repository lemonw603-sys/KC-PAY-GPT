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

test('catalog sync delegates unknown cards to the quarantine intake and records reconciliation counts', async () => {
  const intakeCalls = [];
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
  const intake = {
    async discover() {
      intakeCalls.push('discover');
      return { created: true, batch: { id: 'intake-1' } };
    },
    async validateBatch(batchId) {
      intakeCalls.push(`validate:${batchId}`);
      return { checked: 5, accepted: intakeCalls.length === 3 ? 5 : 0 };
    }
  };
  const checkedAt = new Date('2026-08-20T01:00:00.000Z');
  const result = await syncCardCatalog({ pool, provider, intake, checkedAt });

  assert.deepEqual(intakeCalls, ['discover', 'validate:intake-1', 'validate:intake-1']);
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

test('catalog sync refuses direct registration when quarantine intake is unavailable', async () => {
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
    async card() { throw new Error('catalog sync must not directly read and register unknown cards'); }
  };
  const result = await syncCardCatalog({ pool, provider });
  assert.equal(result.unresolvedActive, 1);
  assert.deepEqual(snapshot.unresolved, [{ providerCardId: '617', code: 'CARD_INTAKE_REQUIRED' }]);
});

test('catalog sync does not revalidate an unchanged completed intake batch', async () => {
  const intakeCalls = [];
  const pool = {
    async query(sql) {
      if (/FROM app_settings/.test(sql)) return [[
        { setting_key: 'default_card_type_id', setting_value: '7' },
        { setting_key: 'default_minimum_required_card_balance', setting_value: '16' }
      ], []];
      if (/SELECT provider_card_id, status FROM cards/.test(sql)) return [[], []];
      if (/FROM cards/.test(sql)) return [[{}], []];
      if (/INSERT INTO card_catalog_snapshots/.test(sql)) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const provider = {
    async cards() { return { data: { cards: [], total: 0 } }; }
  };
  const intake = {
    async discover() {
      intakeCalls.push('discover');
      return { created: false, activeBatch: false, batch: { id: 'completed-1', status: 'COMPLETED' } };
    },
    async validateBatch() {
      intakeCalls.push('validate');
      throw new Error('completed batch must not be revalidated');
    }
  };
  const result = await syncCardCatalog({ pool, provider, intake });
  assert.deepEqual(intakeCalls, ['discover']);
  assert.equal(result.intake.batchId, 'completed-1');
  assert.equal(result.intake.firstPass, null);
  assert.equal(result.intake.secondPass, null);
});
