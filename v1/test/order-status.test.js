import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OrderStatus,
  assertOrderTransition,
  canTransitionOrder,
  isKnownOrderStatus
} from '../src/domain/order-status.js';

test('accepts the intended happy-path order transitions', () => {
  const path = [
    OrderStatus.CREATED,
    OrderStatus.CARD_PURCHASING,
    OrderStatus.CARD_READY,
    OrderStatus.SUBMITTING,
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.CLOSED
  ];

  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(canTransitionOrder(path[index], path[index + 1]), true);
    assert.doesNotThrow(() => assertOrderTransition(path[index], path[index + 1]));
  }
});

test('blocks retrying an ambiguous submission by state transition', () => {
  assert.equal(
    canTransitionOrder(OrderStatus.SUBMIT_UNKNOWN, OrderStatus.SUBMITTING),
    false
  );
  assert.throws(
    () => assertOrderTransition(OrderStatus.SUBMIT_UNKNOWN, OrderStatus.SUBMITTING),
    /Invalid order status transition/
  );
});

test('rejects unknown provider-derived states', () => {
  assert.equal(isKnownOrderStatus('successful-ish'), false);
  assert.throws(
    () => assertOrderTransition(OrderStatus.SUBMITTING, 'successful-ish'),
    /Unknown order status transition/
  );
});
