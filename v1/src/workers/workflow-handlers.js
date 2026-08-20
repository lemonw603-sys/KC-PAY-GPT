import { OrderStatus } from '../domain/order-status.js';
import { TaskExecutionError } from './task-runner.js';
import { readAllCardTransactions } from '../services/card-transaction-reader.js';

function pendingError(delayMs) {
  return new TaskExecutionError('Recharge is still processing', {
    code: 'RECHARGE_PENDING',
    retryable: true,
    delayMs
  });
}

export function createWorkflowHandlers({
  workflow,
  cardProvider,
  rechargeProvider,
  recordCall,
  mapPurchasedCard,
  mapCardProvisioning,
  mapCardCredentials,
  buildDirectOrderRequest,
  pollDelayMs = 5_000,
  cancellationDelayMs = 60_000,
  failureConfirmDelayMs = 2_500,
  rechargeWritesEnabled = true,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  function withoutLatestSession(value) {
    if (Array.isArray(value)) return value.map(withoutLatestSession);
    if (!value || typeof value !== 'object') return value;
    const { latestSession, ...safe } = value;
    return safe;
  }

  function cardIdFromListRecord(record) {
    const value = record?.id ?? record?.cardId ?? record?.card_id;
    return value == null || String(value).trim() === '' ? null : String(value).trim();
  }

  function cardTypeMatches(record, baseline) {
    const typeId = record?.cardTypeId ?? record?.card_type_id;
    const typeName = record?.cardType ?? record?.card_type;
    return (typeId != null && String(typeId) === String(baseline.cardTypeId))
      || (typeName != null && String(typeName) === String(baseline.cardTypeName));
  }

  async function loadAllCards() {
    const first = await cardProvider.cards({ page: 1, pageSize: 50 });
    const cards = [...first.data.cards];
    const pages = Math.ceil(first.data.total / first.data.pageSize);
    for (let page = 2; page <= pages; page += 1) {
      const next = await cardProvider.cards({ page, pageSize: first.data.pageSize });
      cards.push(...next.data.cards);
    }
    return cards;
  }

  async function identifyPurchasedCard(task, baseline) {
    const existing = new Set((baseline.existingCardIds || []).map(String));
    const candidates = (await loadAllCards())
      .filter((record) => cardTypeMatches(record, baseline))
      .map(cardIdFromListRecord)
      .filter((id) => id && !existing.has(id));
    const unique = [...new Set(candidates)];
    if (unique.length === 1) {
      await workflow.commitPurchasedCard(task.order_id, {
        providerCardId: unique[0],
        cardTypeId: baseline.cardTypeId,
        fundedAmount: baseline.fundedAmount
      });
      return;
    }
    if (unique.length > 1) {
      await workflow.reviewCardPurchase(
        task.order_id,
        'multiple new cards matched purchase baseline; automatic rebuy forbidden',
        { candidateCount: unique.length }
      );
      return;
    }
    if (task.attempts >= task.max_attempts) {
      await workflow.reviewCardPurchase(
        task.order_id,
        'purchased card could not be identified before recovery timeout; automatic rebuy forbidden'
      );
      return;
    }
    throw new TaskExecutionError('Purchased card is not visible in card list yet', {
      code: 'CARD_IDENTIFICATION_PENDING', retryable: true, delayMs: pollDelayMs
    });
  }

  async function purchaseCard(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status === OrderStatus.CREATED) {
      const cardTypes = await cardProvider.cardTypes();
      const selected = cardTypes.data.cardTypes.find(
        (item) => String(item.id) === String(context.order.card_type_id)
      );
      if (!selected || !cardTypes.data.purchaseEnabled) {
        throw new TaskExecutionError('Configured card type is unavailable for purchase', {
          code: 'CARD_TYPE_UNAVAILABLE'
        });
      }
      const baseline = {
        cardTypeId: String(context.order.card_type_id),
        cardTypeName: selected.cardType,
        fundedAmount: String(context.order.open_card_amount),
        existingCardIds: (await loadAllCards()).map(cardIdFromListRecord).filter(Boolean)
      };
      await workflow.beginCardPurchase(task.order_id, task.id, baseline);
      task.payload_json = { ...baseline, phase: 'PURCHASE_STARTING' };
    } else if (context.order.status !== OrderStatus.CARD_PURCHASING) {
      throw new TaskExecutionError(`Order cannot purchase card from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    } else {
      const baseline = typeof task.payload_json === 'string'
        ? JSON.parse(task.payload_json) : task.payload_json;
      if (!baseline?.existingCardIds || !baseline?.cardTypeId) {
        await workflow.reviewCardPurchase(
          task.order_id,
          'card purchase state lacks recovery baseline; automatic rebuy forbidden'
        );
        return;
      }
      await identifyPurchasedCard(task, baseline);
      return;
    }

    const baseline = task.payload_json;
    const result = await recordCall({
      orderId: task.order_id,
      provider: 'hnskj',
      operation: 'purchase_card',
      requestKey: context.order.card_purchase_idempotency_key,
      attemptNo: task.attempts,
      sideEffecting: true,
      action: () => cardProvider.purchaseCard({
        cardTypeId: context.order.card_type_id,
        openCardAmount: context.order.open_card_amount,
        idempotencyKey: context.order.card_purchase_idempotency_key,
        remark: context.order.public_no
      }),
      summarize: (value) => {
        try {
          return { accepted: true, providerCardId: mapPurchasedCard(value) };
        } catch {
          return { accepted: true, providerCardId: null, recoveryRequired: true };
        }
      }
    });
    let providerCardId;
    try {
      providerCardId = mapPurchasedCard(result);
    } catch (error) {
      if (!error?.uncertain || error?.provider !== 'hnskj') throw error;
      await workflow.markCardPurchaseAccepted(task.order_id, task.id, baseline);
      await identifyPurchasedCard(task, { ...baseline, phase: 'PURCHASE_ACCEPTED' });
      return;
    }
    await workflow.commitPurchasedCard(task.order_id, {
      providerCardId,
      cardTypeId: context.order.card_type_id,
      fundedAmount: context.order.open_card_amount
    });
  }

  async function assignCard(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status !== OrderStatus.CREATED) {
      throw new TaskExecutionError(`Order cannot receive inventory card from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    const assigned = await workflow.assignAvailableCard(task.order_id);
    if (!assigned) {
      throw new TaskExecutionError('No suitable inventory card is available', {
        code: 'CARD_STOCK_EMPTY', retryable: true, delayMs: 60_000
      });
    }
  }

  async function prepareRecharge(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status !== OrderStatus.CARD_READY) {
      throw new TaskExecutionError(`Order cannot prepare recharge from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    if (!context.card?.credentials) {
      throw new TaskExecutionError('Cached card credentials are missing', {
        code: 'CARD_CREDENTIALS_MISSING'
      });
    }
    const request = buildDirectOrderRequest({
      ...context.card.credentials,
      token: context.session,
      planType: context.order.plan_type || 'plus'
    });
    if (request.method !== 'POST' || request.path !== '/third-party/orders/direct') {
      throw new TaskExecutionError('Recharge request contract is invalid', {
        code: 'RECHARGE_REQUEST_INVALID'
      });
    }
    await workflow.recordPrepaymentReady(task.order_id, {
      requestMethod: request.method,
      requestPath: request.path,
      planType: String(request.body.planType),
      cardLast4: String(context.card.credentials.cardNumber).slice(-4),
      submitted: false
    });
  }

  async function submitRecharge(task) {
    if (!rechargeWritesEnabled) {
      throw new TaskExecutionError('Recharge submission is hard-disabled', {
        code: 'RECHARGE_WRITES_DISABLED', retryable: false
      });
    }
    const context = await workflow.loadOrderContext(task.order_id);
    const permit = await workflow.consumeRechargePermit(task.order_id, task.id, task.attempts);
    if (!permit.allowed) {
      throw new TaskExecutionError(`Recharge permit rejected: ${permit.reason}`, {
        code: 'RECHARGE_PERMIT_REQUIRED', retryable: false
      });
    }
    if (context.order.status !== OrderStatus.CARD_READY) {
      throw new TaskExecutionError(`Order cannot submit recharge from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }

    let credentials = context.card.credentials;
    if (!credentials) {
      const cardEnvelope = await recordCall({
        orderId: task.order_id,
        provider: 'hnskj',
        operation: 'card_details',
        attemptNo: task.attempts,
        action: () => cardProvider.card(context.card.provider_card_id),
        summarize: () => ({ cardId: context.card.provider_card_id })
      });
      credentials = mapCardCredentials(cardEnvelope);
    }

    let submission;
    try {
      submission = await recordCall({
        orderId: task.order_id,
        provider: 'zzshu',
        operation: 'create_direct',
        attemptNo: task.attempts,
        sideEffecting: true,
        existingCall: permit.providerCall,
        action: () => rechargeProvider.createDirectOrder({
          ...credentials,
          token: context.session,
          planType: 'plus'
        }),
        summarize: (value) => value
      });
    } catch (error) {
      await workflow.transition(
        task.order_id,
        error.uncertain ? OrderStatus.SUBMIT_UNKNOWN : OrderStatus.RECHARGE_FAILED,
        error.uncertain ? 'recharge submission result unknown' : 'recharge submission rejected'
      );
      throw new TaskExecutionError(error.message || 'Recharge submission failed', {
        code: error.uncertain ? 'RECHARGE_SUBMIT_UNKNOWN' : 'RECHARGE_SUBMIT_REJECTED',
        retryable: false,
        cause: error
      });
    }
    try {
      await workflow.commitRechargeSubmission(task.order_id, submission);
    } catch (error) {
      await workflow.transition(
        task.order_id,
        OrderStatus.SUBMIT_UNKNOWN,
        'provider accepted recharge but local commit failed'
      );
      throw new TaskExecutionError('Recharge was accepted but could not be committed locally', {
        code: 'RECHARGE_COMMIT_UNKNOWN', retryable: false, cause: error
      });
    }
  }

  async function verifyCard(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status !== OrderStatus.CARD_PROVISIONING) {
      throw new TaskExecutionError(`Order cannot verify card from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    const envelope = await recordCall({
      orderId: task.order_id,
      provider: 'hnskj',
      operation: 'card_readiness',
      requestKey: `card-readiness:${task.order_id}`,
      attemptNo: task.attempts,
      action: () => cardProvider.card(context.card.provider_card_id),
      summarize: (value) => mapCardProvisioning(value, context.order.minimum_required_card_balance)
    });
    const snapshot = mapCardProvisioning(envelope, context.order.minimum_required_card_balance);
    if (snapshot.state === 'ready') {
      const credentials = mapCardCredentials(envelope);
      await workflow.commitCardReady(task.order_id, snapshot, credentials);
      return;
    }
    if (snapshot.state === 'failed') {
      await workflow.failCardProvisioning(task.order_id, snapshot);
      return;
    }
    if (task.attempts >= task.max_attempts) {
      await workflow.reviewCardProvisioning(task.order_id, 'card readiness timed out; manual review required');
      return;
    }
    throw new TaskExecutionError('Card is still provisioning', {
      code: 'CARD_PROVISIONING_PENDING', retryable: true, delayMs: pollDelayMs
    });
  }

  async function queryRecharge(task, attemptNo, {
    includeSession = false,
    operation = 'query_status',
    requestKey = `recharge-status:${task.order_id}`
  } = {}) {
    const context = await workflow.loadOrderContext(task.order_id);
    return recordCall({
      orderId: task.order_id,
      provider: 'zzshu',
      operation,
      requestKey,
      attemptNo,
      action: () => includeSession && typeof rechargeProvider.queryStatusWithSession === 'function'
        ? rechargeProvider.queryStatusWithSession(context.order.recharge_card_key)
        : rechargeProvider.queryStatus(context.order.recharge_card_key),
      summarize: withoutLatestSession
    });
  }

  async function pollRecharge(task) {
    let status = await queryRecharge(task, task.attempts, { includeSession: true });
    if (Array.isArray(status)) [status] = status;
    if (status.status === 'pending' || status.status === 'processing') {
      throw pendingError(pollDelayMs);
    }
    if (status.status === 'failed') {
      await wait(failureConfirmDelayMs);
      let confirmed = await queryRecharge(task, task.attempts + 1);
      if (Array.isArray(confirmed)) [confirmed] = confirmed;
      status = confirmed;
      if (status.status === 'pending' || status.status === 'processing') {
        throw pendingError(pollDelayMs);
      }
    }

    if (status.status === 'success') {
      await workflow.commitRechargeSuccess(task.order_id, withoutLatestSession(status), status.latestSession);
      return;
    }
    if (status.status === 'failed') {
      await workflow.transition(task.order_id, OrderStatus.RECHARGE_FAILED, 'provider confirmed failure', status);
      return;
    }
    throw new TaskExecutionError(`Unsupported recharge status: ${status.status}`, {
      code: 'UNKNOWN_RECHARGE_STATUS'
    });
  }

  async function recheckCancellation(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status !== OrderStatus.RECHARGE_SUCCESS) {
      throw new TaskExecutionError(`Order cannot recheck cancellation from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    let status = await queryRecharge(task, task.attempts, {
      includeSession: true,
      operation: 'recheck_cancellation',
      requestKey: `cancellation-status:${task.order_id}`
    });
    if (Array.isArray(status)) [status] = status;
    if (status.status !== 'success') {
      await workflow.transition(
        task.order_id,
        OrderStatus.RECONCILIATION_REQUIRED,
        'provider status changed after confirmed success',
        withoutLatestSession(status)
      );
      return;
    }
    const exhausted = status.isSubscriptionCancelled !== 1 && task.attempts >= task.max_attempts;
    await workflow.commitCancellationStatus(
      task.order_id,
      withoutLatestSession(status),
      status.latestSession,
      { exhausted }
    );
    if (status.isSubscriptionCancelled === 1 || exhausted) return;
    throw new TaskExecutionError('Subscription cancellation is not confirmed yet', {
      code: 'CANCELLATION_PENDING', retryable: true, delayMs: cancellationDelayMs
    });
  }

  async function syncCardTransactions(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (!context.card?.provider_card_id) {
      throw new TaskExecutionError('Order has no provider card', { code: 'CARD_NOT_BOUND' });
    }
    const transactions = await readAllCardTransactions({
      fetchPage: (page, pageSize) => recordCall({
        orderId: task.order_id,
        provider: 'hnskj',
        operation: 'card_transactions',
        requestKey: `card-transactions:${task.order_id}:task:${task.id}:page:${page}`,
        attemptNo: task.attempts,
        action: () => cardProvider.transactions(context.card.provider_card_id, { page, pageSize }),
        summarize: (value) => ({
          page: value.data.page,
          count: value.data.transactions.length,
          total: value.data.total,
          types: [...new Set(value.data.transactions.map((item) => item.type))],
          statuses: [...new Set(value.data.transactions.map((item) => item.status))]
        })
      })
    });
    let cardSnapshot = null;
    if (typeof cardProvider.card === 'function') {
      const cardEnvelope = await recordCall({
        orderId: task.order_id,
        provider: 'hnskj',
        operation: 'card_details_after_transaction_sync',
        requestKey: `card-details:${task.order_id}:task:${task.id}`,
        attemptNo: task.attempts,
        action: () => cardProvider.card(context.card.provider_card_id),
        summarize: (value) => {
          const data = value?.data?.card ?? value?.data ?? {};
          return { status: data.status || null, currentBalance: data.cardBalance ?? data.currentBalance ?? null, currency: data.currency || null };
        }
      });
      const data = cardEnvelope?.data?.card ?? cardEnvelope?.data ?? {};
      cardSnapshot = { currentBalance: data.cardBalance ?? data.currentBalance ?? null, currency: data.currency || null };
    }
    await workflow.commitCardTransactions(task.order_id, transactions, cardSnapshot);
  }

  return {
    ASSIGN_CARD: assignCard,
    PURCHASE_CARD: purchaseCard,
    VERIFY_CARD: verifyCard,
    PREPARE_RECHARGE: prepareRecharge,
    SUBMIT_RECHARGE: submitRecharge,
    POLL_RECHARGE: pollRecharge,
    RECHECK_CANCELLATION: recheckCancellation,
    SYNC_CARD_TRANSACTIONS: syncCardTransactions
  };
}
