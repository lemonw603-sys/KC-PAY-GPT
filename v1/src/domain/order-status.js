export const OrderStatus = Object.freeze({
  CREATED: 'CREATED',
  CARD_PURCHASING: 'CARD_PURCHASING',
  CARD_READY: 'CARD_READY',
  SUBMITTING: 'SUBMITTING',
  SUBMIT_UNKNOWN: 'SUBMIT_UNKNOWN',
  RECHARGE_PROCESSING: 'RECHARGE_PROCESSING',
  RECHARGE_SUCCESS: 'RECHARGE_SUCCESS',
  RECHARGE_FAILED: 'RECHARGE_FAILED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  CLOSED: 'CLOSED'
});

const transitions = new Map([
  [OrderStatus.CREATED, new Set([OrderStatus.CARD_PURCHASING, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.CARD_PURCHASING, new Set([OrderStatus.CARD_READY, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.CARD_READY, new Set([OrderStatus.SUBMITTING, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.SUBMITTING, new Set([
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.SUBMIT_UNKNOWN,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.SUBMIT_UNKNOWN, new Set([
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.RECHARGE_PROCESSING, new Set([
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.RECHARGE_SUCCESS, new Set([OrderStatus.CLOSED, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.RECHARGE_FAILED, new Set([OrderStatus.CLOSED, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.RECONCILIATION_REQUIRED, new Set([
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.CLOSED
  ])],
  [OrderStatus.CLOSED, new Set()]
]);

export function isKnownOrderStatus(status) {
  return Object.values(OrderStatus).includes(status);
}

export function canTransitionOrder(from, to) {
  return transitions.get(from)?.has(to) ?? false;
}

export function assertOrderTransition(from, to) {
  if (!isKnownOrderStatus(from) || !isKnownOrderStatus(to)) {
    throw new Error(`Unknown order status transition: ${from} -> ${to}`);
  }
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Invalid order status transition: ${from} -> ${to}`);
  }
}
