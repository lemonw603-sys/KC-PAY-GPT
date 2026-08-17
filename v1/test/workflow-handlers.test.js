import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderStatus } from '../src/domain/order-status.js';
import { ProviderError } from '../src/providers/http-client.js';
import { createWorkflowHandlers } from '../src/workers/workflow-handlers.js';

function setup({ status = OrderStatus.CARD_READY, rechargeStatuses = [] } = {}) {
  const calls = [];
  const providerCalls = [];
  const context = {
    order: {
      status,
      public_no: 'ORD-1',
      card_type_id: 7,
      open_card_amount: 25,
      card_purchase_idempotency_key: 'purchase-order-0001',
      recharge_card_key: 'DIRECT-fixture'
    },
    card: { provider_card_id: 'card-1' },
    session: { accessToken: 'fixture' }
  };
  const workflow = {
    loadOrderContext: async () => context,
    transition: async (...args) => calls.push(['transition', ...args]),
    commitPurchasedCard: async (...args) => calls.push(['card', ...args]),
    commitCardReady: async (...args) => calls.push(['ready', ...args]),
    failCardProvisioning: async (...args) => calls.push(['failed-card', ...args]),
    reviewCardProvisioning: async (...args) => calls.push(['review-card', ...args]),
    commitRechargeSubmission: async (...args) => calls.push(['submission', ...args]),
    commitRechargeSuccess: async (...args) => calls.push(['success', ...args]),
    commitCancellationStatus: async (...args) => calls.push(['cancellation', ...args])
  };
  const cardProvider = {
    purchaseCard: async () => ({ data: { card: { id: 'card-1' } } }),
    card: async () => ({ data: { number: '4242424242424242', cvv: '123' } })
  };
  const rechargeProvider = {
    createDirectOrder: async () => ({ orderNo: '12', cardKey: 'DIRECT-fixture', status: 'processing' }),
    queryStatus: async () => rechargeStatuses.shift()
  };
  const recordCall = async (input) => {
    providerCalls.push(input);
    return input.action();
  };
  const handlers = createWorkflowHandlers({
    workflow,
    cardProvider,
    rechargeProvider,
    recordCall,
    mapPurchasedCard: (value) => ({ providerCardId: value.data.card.id, cardTypeId: 7, fundedAmount: '25.000000' }),
    mapCardProvisioning: (value) => value.data.status === 'failed'
      ? { state: 'failed', status: 'failed', failureReason: 'provider failed' }
      : value.data.status === 'pending'
        ? { state: 'pending', status: 'active', currentBalance: 0 }
        : { state: 'ready', status: 'active', currentBalance: 25, currency: 'USD', last4: '4242' },
    mapCardCredentials: () => ({ cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123' }),
    wait: async () => {},
    pollDelayMs: 1,
    failureConfirmDelayMs: 1
  });
  return { calls, providerCalls, context, workflow, cardProvider, rechargeProvider, handlers };
}

test('submits one direct recharge and commits external identifiers', async () => {
  const { handlers, calls } = setup();
  await handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.equal(calls[0][0], 'transition');
  assert.equal(calls[0][2], OrderStatus.SUBMITTING);
  assert.deepEqual(calls[1], [
    'submission',
    'order-1',
    { orderNo: '12', cardKey: 'DIRECT-fixture', status: 'processing' }
  ]);
});

test('submits with encrypted cached card credentials without rereading the provider', async () => {
  const state = setup();
  state.context.card.credentials = {
    cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
  };
  state.cardProvider.card = async () => { throw new Error('must not reread card credentials'); };
  await state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.equal(state.calls.at(-1)[0], 'submission');
  assert.equal(state.providerCalls.some((call) => call.operation === 'card_details'), false);
});

test('purchases a card with the persisted idempotency key and commits one binding', async () => {
  const state = setup({ status: OrderStatus.CREATED });
  await state.handlers.PURCHASE_CARD({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.equal(state.calls[0][2], OrderStatus.CARD_PURCHASING);
  assert.deepEqual(state.calls[1], [
    'card',
    'order-1',
    { providerCardId: 'card-1', cardTypeId: 7, fundedAmount: '25.000000' }
  ]);
});

test('keeps a slow card in provisioning without submitting recharge', async () => {
  const state = setup({ status: OrderStatus.CARD_PROVISIONING });
  state.cardProvider.card = async () => ({ data: { status: 'pending' } });
  await assert.rejects(
    state.handlers.VERIFY_CARD({ id: 1, order_id: 'order-1', attempts: 1, max_attempts: 240 }),
    (error) => error.code === 'CARD_PROVISIONING_PENDING' && error.retryable === true
  );
  assert.equal(state.calls.some(([name]) => name === 'ready' || name === 'failed-card'), false);
});

test('isolates a terminal card failure from the rest of the batch', async () => {
  const state = setup({ status: OrderStatus.CARD_PROVISIONING });
  state.cardProvider.card = async () => ({ data: { status: 'failed', cardBalance: '0.000000' } });
  await state.handlers.VERIFY_CARD({ id: 1, order_id: 'order-1', attempts: 1, max_attempts: 240 });
  assert.equal(state.calls.at(-1)[0], 'failed-card');
  assert.equal(state.calls.some(([name]) => name === 'submission'), false);
});

test('moves an overlong card provisioning wait to manual review', async () => {
  const state = setup({ status: OrderStatus.CARD_PROVISIONING });
  state.cardProvider.card = async () => ({ data: { status: 'pending' } });
  await state.handlers.VERIFY_CARD({ id: 1, order_id: 'order-1', attempts: 240, max_attempts: 240 });
  assert.equal(state.calls.at(-1)[0], 'review-card');
  assert.equal(state.calls.some(([name]) => name === 'submission'), false);
});

test('maps an ambiguous create failure to SUBMIT_UNKNOWN', async () => {
  const state = setup();
  state.rechargeProvider.createDirectOrder = async () => {
    throw new ProviderError('timeout', { provider: 'zzshu', uncertain: true, retryable: false });
  };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 })
  );
  assert.equal(state.calls.at(-1)[2], OrderStatus.SUBMIT_UNKNOWN);
});

test('does not change order state for a safe capacity retry', async () => {
  const state = setup();
  state.rechargeProvider.createDirectOrder = async () => {
    throw new ProviderError('capacity', { provider: 'zzshu', uncertain: false, retryable: true });
  };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 })
  );
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][2], OrderStatus.SUBMITTING);
});

test('confirms a failed status twice before marking the order failed', async () => {
  const state = setup({
    status: OrderStatus.RECHARGE_PROCESSING,
    rechargeStatuses: [
      { status: 'failed', failureReason: 'first' },
      { status: 'failed', failureReason: 'confirmed' }
    ]
  });
  await state.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 3 });
  assert.equal(state.calls.at(-1)[2], OrderStatus.RECHARGE_FAILED);
  assert.equal(state.calls.at(-1)[4].failureReason, 'confirmed');
});

test('marks success immediately and never guesses unknown states', async () => {
  const success = setup({
    status: OrderStatus.RECHARGE_PROCESSING,
    rechargeStatuses: [{ status: 'success', isSubscriptionCancelled: 0 }]
  });
  await success.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 2 });
  assert.equal(success.calls.at(-1)[0], 'success');
  assert.equal(success.calls.at(-1)[2].isSubscriptionCancelled, 0);

  const unknown = setup({
    status: OrderStatus.RECHARGE_PROCESSING,
    rechargeStatuses: [{ status: 'mystery' }]
  });
  await assert.rejects(
    unknown.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 2 }),
    /Unsupported recharge status/
  );
});

test('persists the latest Session and rechecks cancellation independently', async () => {
  const state = setup({
    status: OrderStatus.RECHARGE_SUCCESS,
    rechargeStatuses: [{
      status: 'success', isSubscriptionCancelled: 1,
      latestSession: { accessToken: 'latest', sessionToken: 'latest-session' }
    }]
  });
  state.rechargeProvider.queryStatusWithSession = state.rechargeProvider.queryStatus;
  await state.handlers.RECHECK_CANCELLATION({
    id: 3, order_id: 'order-1', attempts: 2, max_attempts: 60
  });
  assert.equal(state.calls.at(-1)[0], 'cancellation');
  assert.equal(state.calls.at(-1)[3].accessToken, 'latest');
  assert.equal(JSON.stringify(state.providerCalls.at(-1).summarize({ latestSession: { accessToken: 'secret' }, status: 'success' })).includes('secret'), false);
});

test('requeues an unconfirmed cancellation without changing recharge success', async () => {
  const state = setup({
    status: OrderStatus.RECHARGE_SUCCESS,
    rechargeStatuses: [{ status: 'success', isSubscriptionCancelled: 0 }]
  });
  await assert.rejects(
    state.handlers.RECHECK_CANCELLATION({ id: 3, order_id: 'order-1', attempts: 1, max_attempts: 60 }),
    (error) => error.code === 'CANCELLATION_PENDING' && error.retryable === true
  );
  assert.equal(state.calls.at(-1)[0], 'cancellation');
  assert.equal(state.calls.some((call) => call[0] === 'transition'), false);
});

test('uses a local audit key instead of persisting the recharge card key', async () => {
  const state = setup({
    status: OrderStatus.RECHARGE_PROCESSING,
    rechargeStatuses: [{ status: 'success' }]
  });
  await state.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 2 });

  const queryCall = state.providerCalls.find((call) => call.operation === 'query_status');
  assert.equal(queryCall.requestKey, 'recharge-status:order-1');
  assert.equal(queryCall.requestKey.includes(state.context.order.recharge_card_key), false);
});
