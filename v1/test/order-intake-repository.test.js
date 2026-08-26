import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOrderIntakeSettings } from '../src/db/repositories/order-intake-repository.js';

function settings(values) {
  return Object.entries(values).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
}

test('order intake snapshots independent open-card and minimum-balance settings', () => {
  const parsed = parseOrderIntakeSettings(settings({
    accept_new_orders: 'true',
    default_card_type_id: '1',
    default_open_card_amount: '16',
    default_minimum_required_card_balance: '15.5'
  }));
  assert.deepEqual(parsed, {
    cardTypeId: '1',
    openCardAmount: '16',
    minimumRequiredCardBalance: '15.5'
  });
});

test('order intake fails closed when minimum balance is missing or exceeds funding', () => {
  const base = {
    accept_new_orders: 'true',
    default_card_type_id: '1',
    default_open_card_amount: '16'
  };
  assert.throws(
    () => parseOrderIntakeSettings(settings(base)),
    (error) => error.code === 'ORDERING_NOT_CONFIGURED'
  );
  assert.throws(
    () => parseOrderIntakeSettings(settings({
      ...base,
      default_minimum_required_card_balance: '17'
    })),
    (error) => error.code === 'ORDERING_NOT_CONFIGURED'
  );
});
