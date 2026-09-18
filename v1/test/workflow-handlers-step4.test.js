import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowHandlers } from '../src/workers/workflow-handlers.js';
import { OrderStatus } from '../src/domain/order-status.js';

// 生产实查（2026-09-18）card_transactions 里 hnskj 卡 OpenAI 扣款的真实行形状。
const HNSKJ_PURCHASE_ROW = {
  provider_transaction_id: 'tx-real-1', transaction_type: 'PURCHASE', status: 'SETTLED',
  amount: '15.710000', currency: 'USD', original_amount: '982.140000', original_currency: 'PHP',
  merchant_name: 'OPENAI', settlement_status: null, trade_time_raw: '2026-09-17 09:34:34', occurred_at: null,
  first_seen_at: new Date('2026-09-17T01:35:00Z')
};
const HNSKJ_FAILED_ROW = { ...HNSKJ_PURCHASE_ROW, provider_transaction_id: 'tx-real-2', transaction_type: 'purchase',
  status: 'failed', amount: '-78.240000', settlement_status: 'not_settle', merchant_name: 'OPENAI *CHATGPT SUBSCR' };

function setup({ status = OrderStatus.CREATED, candidate = null, cardKey = null, purchases = [],
  rechargeStatuses = [], syncFails = false, supportsApiSync = true } = {}) {
  const calls = [];
  const context = {
    order: { status, public_no: 'ORD-1', minimum_required_card_balance: 16, recharge_card_key: cardKey, recharge_executor_kind: 'API' },
    card: { id: 'card-uuid', provider_card_id: '5622', provider_account_id: 'acct-101', card_type_id: 23, supports_api_sync: supportsApiSync },
    session: { accessToken: 'a'.repeat(40), sessionToken: 's', expires: new Date(Date.now() + 3_600_000).toISOString() }
  };
  let assignments = 0;
  const workflow = {
    loadOrderContext: async () => context,
    findStaleInventoryCandidate: async (orderId) => { calls.push(['find-candidate', orderId]); return candidate; },
    assignAvailableCard: async (orderId) => {
      calls.push(['assign-card', orderId]);
      assignments += 1;
      return candidate && !syncFails ? { providerCardId: candidate.providerCardId } : { waitingForCard: true };
    },
    findUnknownSubmission: async () => ({ attemptId: 'att-1', orderStatus: status, cardKey, submittedAt: new Date('2026-09-17T01:30:00Z') }),
    listCardPurchasesSince: async (cardId, since) => { calls.push(['purchases', cardId, since]); return purchases; },
    escalateUnknownSubmission: async (...args) => calls.push(['escalate', ...args]),
    commitRechargeSuccess: async (...args) => calls.push(['success', ...args]),
    commitRechargeFailure: async (...args) => calls.push(['recharge-failure', ...args])
  };
  const syncCardOnDemand = async (card, options) => {
    calls.push(['sync', card, options]);
    if (syncFails) throw Object.assign(new Error('maintenance'), { code: 'PROVIDER_MAINTENANCE' });
    return { requestCount: 2 };
  };
  const handlers = createWorkflowHandlers({
    workflow, cardProvider: {}, rechargeProvider: { queryStatus: async () => rechargeStatuses.shift(), queryStatusWithSession: async () => rechargeStatuses.shift() },
    recordCall: async (input) => input.action(), mapCardProvisioning: () => ({}), mapCardCredentials: () => ({}),
    buildDirectOrderRequest: () => ({}), rechargeAttemptRepository: {}, syncCardOnDemand, wait: async () => {},
    unknownReconcileDelayMs: 60_000
  });
  return { handlers, calls, get assignments() { return assignments; } };
}

const candidate = { id: 'card-uuid', providerCardId: '5622', providerAccountId: 'acct-101', cardTypeId: 23 };

test('assignCard syncs the stale candidate on the spot, then assigns under the unchanged eligibility rule', async () => {
  const s = setup({ candidate });
  await s.handlers.ASSIGN_CARD({ id: 1, order_id: 'order-1', attempts: 1 });
  assert.deepEqual(s.calls.map((c) => c[0]), ['find-candidate', 'sync', 'assign-card']);
  assert.equal(s.calls[1][1].providerCardId, '5622');
  assert.deepEqual(s.calls[1][2], { orderId: 'order-1', attemptNo: 1 });
});

test('assignCard: sync failure → no assignment, no opening, retry in 60s, no sync job queued', async () => {
  const s = setup({ candidate, syncFails: true });
  await assert.rejects(
    s.handlers.ASSIGN_CARD({ id: 1, order_id: 'order-1', attempts: 1 }),
    (error) => error.code === 'CARD_SYNC_FAILED' && error.retryable === true && error.delayMs === 60_000
  );
  assert.deepEqual(s.calls.map((c) => c[0]), ['find-candidate', 'sync', 'assign-card']);
  assert.equal(s.calls.some((c) => /open|purchase|job/i.test(c[0])), false);
});

test('assignCard without a stale candidate never calls the provider', async () => {
  const s = setup({ candidate: null });
  await assert.rejects(s.handlers.ASSIGN_CARD({ id: 1, order_id: 'order-1', attempts: 1 }), (error) => error.code === 'CARD_STOCK_EMPTY');
  assert.deepEqual(s.calls.map((c) => c[0]), ['find-candidate', 'assign-card']);
});

test('SUBMIT_UNKNOWN with a cardKey: ZZSHU success closes the order, no card sync needed', async () => {
  const s = setup({ status: OrderStatus.SUBMIT_UNKNOWN, cardKey: 'DIRECT-k', rechargeStatuses: [{ status: 'success', isSubscriptionCancelled: 1 }] });
  await s.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 1, max_attempts: 30 });
  assert.equal(s.calls.at(-1)[0], 'success');
  assert.equal(s.calls.some((c) => c[0] === 'sync'), false);
});

test('SUBMIT_UNKNOWN with a cardKey: pending keeps polling until the bounded window is used up, then escalates with account evidence', async () => {
  const pending = setup({ status: OrderStatus.SUBMIT_UNKNOWN, cardKey: 'DIRECT-k', rechargeStatuses: [{ status: 'pending' }] });
  await assert.rejects(pending.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 3, max_attempts: 30 }),
    (error) => error.code === 'RECHARGE_PENDING' && error.delayMs === 60_000);
  assert.equal(pending.calls.some((c) => c[0] === 'escalate'), false);

  const exhausted = setup({ status: OrderStatus.SUBMIT_UNKNOWN, cardKey: 'DIRECT-k', rechargeStatuses: [{ status: 'pending' }] });
  await exhausted.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 30, max_attempts: 30 });
  const escalate = exhausted.calls.find((c) => c[0] === 'escalate');
  assert.equal(escalate[2].reasonCode, 'PROVIDER_STILL_PENDING');
  assert.match(escalate[2].evidence.account.summary, /ZZSHU 返回 pending/);
});

test('SUBMIT_UNKNOWN without a cardKey: card-side charge found → escalate to a person with both evidence lines (never auto-success)', async () => {
  const s = setup({ status: OrderStatus.SUBMIT_UNKNOWN, purchases: [HNSKJ_FAILED_ROW, HNSKJ_PURCHASE_ROW] });
  await s.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 1, max_attempts: 30 });
  assert.deepEqual(s.calls.map((c) => c[0]), ['sync', 'purchases', 'escalate']);
  const [, orderId, { reasonCode, evidence }] = s.calls.at(-1);
  assert.equal(orderId, 'order-1');
  assert.equal(reasonCode, 'CARD_CHARGED_ACCOUNT_UNVERIFIABLE');
  assert.equal(evidence.card.charged, true);
  assert.equal(evidence.card.candidates.length, 1, 'the failed row must not count as a charge');
  assert.equal(evidence.card.candidates[0].at, '2026-09-17T01:34:34.000Z', 'hnskj trade_time_raw is UTC+8');
  assert.match(evidence.account.summary, /没有返回 cardKey/);
  assert.equal(s.calls.some((c) => c[0] === 'success'), false);
});

test('SUBMIT_UNKNOWN without a cardKey: no charge → keep the funds fence and poll; exhausted → escalate with "no charge in window"', async () => {
  const polling = setup({ status: OrderStatus.SUBMIT_UNKNOWN, purchases: [HNSKJ_FAILED_ROW] });
  await assert.rejects(polling.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 2, max_attempts: 30 }),
    (error) => error.code === 'RECHARGE_PENDING');
  assert.equal(polling.calls.some((c) => ['escalate', 'success', 'recharge-failure', 'attempt-cleared'].includes(c[0])), false);

  const exhausted = setup({ status: OrderStatus.SUBMIT_UNKNOWN, purchases: [] });
  await exhausted.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 30, max_attempts: 30 });
  const escalate = exhausted.calls.find((c) => c[0] === 'escalate');
  assert.equal(escalate[2].reasonCode, 'NO_CARD_CHARGE_IN_WINDOW_ACCOUNT_UNVERIFIABLE');
  assert.equal(escalate[2].evidence.card.charged, false);
});

test('POLL_RECHARGE on a normal RECHARGE_PROCESSING order is untouched by the unknown branch', async () => {
  const s = setup({ status: OrderStatus.RECHARGE_PROCESSING, cardKey: 'DIRECT-k', rechargeStatuses: [{ status: 'success', isSubscriptionCancelled: 1 }] });
  await s.handlers.POLL_RECHARGE({ id: 2, order_id: 'order-1', attempts: 1, max_attempts: 720 });
  assert.equal(s.calls.at(-1)[0], 'success');
  assert.equal(s.calls.some((c) => ['sync', 'purchases', 'escalate'].includes(c[0])), false);
});
