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
  mapCardCredentials,
  pollDelayMs = 5_000,
  failureConfirmDelayMs = 2_500,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
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

    const cardEnvelope = await recordCall({
      orderId: task.order_id,
      provider: 'hnskj',
      operation: 'card_details',
      attemptNo: task.attempts,
      action: () => cardProvider.card(context.card.provider_card_id),
      summarize: () => ({ cardId: context.card.provider_card_id })
    });
    const credentials = mapCardCredentials(cardEnvelope);

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

  async function queryRecharge(task, attemptNo) {
    const context = await workflow.loadOrderContext(task.order_id);
    return recordCall({
      orderId: task.order_id,
      provider: 'zzshu',
      operation: 'query_status',
      requestKey: `recharge-status:${task.order_id}`,
      attemptNo,
      action: () => rechargeProvider.queryStatus(context.order.recharge_card_key),
      summarize: (value) => value
    });
  }

  async function pollRecharge(task) {
    let status = await queryRecharge(task, task.attempts);
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
      await workflow.transition(task.order_id, OrderStatus.RECHARGE_SUCCESS, 'provider confirmed success', status);
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

  return {
    PURCHASE_CARD: purchaseCard,
    SUBMIT_RECHARGE: submitRecharge,
    POLL_RECHARGE: pollRecharge
  };
}
