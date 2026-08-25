export const OrderStatus = Object.freeze({
  CREATED: 'CREATED',
  CARD_PURCHASING: 'CARD_PURCHASING',
  CARD_PROVISIONING: 'CARD_PROVISIONING',
  CARD_READY: 'CARD_READY',
  WAITING_FOR_CARD: 'WAITING_FOR_CARD',
  CARD_FAILED: 'CARD_FAILED',
  WAITING_FOR_SESSION: 'WAITING_FOR_SESSION',
  SUBMITTING: 'SUBMITTING',
  SUBMIT_UNKNOWN: 'SUBMIT_UNKNOWN',
  RECHARGE_PROCESSING: 'RECHARGE_PROCESSING',
  RECHARGE_SUCCESS: 'RECHARGE_SUCCESS',
  RECHARGE_FAILED: 'RECHARGE_FAILED',
  CANCELLATION_PENDING: 'CANCELLATION_PENDING',
  CANCELLATION_REVIEW_REQUIRED: 'CANCELLATION_REVIEW_REQUIRED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  CLOSED: 'CLOSED'
});

const transitions = new Map([
  [OrderStatus.CREATED, new Set([
    OrderStatus.CARD_PURCHASING,
    OrderStatus.CARD_READY,
    OrderStatus.WAITING_FOR_CARD,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.CARD_PURCHASING, new Set([OrderStatus.CARD_PROVISIONING, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.CARD_PROVISIONING, new Set([
    OrderStatus.CARD_READY,
    OrderStatus.CARD_FAILED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.CARD_FAILED, new Set([OrderStatus.CLOSED, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.CARD_READY, new Set([
    OrderStatus.WAITING_FOR_SESSION,
    OrderStatus.SUBMITTING,
    OrderStatus.CLOSED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.WAITING_FOR_CARD, new Set([
    OrderStatus.CARD_READY,
    OrderStatus.CLOSED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.WAITING_FOR_SESSION, new Set([
    OrderStatus.CARD_READY,
    OrderStatus.CLOSED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.SUBMITTING, new Set([
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.SUBMIT_UNKNOWN,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.WAITING_FOR_SESSION,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.SUBMIT_UNKNOWN, new Set([
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.CANCELLATION_PENDING,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.RECHARGE_PROCESSING, new Set([
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.CANCELLATION_PENDING,
    OrderStatus.RECHARGE_FAILED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.RECHARGE_SUCCESS, new Set([OrderStatus.CLOSED, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.CANCELLATION_PENDING, new Set([
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.CANCELLATION_REVIEW_REQUIRED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.CANCELLATION_REVIEW_REQUIRED, new Set([
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.CLOSED,
    OrderStatus.RECONCILIATION_REQUIRED
  ])],
  [OrderStatus.RECHARGE_FAILED, new Set([OrderStatus.CLOSED, OrderStatus.RECONCILIATION_REQUIRED])],
  [OrderStatus.RECONCILIATION_REQUIRED, new Set([
    OrderStatus.RECHARGE_PROCESSING,
    OrderStatus.RECHARGE_SUCCESS,
    OrderStatus.CANCELLATION_PENDING,
    OrderStatus.CANCELLATION_REVIEW_REQUIRED,
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
