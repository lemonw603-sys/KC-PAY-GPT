import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderStatus } from '../src/domain/order-status.js';
import { ProviderError } from '../src/providers/http-client.js';
import { createWorkflowHandlers } from '../src/workers/workflow-handlers.js';
import { sessionFixture } from '../test-support/session-fixture.js';

function setup({ status = OrderStatus.CARD_READY, rechargeStatuses = [],
  rechargeAttemptRepository = null, browserDispatchRepository = null } = {}) {
  const calls = [];
  const providerCalls = [];
  const context = {
    order: {
      status,
      public_no: 'ORD-1',
      card_type_id: 7,
      open_card_amount: 25,
      minimum_required_card_balance: 16,
      card_purchase_idempotency_key: 'purchase-order-0001',
      recharge_card_key: 'DIRECT-fixture'
    },
    card: { provider_card_id: 'card-1' },
    session: sessionFixture()
  };
  const workflow = {
    loadOrderContext: async () => context,
    assignAvailableCard: async (...args) => {
      calls.push(['assign-card', ...args]);
      return { providerCardId: 'stock-card-1', remaining: 4 };
    },
    transition: async (...args) => calls.push(['transition', ...args]),
    markSessionReplacementRequired: async (...args) => calls.push(['session-required', ...args]),
    beginCardPurchase: async (...args) => calls.push(['begin-card', ...args]),
    markCardPurchaseAccepted: async (...args) => calls.push(['purchase-accepted', ...args]),
    reviewCardPurchase: async (...args) => calls.push(['review-purchase', ...args]),
    commitPurchasedCard: async (...args) => calls.push(['card', ...args]),
    commitCardReady: async (...args) => calls.push(['ready', ...args]),
    refreshAssignedCardForRecharge: async (...args) => calls.push(['refresh-card', ...args]),
    failCardProvisioning: async (...args) => calls.push(['failed-card', ...args]),
    reviewCardProvisioning: async (...args) => calls.push(['review-card', ...args]),
    commitRechargeSubmission: async (...args) => calls.push(['submission', ...args]),
    commitRechargeSuccess: async (...args) => calls.push(['success', ...args]),
    commitRechargeFailure: async (...args) => calls.push(['recharge-failure', ...args]),
    commitCancellationStatus: async (...args) => calls.push(['cancellation', ...args]),
    commitCardTransactions: async (...args) => calls.push(['transactions', ...args]),
    recordPrepaymentReady: async (...args) => calls.push(['prepayment', ...args]),
    consumeRechargePermit: async (...args) => {
      calls.push(['permit', ...args]);
      return { allowed: true, providerCall: { id: 99, startedAt: new Date() } };
    }
  };
  const cardProvider = {
    cardTypes: async () => ({ data: { purchaseEnabled: true, cardTypes: [{ id: 7, cardType: 'Z-TEST' }] } }),
    cards: async ({ page = 1, pageSize = 50 } = {}) => ({ data: { cards: [], total: 0, page, pageSize } }),
    purchaseCard: async () => ({ data: { card: { id: 'card-1' } } }),
    card: async () => ({ data: { number: '4242424242424242', cvv: '123' } }),
    transactions: async (_cardId, { page = 1, pageSize = 50 } = {}) => ({
      data: { transactions: [], total: 0, page, pageSize }
    })
  };
  const rechargeProvider = {
    createDirectOrder: async () => ({ orderNo: '12', cardKey: 'DIRECT-fixture', status: 'processing' }),
    queryStatus: async () => rechargeStatuses.shift()
  };
  const effectiveAttemptRepository = rechargeAttemptRepository || {
    beginAuthorizedAttempt: async () => ({
      id: 'attempt-default', providerCallId: 99,
      providerAccountId: 'provider-account-default', startedAt: new Date()
    }),
    markAttemptSubmitted: async (input) => calls.push(['attempt-submitted', input]),
    markAttemptUnknown: async (input) => calls.push(['attempt-unknown', input]),
    markAttemptCleared: async (input) => calls.push(['attempt-cleared', input]),
    markAttemptRejected: async (input) => calls.push(['attempt-rejected', input])
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
    mapPurchasedCard: (value) => value.data.card.id,
    mapCardProvisioning: (value) => value.data.status === 'failed'
      ? { state: 'failed', status: 'failed', failureReason: 'provider failed' }
      : value.data.status === 'pending'
        ? { state: 'pending', status: 'active', currentBalance: 0 }
        : { state: 'ready', status: 'active', currentBalance: 25, currency: 'USD', last4: '4242' },
    mapCardCredentials: () => ({ cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123' }),
    buildDirectOrderRequest: (input) => ({
      method: 'POST', path: '/third-party/orders/direct',
      body: { ...input, planType: input.planType || 'plus' }
    }),
    rechargeAttemptRepository: effectiveAttemptRepository,
    browserDispatchRepository,
    wait: async () => {},
    pollDelayMs: 1,
    failureConfirmDelayMs: 1
  });
  return { calls, providerCalls, context, workflow, cardProvider, rechargeProvider,
    rechargeAttemptRepository: effectiveAttemptRepository, handlers };
}

test('Browser submit hands off a durable dispatch job and never calls the recharge Provider', async () => {
  const dispatches = [];
  const state = setup({
    rechargeAttemptRepository: {
      beginAuthorizedAttempt: async () => ({
        id: 'browser-attempt-1', executorKind: 'BROWSER', startedAt: new Date()
      })
    },
    browserDispatchRepository: {
      enqueue: async (input) => { dispatches.push(input); return { status: 'QUEUED' }; }
    }
  });
  await state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.deepEqual(dispatches, [{
    jobKey: 'browser-attempt:browser-attempt-1',
    attemptId: 'browser-attempt-1',
    orderId: 'order-1',
    executorProfileId: null
  }]);
  assert.equal(state.providerCalls.some((call) => call.operation === 'create_direct'), false);
});

test('Foundation v2 consumes an explicit authorization and commits through the funds fence', async () => {
  const attemptCalls = [];
  const rechargeAttemptRepository = {
    beginAuthorizedAttempt: async (input) => {
      attemptCalls.push(['begin', input]);
      return {
        id: 'attempt-v2', providerCallId: 501, providerAccountId: 'provider-account-v2',
        startedAt: new Date('2026-08-20T12:00:00.000Z')
      };
    },
    markAttemptSubmitted: async (input) => attemptCalls.push(['submitted', input])
  };
  const state = setup({ rechargeAttemptRepository });
  await state.handlers.SUBMIT_RECHARGE({ id: 7, order_id: 'order-1', attempts: 1 });
  assert.equal(state.calls.some(([name]) => name === 'permit'), false);
  assert.equal(attemptCalls[0][0], 'begin');
  assert.equal(attemptCalls[1][0], 'submitted');
  assert.equal(attemptCalls[1][1].attemptId, 'attempt-v2');
  const providerCall = state.providerCalls.find((call) => call.operation === 'create_direct');
  assert.equal(providerCall.existingCall.id, 501);
  assert.equal(providerCall.rechargeAttemptId, 'attempt-v2');
});

test('submits one direct recharge and commits external identifiers', async () => {
  const state = setup();
  await state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 });
  const submitted = state.calls.find(([name]) => name === 'attempt-submitted');
  assert.equal(submitted[1].externalOrderId, '12');
  assert.equal(submitted[1].externalReference, 'DIRECT-fixture');
  assert.equal(state.providerCalls.find((call) => call.operation === 'create_direct').existingCall.id, 99);
});

test('marks a successful provider call unknown when the local submission commit fails', async () => {
  const state = setup();
  state.rechargeAttemptRepository.markAttemptSubmitted = async () => {
    throw new Error('database commit failed');
  };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'RECHARGE_COMMIT_UNKNOWN'
  );
  assert.equal(state.calls.at(-1)[0], 'attempt-unknown');
});

test('keeps provider configuration blockers recoverable and never calls the provider', async () => {
  const blockedConfiguration = {
    beginAuthorizedAttempt: async () => {
      throw Object.assign(new Error('write disabled'), { code: 'PROVIDER_WRITE_DISABLED' });
    }
  };
  const state = setup({ rechargeAttemptRepository: blockedConfiguration });
  let submissions = 0;
  state.rechargeProvider.createDirectOrder = async () => { submissions += 1; };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 7, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'RECHARGE_CONFIGURATION_BLOCKED'
      && error.retryable === true
      && error.refundAttempt === true
  );
  assert.equal(submissions, 0);
  assert.equal(state.calls.some(([name]) => name === 'transition'), false);
});

test('refreshes assigned card evidence immediately before creating a funds attempt', async () => {
  const state = setup();
  state.context.card.credentials = {
    cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
  };
  await state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.equal(state.calls.at(-1)[0], 'attempt-submitted');
  assert.equal(state.calls.some(([name]) => name === 'refresh-card'), true);
  assert.equal(state.providerCalls.some((call) => call.operation === 'card_details'), true);
});

test('does not create a funds attempt when the fresh assigned-card check is not ready', async () => {
  let attempts = 0;
  const state = setup({
    rechargeAttemptRepository: {
      beginAuthorizedAttempt: async () => { attempts += 1; }
    }
  });
  state.cardProvider.card = async () => ({ data: { status: 'pending' } });
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'CARD_NOT_READY'
      && error.retryable === true
      && error.refundAttempt === true
  );
  assert.equal(attempts, 0);
  assert.equal(state.providerCalls.some((call) => call.operation === 'create_direct'), false);
  assert.equal(state.calls.some(([name]) => name === 'refresh-card'), true);
});

test('purchases a card with the persisted idempotency key and commits one binding', async () => {
  const state = setup({ status: OrderStatus.CREATED });
  await state.handlers.PURCHASE_CARD({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.equal(state.calls[0][0], 'begin-card');
  assert.deepEqual(state.calls[1], [
    'card',
    'order-1',
    { providerCardId: 'card-1', cardTypeId: 7, fundedAmount: 25 }
  ]);
});

test('assigns an existing inventory card without calling a paid provider operation', async () => {
  const state = setup({ status: OrderStatus.CREATED });
  await state.handlers.ASSIGN_CARD({ id: 8, order_id: 'order-1', attempts: 1 });
  assert.deepEqual(state.calls, [['assign-card', 'order-1']]);
  assert.equal(state.providerCalls.length, 0);
});

test('waits safely when inventory is empty and never opens a card', async () => {
  const state = setup({ status: OrderStatus.CREATED });
  state.workflow.assignAvailableCard = async () => null;
  let purchases = 0;
  state.cardProvider.purchaseCard = async () => { purchases += 1; };
  await assert.rejects(
    state.handlers.ASSIGN_CARD({ id: 8, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'CARD_STOCK_EMPTY' && error.retryable === true
      && error.refundAttempt === true
  );
  assert.equal(purchases, 0);
});

test('recovers a missing purchase response ID from the persisted before-list without repurchasing', async () => {
  const state = setup({ status: OrderStatus.CARD_PURCHASING });
  let purchaseCalls = 0;
  state.cardProvider.purchaseCard = async () => { purchaseCalls += 1; };
  state.cardProvider.cards = async ({ page = 1, pageSize = 50 } = {}) => ({
    data: {
      cards: [{ id: 'old-card', cardType: 'Z-TEST' }, { id: 'new-card', cardType: 'Z-TEST' }],
      total: 2, page, pageSize
    }
  });
  await state.handlers.PURCHASE_CARD({
    id: 1,
    order_id: 'order-1',
    attempts: 2,
    max_attempts: 240,
    payload_json: {
      phase: 'PURCHASE_ACCEPTED',
      cardTypeId: '7',
      cardTypeName: 'Z-TEST',
      fundedAmount: '25',
      existingCardIds: ['old-card']
    }
  });
  assert.equal(purchaseCalls, 0);
  assert.deepEqual(state.calls.at(-1), [
    'card', 'order-1',
    { providerCardId: 'new-card', cardTypeId: '7', fundedAmount: '25' }
  ]);
});

test('prepares and records a redacted recharge request without submitting it', async () => {
  const state = setup({ status: OrderStatus.CARD_READY });
  state.context.order.plan_type = 'plus';
  state.context.card.credentials = {
    cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
  };
  let submissions = 0;
  state.rechargeProvider.createDirectOrder = async () => { submissions += 1; };
  await state.handlers.PREPARE_RECHARGE({ id: 9, order_id: 'order-1', attempts: 1 });
  assert.equal(submissions, 0);
  assert.deepEqual(state.calls.at(-1), [
    'prepayment', 'order-1', {
      requestMethod: 'POST',
      requestPath: '/third-party/orders/direct',
      planType: 'plus',
      cardLast4: '4242',
      submitted: false
    }
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
  assert.equal(state.calls.at(-1)[0], 'attempt-unknown');
});

test('closes a definite pre-create rejection without retrying or leaving a processing zombie', async () => {
  const state = setup();
  state.rechargeProvider.createDirectOrder = async () => {
    throw new ProviderError('capacity', { provider: 'zzshu', uncertain: false, retryable: true });
  };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 })
  );
  assert.equal(state.calls.at(-1)[0], 'attempt-rejected');
});

test('maps provider 40030 to a customer-repairable Session replacement state', async () => {
  const state = setup();
  state.rechargeProvider.createDirectOrder = async () => {
    throw new ProviderError('already plus', {
      provider: 'zzshu', status: 400, businessCode: '40030', uncertain: false
    });
  };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'TARGET_ACCOUNT_ALREADY_PLUS' && error.retryable === false
  );
  assert.equal(state.calls.some(([name]) => name === 'transition'), false);
  assert.equal(state.calls.find(([name]) => name === 'attempt-cleared')[1].resetSubmitTask, false);
  assert.deepEqual(state.calls.find(([name]) => name === 'session-required').slice(1), [
    'order-1', {
      failureCode: 'TARGET_ACCOUNT_ALREADY_PLUS',
      failureReason: 'Provider rejected target account because it already has Plus',
      customerActionCode: 'ACCOUNT_ALREADY_PLUS'
    }
  ]);
});

test('moves an expired local Session to customer repair before any recharge submission', async () => {
  const state = setup({ status: OrderStatus.CARD_READY });
  state.context.session = { accessToken: 'expired', sessionToken: 'expired', expires: '2020-01-01' };
  await assert.rejects(
    state.handlers.SUBMIT_RECHARGE({ id: 1, order_id: 'order-1', attempts: 0 }),
    (error) => error.code === 'SESSION_INVALID' && error.retryable === false
  );
  assert.deepEqual(state.calls.find(([name]) => name === 'session-required').slice(1), [
    'order-1', {
      failureCode: 'SESSION_INVALID',
      failureReason: 'Stored customer Session is invalid or expired',
      customerActionCode: 'SESSION_INVALID'
    }
  ]);
  assert.equal(state.providerCalls.length, 0);
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
  assert.equal(state.calls.at(-1)[0], 'recharge-failure');
  assert.equal(state.calls.at(-1)[1], 'order-1');
  assert.equal(state.calls.at(-1)[2].failureReason, 'confirmed');
});

test('marks success immediately and never guesses unknown states', async () => {
  const success = setup({
    status: OrderStatus.RECHARGE_PROCESSING,
    rechargeStatuses: [{
      status: 'success',
      isSubscriptionCancelled: 0,
      paymentAmount: '1150.00',
      paymentCurrency: 'PHP'
    }]
  });
  await success.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 2 });
  assert.equal(success.calls.at(-1)[0], 'success');
  assert.equal(success.calls.at(-1)[2].isSubscriptionCancelled, 0);
  assert.equal(success.calls.at(-1)[2].paymentAmount, '1150.00');

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
    status: OrderStatus.CANCELLATION_PENDING,
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
    status: OrderStatus.CANCELLATION_PENDING,
    rechargeStatuses: [{ status: 'success', isSubscriptionCancelled: 0 }]
  });
  await assert.rejects(
    state.handlers.RECHECK_CANCELLATION({ id: 3, order_id: 'order-1', attempts: 1, max_attempts: 60 }),
    (error) => error.code === 'CANCELLATION_PENDING' && error.retryable === true
  );
  assert.equal(state.calls.at(-1)[0], 'cancellation');
  assert.equal(state.calls.some((call) => call[0] === 'transition'), false);
});

test('moves a changed post-payment provider result to cancellation review with the review flag path', async () => {
  const state = setup({
    status: OrderStatus.CANCELLATION_PENDING,
    rechargeStatuses: [{ status: 'failed', failureReason: 'status changed after payment success' }]
  });
  await state.handlers.RECHECK_CANCELLATION({
    id: 3, order_id: 'order-1', attempts: 2, max_attempts: 60
  });
  assert.equal(state.calls.at(-1)[0], 'cancellation');
  assert.deepEqual(state.calls.at(-1)[4], { exhausted: true });
  assert.equal(state.calls.some((call) => call[0] === 'transition'), false);
});

test('moves exhausted cancellation query errors to review instead of leaving the order pending', async () => {
  const state = setup({ status: OrderStatus.CANCELLATION_PENDING });
  state.rechargeProvider.queryStatusWithSession = async () => {
    throw new ProviderError('provider unavailable', {
      provider: 'zzshu', uncertain: false, retryable: true
    });
  };
  await state.handlers.RECHECK_CANCELLATION({
    id: 3, order_id: 'order-1', attempts: 60, max_attempts: 60
  });
  assert.equal(state.calls.at(-1)[0], 'cancellation');
  assert.deepEqual(state.calls.at(-1)[2], { status: 'unknown', isSubscriptionCancelled: 0 });
  assert.deepEqual(state.calls.at(-1)[4], { exhausted: true });
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

test('syncs card transactions without treating a card recharge as a refund', async () => {
  const state = setup({ status: OrderStatus.RECHARGE_SUCCESS });
  state.cardProvider.transactions = async (_cardId, { page = 1, pageSize = 50 } = {}) => ({ data: { cardNo: '4242424242424242', total: 1, page, pageSize, transactions: [{
    id: 'txn-recharge-1', type: 'CARD_RECHARGE', status: 'success', amount: 16, currency: 'USD',
    platformCardId: 'provider-card-secret', merchantName: 'provider-controlled-value'
  }] } });
  await state.handlers.SYNC_CARD_TRANSACTIONS({ id: 4, order_id: 'order-1', attempts: 1 });
  const stored = state.calls.at(-1);
  assert.equal(stored[0], 'transactions');
  assert.equal(stored[1], 'order-1');
  assert.deepEqual(stored[2].map(({ rawHash, ...transaction }) => transaction), [{
    id: 'txn-recharge-1', type: 'CARD_RECHARGE', status: 'success', amount: '16', currency: 'USD',
    fee: null, tradeTime: null, relatedTxnId: null, settlementStatus: null,
    originalAmount: null, originalCurrency: null,
    merchantName: 'provider-controlled-value', merchantCountry: null, merchantMcc: null,
    classification: 'NOT_REFUND'
  }]);
  assert.match(stored[2][0].rawHash, /^[a-f0-9]{64}$/);
  assert.equal(state.calls.some(([name]) => name === 'refund'), false);
  const providerCall = state.providerCalls.find((call) => call.operation === 'card_transactions');
  assert.equal(providerCall.requestKey, 'card-transactions:order-1:task:4:page:1');
  const summary = providerCall.summarize(await state.cardProvider.transactions('card-1', { page: 1, pageSize: 50 }));
  assert.deepEqual(summary, { page: 1, count: 1, total: 1, types: ['CARD_RECHARGE'], statuses: ['success'] });
  assert.equal(JSON.stringify(summary).includes('4242424242424242'), false);
  assert.equal(JSON.stringify(summary).includes('provider-controlled-value'), false);
});

test('syncs every transaction page and preserves matching evidence fields', async () => {
  const state = setup({ status: OrderStatus.RECHARGE_SUCCESS });
  const requestedPages = [];
  state.cardProvider.transactions = async (_cardId, query) => {
    requestedPages.push(query.page);
    const items = query.page === 1 ? [{
      id: 'purchase-1', type: 'PURCHASE', status: 'success', amount: -15.97, currency: 'USD',
      fee: 0, tradeTime: '2026-08-18 21:02:08', relatedTxnId: '', settlementStatus: 'settled',
      originalAmount: 982.14, originalCurrency: 'PHP'
    }] : [{
      id: 'refund-candidate-1', type: 'REFUND', status: 'success', amount: 15.97, currency: 'USD',
      relatedTxnId: 'purchase-1'
    }];
    return { data: { transactions: items, total: 2, page: query.page, pageSize: query.pageSize } };
  };
  state.cardProvider.card = async () => ({ data: { status: 'active', cardBalance: '15.99', currency: 'USD' } });

  await state.handlers.SYNC_CARD_TRANSACTIONS({ id: 9, order_id: 'order-1', attempts: 1 });

  assert.deepEqual(requestedPages, [1, 2]);
  const stored = state.calls.at(-1);
  assert.equal(stored[0], 'transactions');
  assert.equal(stored[2].length, 2);
  assert.equal(stored[2][0].tradeTime, '2026-08-18 21:02:08');
  assert.equal(stored[2][0].originalAmount, '982.14');
  assert.equal(stored[2][1].relatedTxnId, 'purchase-1');
  assert.equal(stored[2][1].classification, 'REFUND_CANDIDATE');
  assert.deepEqual(stored[3], { currentBalance: '15.99', currency: 'USD' });
});

test('fails closed when transaction pagination metadata is inconsistent', async () => {
  const state = setup();
  state.cardProvider.transactions = async () => ({
    data: { transactions: [], total: 1, page: 99, pageSize: 50 }
  });
  await assert.rejects(
    state.handlers.SYNC_CARD_TRANSACTIONS({ id: 10, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'TRANSACTION_PAGINATION_INVALID'
  );
  assert.equal(state.calls.some(([name]) => name === 'transactions'), false);
});

test('accepts a complete unpaginated transaction response but rejects an incomplete one', async () => {
  const complete = setup();
  complete.cardProvider.transactions = async () => ({
    data: { transactions: [{ id: 'tx-1', type: 'PURCHASE', status: 'success', amount: -1, currency: 'USD' }], total: 1 }
  });
  await complete.handlers.SYNC_CARD_TRANSACTIONS({ id: 11, order_id: 'order-1', attempts: 1 });
  assert.equal(complete.calls.at(-1)[2].length, 1);

  const incomplete = setup();
  incomplete.cardProvider.transactions = complete.cardProvider.transactions;
  incomplete.cardProvider.transactions = async () => ({
    data: { transactions: [{ id: 'tx-1', type: 'PURCHASE', status: 'success', amount: -1, currency: 'USD' }], total: 2 }
  });
  await assert.rejects(
    incomplete.handlers.SYNC_CARD_TRANSACTIONS({ id: 12, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'TRANSACTION_PAGINATION_UNSUPPORTED'
  );
});

test('rejects transaction sync when the order has no bound card', async () => {
  const state = setup();
  state.context.card = null;
  await assert.rejects(
    state.handlers.SYNC_CARD_TRANSACTIONS({ id: 4, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'CARD_NOT_BOUND'
  );
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.calls.length, 0);
});
