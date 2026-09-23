import assert from 'node:assert/strict';
import test from 'node:test';
import { detectTopUp, fundedAmountAfterTopUp } from '../src/domain/card-top-up.js';

test('D-354: a balance that rose by at least one cent is a top-up; a fall or a rounding wobble is not', () => {
  assert.equal(detectTopUp('15.990000', '31.99'), '16.000000');
  assert.equal(detectTopUp('3.27', '3.279'), null, '不到一分钱不算');
  assert.equal(detectTopUp('50', '16.89'), null, '降了是消费，不在这里处理');
  assert.equal(detectTopUp(null, '20'), null, '首次入库没有旧值');
  assert.equal(detectTopUp('20', null), null);
  assert.equal(detectTopUp('abc', '20'), null);
  assert.equal(detectTopUp(0, 0.01), '0.010000');
});

test('D-354: funded_amount grows by exactly the observed top-up and never shrinks', () => {
  assert.equal(fundedAmountAfterTopUp('3.270000', '16.000000'), '19.270000');
  assert.equal(fundedAmountAfterTopUp(null, '5'), '5.000000', 'funded 缺失按 0 起算');
  assert.equal(fundedAmountAfterTopUp('50', null), '50.000000');
  assert.equal(fundedAmountAfterTopUp('50', '-3'), '50.000000');
});
