import { OrderStatus } from '../domain/order-status.js';
import { TaskExecutionError } from './task-runner.js';

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
  pollDelayMs = 5_000,
  cancellationDelayMs = 60_000,
  failureConfirmDelayMs = 2_500,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  function withoutLatestSession(value) {
    if (Array.isArray(value)) return value.map(withoutLatestSession);
    if (!value || typeof value !== 'object') return value;
    const { latestSession, ...safe } = value;
    return safe;
  }
  async function purchaseCard(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status === OrderStatus.CREATED) {
      await workflow.transition(task.order_id, OrderStatus.CARD_PURCHASING, 'begin card purchase');
    } else if (context.order.status !== OrderStatus.CARD_PURCHASING) {
      throw new TaskExecutionError(`Order cannot purchase card from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }

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
      summarize: (value) => mapPurchasedCard(value)
    });
    const card = mapPurchasedCard(result);
    await workflow.commitPurchasedCard(task.order_id, card);
  }

  async function submitRecharge(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status === OrderStatus.CARD_READY) {
      await workflow.transition(task.order_id, OrderStatus.SUBMITTING, 'begin recharge submission');
    } else if (context.order.status !== OrderStatus.SUBMITTING) {
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

    try {
      const submission = await recordCall({
        orderId: task.order_id,
        provider: 'zzshu',
        operation: 'create_direct',
        attemptNo: task.attempts,
        sideEffecting: true,
        action: () => rechargeProvider.createDirectOrder({
          ...credentials,
          token: context.session,
          planType: 'plus'
        }),
        summarize: (value) => value
      });
      await workflow.commitRechargeSubmission(task.order_id, submission);
    } catch (error) {
      if (error.retryable) throw error;
      await workflow.transition(
        task.order_id,
        error.uncertain ? OrderStatus.SUBMIT_UNKNOWN : OrderStatus.RECHARGE_FAILED,
        error.uncertain ? 'recharge submission result unknown' : 'recharge submission rejected'
      );
      throw error;
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
      summarize: (value) => mapCardProvisioning(value, context.order.open_card_amount)
    });
    const snapshot = mapCardProvisioning(envelope, context.order.open_card_amount);
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

  return {
    PURCHASE_CARD: purchaseCard,
    VERIFY_CARD: verifyCard,
    SUBMIT_RECHARGE: submitRecharge,
    POLL_RECHARGE: pollRecharge,
    RECHECK_CANCELLATION: recheckCancellation
  };
}
