import test from 'node:test';
import assert from 'node:assert/strict';
import { assertZeroTaxQuote } from '../src/billing-quote-readiness.js';

test('accepts dynamic subtotal with zero tax', () => {
  const q = assertZeroTaxQuote({ subtotal: 981.72, tax: 0, total: 981.72, currency: 'PHP' });
  assert.equal(q.verified, true);
});
test('allows minor currency rounding but not percentage tax', () => {
  assert.doesNotThrow(() => assertZeroTaxQuote({ subtotal: 982.14, tax: 0, total: 982.15, currency: 'PHP' }));
  assert.throws(() => assertZeroTaxQuote({ subtotal: 982.14, tax: 117.86, total: 1100, currency: 'PHP' }), /tax is not zero/);
});
test('rejects arithmetic mismatch', () => {
  assert.throws(() => assertZeroTaxQuote({ subtotal: 982.14, tax: 0, total: 1000, currency: 'PHP' }), /does not match/);
});

test('rejects non-Philippine currency', () => {
  assert.throws(() => assertZeroTaxQuote({ subtotal: 20, tax: 0, total: 20, currency: 'USD' }), /currency must be PHP/);
});
