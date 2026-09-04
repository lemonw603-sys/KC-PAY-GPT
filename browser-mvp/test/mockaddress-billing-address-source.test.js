import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddressBillingAddressSource } from '../src/mockaddress-billing-address-source.js';

test('MockAddress source is pinned, deterministic and returns only billing fields', async () => {
  const source = new MockAddressBillingAddressSource({ name: 'Test Customer', state: 'DE' });
  const a = await source.load('order:one');
  const b = await source.load('order:one');
  assert.deepEqual(a, b);
  assert.equal(a.country, 'US');
  assert.equal(a.state, 'DE');
  assert.equal(a.name, 'Test Customer');
  assert.equal(Object.keys(a).sort().join(','), 'city,country,line1,name,postalCode,state');
  assert.deepEqual(source.metadata(), { source: 'MockAddress', version: 'taxfree_target_no_source_perstate888@2026-04-26', state: 'DE' });
});

test('MockAddress source rejects unsupported states and malformed names', () => {
  assert.throws(() => new MockAddressBillingAddressSource({ name: 'x', state: 'CA' }), /supported/);
  assert.throws(() => new MockAddressBillingAddressSource({ state: 'DE' }), /name is required/);
});

test('MockAddress source keeps one address per card and separates different cards', async () => {
  const { InMemoryBillingAddressAssignmentStore } = await import('../src/mockaddress-billing-address-source.js');
  const source = new (await import('../src/mockaddress-billing-address-source.js')).MockAddressBillingAddressSource({ name: 'Test', state: 'DE', assignmentStore: new InMemoryBillingAddressAssignmentStore() });
  const a = await source.load('card:a');
  const b = await source.load('card:b');
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, await source.load('card:a'));
});
