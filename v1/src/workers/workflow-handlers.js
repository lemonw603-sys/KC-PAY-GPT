import { OrderStatus } from '../domain/order-status.js';
import { validateChatGptSession } from '../domain/session-validation.js';
import { TaskExecutionError } from './task-runner.js';
import { readAllCardTransactions } from '../services/card-transaction-reader.js';
import { assessCardSideCharge } from '../services/unknown-submission-evidence.js';

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
  mapCardProvisioning,
  mapCardCredentials,
  buildDirectOrderRequest,
  rechargeAttemptRepository = null,
  browserDispatchRepository = null,
  // 第④步：分卡时「当场同步这一张」（card-on-demand-sync-service）。null = 没配 hnskj 只读
  // 凭证，退回「等下一轮」。
  syncCardOnDemand = null,
  pollDelayMs = 5_000,
  cancellationDelayMs = 60_000,
  unknownReconcileDelayMs = 60_000,
  failureConfirmDelayMs = 2_500,
  rechargeWritesEnabled = true,
  browserDispatchEnabled = true,
  holdBeforeProvider = false,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (!rechargeAttemptRepository) {
    throw new TypeError('rechargeAttemptRepository is required');
  }
  function withoutLatestSession(value) {
    if (Array.isArray(value)) return value.map(withoutLatestSession);
    if (!value || typeof value !== 'object') return value;
    const { latestSession, ...safe } = value;
    return safe;
  }

  async function requireFreshCustomerSession(orderId, session) {
    try {
      validateChatGptSession(session);
    } catch {
      await workflow.markSessionReplacementRequired(orderId, {
        failureCode: 'SESSION_INVALID',
        failureReason: 'Stored customer Session is invalid or expired',
        customerActionCode: 'SESSION_INVALID'
      });
      throw new TaskExecutionError('Customer must replace an invalid Session', {
        code: 'SESSION_INVALID', retryable: false
      });
    }
  }

  async function assignCard(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (![OrderStatus.CREATED, OrderStatus.WAITING_FOR_CARD].includes(context.order.status)) {
      throw new TaskExecutionError(`Order cannot receive inventory card from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    // 第④步（面二⑨，D-266）：资格规则里的 15 分钟新鲜度不改；候选卡过期就当场同步这一张
    // （卡详情 1 次 + 流水 ≥1 页），同步完再按同一条资格规则判。同步失败 → 不分、不重开、
    // 不换卡台，60 秒后再来；连续 5 次失败的卡候选查询自己会跳过。
    let onDemandSync = null;
    if (typeof syncCardOnDemand === 'function' && typeof workflow.findStaleInventoryCandidate === 'function') {
      const candidate = await workflow.findStaleInventoryCandidate(task.order_id);
      if (candidate) {
        try {
          const synced = await syncCardOnDemand(candidate, { orderId: task.order_id, attemptNo: task.attempts });
          onDemandSync = { ok: true, cardId: candidate.id, requestCount: synced?.requestCount ?? null };
        } catch (error) {
          onDemandSync = { ok: false, cardId: candidate.id,
            code: error?.code || error?.kind || 'CARD_SYNC_FAILED' };
        }
      }
    }
    const assigned = await workflow.assignAvailableCard(task.order_id);
    if (!assigned) {
      throw new TaskExecutionError('No suitable inventory card is available', {
        code: 'CARD_STOCK_EMPTY', retryable: true, delayMs: 60_000, refundAttempt: true
      });
    }
    if (assigned.waitingForCard) {
      throw new TaskExecutionError(
        onDemandSync && !onDemandSync.ok
          ? `No eligible inventory card; on-demand card sync failed (${onDemandSync.code})`
          : 'No suitable inventory card is available', {
          code: onDemandSync && !onDemandSync.ok ? 'CARD_SYNC_FAILED' : 'CARD_STOCK_EMPTY',
          retryable: true,
          delayMs: onDemandSync && !onDemandSync.ok
            ? 60_000
            : (assigned.replenishmentPending || assigned.fundingQueued ? 5_000 : 60_000),
          refundAttempt: true
        });
    }
    return onDemandSync ? { onDemandSync } : undefined;
  }

  async function prepareRecharge(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status !== OrderStatus.CARD_READY) {
      throw new TaskExecutionError(`Order cannot prepare recharge from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    await requireFreshCustomerSession(task.order_id, context.session);
    if (!context.card?.credentials) {
      throw new TaskExecutionError('Cached card credentials are missing', {
        code: 'CARD_CREDENTIALS_MISSING'
      });
    }
    const executorKind = String(context.order.recharge_executor_kind || '').toUpperCase();
    if (!['API', 'BROWSER'].includes(executorKind)) {
      throw new TaskExecutionError('Recharge route executor is invalid', {
        code: 'ROUTE_NOT_EXECUTABLE'
      });
    }
    let evidence;
    if (executorKind === 'BROWSER') {
      evidence = {
        executorKind: 'BROWSER',
        requestContract: 'CHATGPT_CHECKOUT',
        planType: String(context.order.plan_type || 'plus'),
        cardLast4: String(context.card.credentials.cardNumber).slice(-4),
        submitted: false
      };
    } else {
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
      evidence = {
        executorKind: 'API',
        requestMethod: request.method,
        requestPath: request.path,
        planType: String(request.body.planType),
        cardLast4: String(context.card.credentials.cardNumber).slice(-4),
        submitted: false
      };
    }
    await workflow.recordPrepaymentReady(task.order_id, {
      ...evidence
    });
  }

  async function submitRecharge(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    const executorKind = String(context.order.recharge_executor_kind || '').toUpperCase();
    if (executorKind === 'API' && !rechargeWritesEnabled) {
      throw new TaskExecutionError('API recharge submission is hard-disabled', {
        code: 'RECHARGE_WRITES_DISABLED', retryable: true,
        delayMs: 60_000, refundAttempt: true
      });
    }
    if (executorKind === 'BROWSER' && !browserDispatchEnabled) {
      throw new TaskExecutionError('Browser recharge dispatch is disabled', {
        code: 'BROWSER_DISPATCH_DISABLED', retryable: true,
        delayMs: 60_000, refundAttempt: true
      });
    }
    if (!['API', 'BROWSER'].includes(executorKind)) {
      throw new TaskExecutionError('Recharge route executor is invalid', {
        code: 'ROUTE_NOT_EXECUTABLE', retryable: false
      });
    }
    if (context.order.status !== OrderStatus.CARD_READY) {
      throw new TaskExecutionError(`Order cannot submit recharge from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    await requireFreshCustomerSession(task.order_id, context.session);

    if (!context.card?.provider_card_id) {
      throw new TaskExecutionError('Order has no assigned card', {
        code: 'CARD_NOT_READY', retryable: true, delayMs: 60_000, refundAttempt: true
      });
    }
    // 付款前要不要再问卡台要一次卡详情，看的是这张卡所属账户有没有 API 同步能力（能力位），
    // 不看卡台名字：没有只读 API 的卡台（备用卡台 A）只能用库内凭证与快照余额。
    const cardSourceHasApiSync = Boolean(context.card.supports_api_sync);
    let credentials = context.card.credentials;
    if (cardSourceHasApiSync) {
      const cardEnvelope = await recordCall({
        orderId: task.order_id,
        provider: 'hnskj',
        operation: 'card_details',
        attemptNo: task.attempts,
        action: () => cardProvider.card(context.card.provider_card_id),
        summarize: () => ({ cardId: context.card.provider_card_id, purpose: 'pre_recharge_check' })
      });
      const cardSnapshot = mapCardProvisioning(
        cardEnvelope,
        context.order.minimum_required_card_balance
      );
      credentials = cardSnapshot.state === 'ready'
        ? mapCardCredentials(cardEnvelope) : null;
      await workflow.refreshAssignedCardForRecharge(task.order_id, cardSnapshot, credentials);
      if (cardSnapshot.state !== 'ready') {
        throw new TaskExecutionError('Assigned card is not ready after the pre-recharge check', {
          code: 'CARD_NOT_READY', retryable: true, delayMs: 60_000, refundAttempt: true
        });
      }
    }

    let attempt;
    try {
      attempt = await rechargeAttemptRepository.beginAuthorizedAttempt({
        orderId: task.order_id,
        taskId: task.id
      });
    } catch (error) {
      if (error?.code === 'CARD_TRANSACTION_CHECK_STALE') {
        if (typeof workflow.queueAssignedCardTransactionSync === 'function') {
          await workflow.queueAssignedCardTransactionSync(task.order_id);
        }
        throw new TaskExecutionError('Card transaction evidence is stale; read-only sync queued', {
          code: 'CARD_TRANSACTION_CHECK_STALE', retryable: true, delayMs: 5_000,
          refundAttempt: true, cause: error
        });
      }
      if (['PROVIDER_WRITE_DISABLED', 'ROUTE_NOT_EXECUTABLE', 'PREPAYMENT_NOT_READY',
        'CARD_CHECK_STALE', 'CARD_TRANSACTION_CHECK_STALE', 'CARD_NOT_READY', 'DISPATCH_DISABLED',
        'BROWSER_DISPATCH_DISABLED', 'EXECUTOR_PROFILE_DISABLED',
        'DISPATCH_MODE_INVALID', 'MANUAL_AUTHORIZATION_REQUIRED']
        .includes(error?.code)) {
        throw new TaskExecutionError('Recharge is waiting for an executable provider configuration', {
          code: 'RECHARGE_CONFIGURATION_BLOCKED', retryable: true,
          delayMs: 60_000, refundAttempt: true, cause: error
        });
      }
      throw error;
    }

    // Test-only boundary: preserve the durable SUBMITTING attempt and stop
    // immediately before the external recharge call. This is intentionally
    // injected after all pre-payment checks and never enabled by production
    // defaults.
    if (executorKind === 'API' && holdBeforeProvider) {
      throw new TaskExecutionError('Test hold before external recharge provider call', {
        code: 'PREPAYMENT_TEST_HOLD', retryable: false, refundAttempt: false
      });
    }

    if (attempt.executorKind === 'BROWSER') {
      if (!browserDispatchRepository) {
        throw new TaskExecutionError('Browser dispatch repository is not configured', {
          code: 'BROWSER_DISPATCH_UNAVAILABLE', retryable: true, delayMs: 60_000
        });
      }
      try {
        await browserDispatchRepository.enqueue({
          jobKey: `browser-attempt:${attempt.id}`,
          attemptId: attempt.id,
          orderId: task.order_id,
          executorProfileId: attempt.executorProfileId || null
        });
      } catch (error) {
        // The funds fence is already durable. Keep the task retryable without
        // refunding/clearing that fence; the next attempt reuses the prepared
        // Browser attempt and idempotently completes the dispatch handoff.
        throw new TaskExecutionError('Browser dispatch enqueue failed; retrying durable handoff', {
          code: 'BROWSER_DISPATCH_ENQUEUE_RETRY', retryable: true,
          delayMs: 5_000, refundAttempt: false, cause: error
        });
      }
      return;
    }

    const permit = {
      allowed: true,
      providerCall: { id: attempt.providerCallId, startedAt: attempt.startedAt }
    };

    let submission;
    try {
      submission = await recordCall({
        orderId: task.order_id,
        provider: 'zzshu',
        operation: 'create_direct',
        attemptNo: task.attempts,
        sideEffecting: true,
        existingCall: permit.providerCall,
        providerAccountId: attempt?.providerAccountId || null,
        rechargeAttemptId: attempt?.id || null,
        action: () => rechargeProvider.createDirectOrder({
          ...credentials,
          token: context.session,
          planType: context.order.plan_type || 'plus'
        }),
        summarize: (value) => value
      });
    } catch (error) {
      const sessionReplacementRequired = !error.uncertain
        && String(error.businessCode || '') === '40030';
      await (error.uncertain
        ? rechargeAttemptRepository.markAttemptUnknown({
            attemptId: attempt.id,
            resultSummary: { code: error.code || error.kind || 'RECHARGE_SUBMIT_UNKNOWN' }
          })
        : sessionReplacementRequired
          ? rechargeAttemptRepository.markAttemptCleared({
            attemptId: attempt.id,
            resultSummary: { code: error.businessCode || error.code || error.kind || 'RECHARGE_SUBMIT_REJECTED' },
            resetSubmitTask: false
          })
          : rechargeAttemptRepository.markAttemptRejected({
            attemptId: attempt.id,
            resultSummary: {
              code: error.businessCode || error.code || error.kind || 'RECHARGE_SUBMIT_REJECTED',
              failureReason: error.message || 'Recharge provider rejected submission'
            }
          }));
      if (sessionReplacementRequired) {
        await workflow.markSessionReplacementRequired(task.order_id, {
          failureCode: 'TARGET_ACCOUNT_ALREADY_PLUS',
          failureReason: 'Provider rejected target account because it already has Plus',
          customerActionCode: 'ACCOUNT_ALREADY_PLUS'
        });
      }
      throw new TaskExecutionError(error.message || 'Recharge submission failed', {
        code: error.uncertain ? 'RECHARGE_SUBMIT_UNKNOWN'
          : (sessionReplacementRequired ? 'TARGET_ACCOUNT_ALREADY_PLUS' : 'RECHARGE_SUBMIT_REJECTED'),
        retryable: false,
        cause: error
      });
    }
    try {
      await rechargeAttemptRepository.markAttemptSubmitted({
          attemptId: attempt.id,
          externalOrderId: submission.orderNo,
          externalReference: submission.cardKey,
          resultSummary: { orderNo: String(submission.orderNo) }
        });
    } catch (error) {
      try {
        await rechargeAttemptRepository.markAttemptUnknown({
            attemptId: attempt.id,
            resultSummary: { code: 'RECHARGE_COMMIT_UNKNOWN' }
          });
      } catch {
        // The ACTIVE funds fence remains authoritative when recovery persistence is unavailable.
      }
      throw new TaskExecutionError('Recharge was accepted but could not be committed locally', {
        code: 'RECHARGE_COMMIT_UNKNOWN', retryable: false, cause: error
      });
    }
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

  /**
   * 第④步（面三③ 表二）：API 单付款不明的两路证据自动收口。
   *   一路「账号状态」= ZZSHU 按 cardKey 查订单状态（success / failed / pending）；
   *   一路「卡台扣款」= 当场同步这张 hnskj 卡的流水，看提交后有没有 OpenAI 成功扣款。
   * 有 cardKey：ZZSHU 说 success → 交付；说 failed（二次确认）→ 失败退码；pending → 再等。
   * 无 cardKey（createDirectOrder 超时没拿到）：只剩卡台这一路——有扣款 → 交人（账号一路
   * 不可查，不能自动判成功）；没扣款 → 等到窗口用尽仍没有 → 交人（带「30 分钟内卡台无
   * 扣款」）。任何情况都不重付、不换卡、不释放资金栅栏（CLAUDE.md 硬约束）。
   */
  async function reconcileUnknownSubmission(task, context) {
    const unknown = await workflow.findUnknownSubmission(task.order_id);
    if (!unknown) {
      throw new TaskExecutionError('Order is SUBMIT_UNKNOWN without an unknown funds attempt', {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    const exhausted = task.attempts >= task.max_attempts;
    const evidence = { account: null, card: null, attempts: task.attempts, maxAttempts: task.max_attempts };
    if (unknown.cardKey) {
      let status;
      try {
        status = await queryRecharge(task, task.attempts, {
          includeSession: true, operation: 'reconcile_unknown_status',
          requestKey: `unknown-submission:${task.order_id}:${unknown.attemptId}`
        });
      } catch (error) {
        evidence.account = { available: false, summary: `账号状态：ZZSHU 查询失败（${error?.code || error?.kind || 'QUERY_FAILED'}）` };
        if (!exhausted) throw pendingError(unknownReconcileDelayMs);
        await workflow.escalateUnknownSubmission(task.order_id, { reasonCode: 'ACCOUNT_QUERY_FAILED', evidence });
        return;
      }
      if (Array.isArray(status)) [status] = status;
      if (status.status === 'success') {
        await workflow.commitRechargeSuccess(task.order_id, withoutLatestSession(status), status.latestSession);
        return;
      }
      if (status.status === 'failed') {
        await wait(failureConfirmDelayMs);
        let confirmed = await queryRecharge(task, task.attempts + 1, {
          operation: 'reconcile_unknown_status',
          requestKey: `unknown-submission:${task.order_id}:${unknown.attemptId}:confirm`
        });
        if (Array.isArray(confirmed)) [confirmed] = confirmed;
        if (confirmed.status === 'failed') {
          await workflow.commitRechargeFailure(task.order_id, withoutLatestSession(confirmed));
          return;
        }
        if (confirmed.status === 'success') {
          await workflow.commitRechargeSuccess(task.order_id, withoutLatestSession(confirmed), confirmed.latestSession);
          return;
        }
        status = confirmed;
      }
      evidence.account = { available: true, status: String(status.status || 'unknown'),
        summary: `账号状态：ZZSHU 返回 ${status.status || 'unknown'}` };
      if (['pending', 'processing'].includes(status.status) && !exhausted) throw pendingError(unknownReconcileDelayMs);
      await workflow.escalateUnknownSubmission(task.order_id, {
        reasonCode: ['pending', 'processing'].includes(status.status) ? 'PROVIDER_STILL_PENDING' : 'UNSUPPORTED_PROVIDER_STATUS',
        evidence
      });
      return;
    }
    evidence.account = { available: false, summary: '账号状态：ZZSHU 没有返回 cardKey，无法查询' };
    if (context.card?.id && context.card.supports_api_sync && typeof syncCardOnDemand === 'function') {
      try {
        await syncCardOnDemand({
          id: context.card.id, providerCardId: context.card.provider_card_id,
          providerAccountId: context.card.provider_account_id, cardTypeId: context.card.card_type_id,
          fundedAmount: null, minimumRequiredBalance: context.order.minimum_required_card_balance
        }, { orderId: task.order_id, attemptNo: task.attempts });
        const purchases = await workflow.listCardPurchasesSince(context.card.id, unknown.submittedAt);
        evidence.card = assessCardSideCharge({ purchases, submittedAt: unknown.submittedAt });
      } catch (error) {
        evidence.card = { available: false, summary: `卡台扣款：同步失败（${error?.code || error?.kind || 'CARD_SYNC_FAILED'}）` };
      }
    } else {
      evidence.card = { available: false, summary: '卡台扣款：这张卡所属卡台没有只读流水接口' };
    }
    if (evidence.card.charged) {
      await workflow.escalateUnknownSubmission(task.order_id, { reasonCode: 'CARD_CHARGED_ACCOUNT_UNVERIFIABLE', evidence });
      return;
    }
    if (!exhausted) throw pendingError(unknownReconcileDelayMs);
    await workflow.escalateUnknownSubmission(task.order_id, {
      reasonCode: evidence.card.available ? 'NO_CARD_CHARGE_IN_WINDOW_ACCOUNT_UNVERIFIABLE' : 'NO_EVIDENCE_AVAILABLE',
      evidence
    });
  }

  async function pollRecharge(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status === OrderStatus.SUBMIT_UNKNOWN) return reconcileUnknownSubmission(task, context);
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
      await workflow.commitRechargeFailure(task.order_id, withoutLatestSession(status));
      return;
    }
    throw new TaskExecutionError(`Unsupported recharge status: ${status.status}`, {
      code: 'UNKNOWN_RECHARGE_STATUS'
    });
  }

  async function recheckCancellation(task) {
    const context = await workflow.loadOrderContext(task.order_id);
    if (context.order.status !== OrderStatus.CANCELLATION_PENDING) {
      throw new TaskExecutionError(`Order cannot recheck cancellation from ${context.order.status}`, {
        code: 'ORDER_STATE_MISMATCH'
      });
    }
    let status;
    try {
      status = await queryRecharge(task, task.attempts, {
        includeSession: true,
        operation: 'recheck_cancellation',
        requestKey: `cancellation-status:${task.order_id}`
      });
    } catch (error) {
      if (task.attempts < task.max_attempts) throw error;
      await workflow.commitCancellationStatus(
        task.order_id,
        { status: 'unknown', isSubscriptionCancelled: 0 },
        null,
        { exhausted: true }
      );
      return;
    }
    if (Array.isArray(status)) [status] = status;
    if (status.status !== 'success') {
      await workflow.commitCancellationStatus(
        task.order_id,
        withoutLatestSession(status),
        status.latestSession,
        { exhausted: true }
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
    PREPARE_RECHARGE: prepareRecharge,
    SUBMIT_RECHARGE: submitRecharge,
    POLL_RECHARGE: pollRecharge,
    RECHECK_CANCELLATION: recheckCancellation,
    SYNC_CARD_TRANSACTIONS: syncCardTransactions
  };
}
