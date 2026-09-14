import { createHmac } from 'node:crypto';

import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { createBrowserRecoveryRepository } from '../../v1/src/db/repositories/browser-recovery-repository.js';
import { createBrowserWorkerService } from '../../v1/src/services/browser-worker-service.js';
import { BrowserExecutionService } from './executor.js';
import { createMysqlUpstreamProjectionAdapter } from './mysql-upstream-adapter.js';
import { BrowserPaymentExecutor } from './payment-executor.js';
import { createHumanVerificationGate } from './human-verification-gate.js';
import { upsertBrowserAlertInTransaction } from '../../v1/src/db/repositories/browser-alert-repository.js';
import { createPostSubmitWatch } from './post-submit-outcome-watch.js';
import { createLocalOperatorNotifier } from './local-operator-notify.js';
import { LiveChatGPTPaymentAdapter, LIVE_PAYMENT_CONFIRMATION } from './live-chatgpt-payment-adapter.js';
import { ChatGptPostPaymentVerifier } from './chatgpt-post-payment-verifier.js';
import { recoverSessionAfterPayment } from './post-payment-session-recovery.js';
import { createBrowserPaymentExecutionRuntime, SharedBrowserRuntimeIntegration } from './shared-runtime-integration.js';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function key32(value, name) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError(`${name} must be a 32-byte Buffer`);
  return Buffer.from(value);
}

function hmac(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}:${required(value, namespace)}`).digest('hex');
}

/**
 * Rehearsal of the exact LIVE single pass (card → address → email → zero-tax
 * requote → final recheck) that stops before the submit click. It never asks
 * for a permit or a submission intent, so the adapter cannot cross the
 * external boundary: authorizeSubmit always answers "do not execute".
 */
/**
 * D-210：付款前失败但现场被留在屏幕上时，给运营一段接手时间，**推迟**判失败。
 *
 * 为什么不能当场判失败：客户页一进终态就停止轮询，并显示「没有完成，没有扣费，
 * 你的卡密可以直接重新兑换」。运营正要接手的那几分钟里，这句话会让客户拿同一张
 * 卡密重新兑换——新订单、新卡、再付一次，我们出两份钱（2026-09-14 Lemon 指出）。
 *
 * 检测信号只认一个：账号真的变成了付费计划（复用付款后核实器，不自己发明判据）。
 * 检测到也**不自动判成功**——worker 不知道运营用的是系统分配的卡还是另一张，
 * 自动记账会记错。它只是停止等待并通知人，由人走正式收口。
 */
export async function awaitOperatorTakeover({
  verifier, control, notify = null, windowMs = 90_000, pollIntervalMs = 10_000,
  // D-213：队列里有人在等就立刻让出 lane。这条 lane 是串行的
  // （runLaneLoop 依次跑 steps，一个占住其余全停），硬等下去后面的客户全在排队。
  // 而且那时候本来也留不住现场——下一单 startFresh 会关掉这个 checkout 页，
  // 所以"有人排队还硬等"是纯亏：既堵了别人，又保不住自己要保的东西。
  queueDepth = null,
  clock = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!verifier || typeof verifier.confirmPlus !== 'function') throw new TypeError('verifier is required');
  if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new TypeError('windowMs must be at least 1000ms');
  if (queueDepth != null && typeof queueDepth !== 'function') throw new TypeError('queueDepth must be a function');
  const deadline = clock() + windowMs;
  if (notify) await notify({ windowMs }).catch(() => undefined);
  let checks = 0;
  while (clock() < deadline) {
    // 先让路再检测：让出去的代价是这一单少等几十秒，不让的代价是别人全等着。
    if (queueDepth) {
      const waiting = await queueDepth().catch(() => 0);
      if (Number(waiting) > 0) return { takenOver: false, checks, reason: 'QUEUE_WAITING', waiting: Number(waiting) };
    }
    // 租约没了就别再占着这一单：另一个 worker 可能已经接管。
    if (control && typeof control.assertLeaseBeforeAction === 'function') {
      try { await control.assertLeaseBeforeAction('OPERATOR_TAKEOVER_WATCH'); }
      catch { return { takenOver: false, checks, reason: 'LEASE_LOST' }; }
    }
    checks += 1;
    const seen = await verifier.confirmPlus().catch(() => ({ confirmed: false }));
    if (seen?.confirmed === true) return { takenOver: true, checks, reason: 'PLUS_OBSERVED' };
    const remaining = deadline - clock();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  return { takenOver: false, checks, reason: 'WINDOW_EXPIRED' };
}

export async function runPreSubmitRehearsal({
  adapter, control, page, checkout, checkoutContract, cardMaterial, billingEmail, operationId,
} = {}) {
  if (!adapter || typeof adapter.submit !== 'function') throw new TypeError('adapter is required');
  if (!control || typeof control.assertLeaseBeforeAction !== 'function') throw new TypeError('control is required');
  const op = required(operationId, 'operationId');
  try {
    const result = await adapter.submit({
      page, operationId: op, checkout, checkoutContract, cardMaterial, billingEmail,
      assertContinue: () => control.assertLeaseBeforeAction('PAYMENT_PAGE_ACTION'),
      beforeSubmit: () => control.assertLeaseBeforeAction('FINAL_PRE_SUBMIT_RECHECK'),
      authorizeSubmit: async () => ({ executeExternal: false, rehearsal: true }),
    });
    if (result?.status !== 'RECONCILE_ONLY') {
      throw Object.assign(new Error('rehearsal adapter returned an unexpected status'), { code: 'REHEARSAL_RESULT_INVALID' });
    }
    return {
      status: 'PRE_SUBMIT_STOPPED', reasonCode: 'STOP_BEFORE_SUBMIT', paymentSubmitCalls: 0,
      quote: result.quote || null, preserveProfile: true,
    };
  } catch (error) {
    // Without authorization the adapter never clicks; an UNKNOWN here would be
    // a contract violation and must surface, never be softened.
    if (error?.code === 'PAYMENT_RESULT_UNKNOWN') throw error;
    return { status: 'PRE_SUBMIT_FAILED', reasonCode: error?.code || 'PRE_SUBMIT_FAILED', paymentSubmitCalls: 0 };
  }
}

/** Production-shaped LIVE composition. Construction alone performs no payment action. */
export function createSharedLivePaymentWorker({
  pool,
  workerId,
  executorProfileId,
  approvedOrderId,
  runtimeAdapter,
  manifest,
  observation,
  sessionProvider,
  cardMaterialLeaseProvider,
  resolveAccountKey,
  resolveSessionIdentity,
  resolveSessionRef,
  resolveCardMaterialRef,
  transactionReaderFactory,
  runtimeHmacKey,
  artifactKey,
  resourceHmacKey,
  evidenceSink,
  leaseSeconds = 60,
  executionTimeoutMs = 60_000,
  verificationWindowMs = 300_000,
  verificationIntervalMs = 5_000,
  // D-154: how long to hold the clicked checkout page while a person satisfies a
  // human-verification challenge. 0 = do not wait (only detect and report).
  humanVerificationWaitMs = 0,
  notifyOperator = createLocalOperatorNotifier(),
  // F-47: how long to read the Checkout for a definite answer before falling
  // back to polling the account. A decline shows up in seconds.
  postSubmitWatchMs = 60_000,
  // D-210：付款前失败且现场保留时，给运营多久接手。
  // 2026-09-14 从 8 分钟收到 90 秒（D-212）：对抗式审查发现只有 1 条 lane、
  // runLaneLoop 串行，等待期间后面的客户全在排队——8 分钟是我亲手加的吞吐瓶颈。
  // 90 秒够检测到运营接手（上次点订阅到账号变 Plus 只要几十秒），队列代价可接受。
  // 等"等待期释放 lane"做完，再考虑放长。
  operatorTakeoverWindowMs = 90_000,
  postPlusAction = 'CANCEL_RENEWAL',
  resolvePlan = null,
  stopBeforeSubmit = false,
  releaseSessionOnComplete = false,
  // Resident lanes close failed pre-payment runs themselves (classified safe
  // abort, bounded retries); the single-order tool leaves them for a human.
  safeAbortOnFailure = false,
} = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('mysql2-like pool is required');
  if (typeof postPlusAction !== 'function' && !['CANCEL_RENEWAL', 'MANUAL_20X_HANDOFF', 'UPGRADE_DIALOG_STOP'].includes(postPlusAction)) {
    throw new TypeError('postPlusAction must be CANCEL_RENEWAL, MANUAL_20X_HANDOFF, UPGRADE_DIALOG_STOP or a function of the plan');
  }
  if (stopBeforeSubmit === true && typeof postPlusAction === 'string' && postPlusAction !== 'CANCEL_RENEWAL') {
    throw new TypeError('a rehearsal cannot carry a manual 20X handoff');
  }
  const resolvePostPlusAction = (plan) => (typeof postPlusAction === 'function' ? postPlusAction(plan) : postPlusAction);
  if (!runtimeAdapter?.open || !runtimeAdapter?.close) throw new TypeError('runtimeAdapter is required');
  if (!manifest || manifest.allowWrites !== false) throw new TypeError('reviewed Browser manifest is required');
  if (!observation?.pageContract || !observation?.checkoutContract) throw new TypeError('LIVE observation contracts are required');
  if (observation.checkoutContract.requiredCurrency !== 'PHP'
    || observation.checkoutContract.requireZeroTax !== true
    || observation.checkoutContract.requireQuoteConsistency !== true) {
    throw new TypeError('LIVE Checkout contract must require PHP, zero tax and quote consistency');
  }
  if (!sessionProvider?.open || !sessionProvider?.bootstrap || !sessionProvider?.close) throw new TypeError('sessionProvider is required');
  if (!cardMaterialLeaseProvider?.open || !cardMaterialLeaseProvider?.withMaterial || !cardMaterialLeaseProvider?.close) throw new TypeError('cardMaterialLeaseProvider is required');
  for (const [name, value] of Object.entries({ resolveAccountKey, resolveSessionIdentity, resolveSessionRef, resolveCardMaterialRef, transactionReaderFactory })) {
    if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  }
  const worker = required(workerId, 'workerId');
  const profile = required(executorProfileId, 'executorProfileId');
  // null = resident lane serving any queued Browser job of this executor profile.
  const approvedOrder = approvedOrderId == null ? null : required(approvedOrderId, 'approvedOrderId');
  const runtimeKey = key32(runtimeHmacKey, 'runtimeHmacKey');
  const recoveryArtifactKey = key32(artifactKey, 'artifactKey');
  const recoveryResourceKey = key32(resourceHmacKey, 'resourceHmacKey');
  const dispatchRepository = createBrowserDispatchRepository(pool);
  const executionRepository = createBrowserExecutionRepository(pool);
  const recoveryRepository = createBrowserRecoveryRepository(pool, {
    artifactKeys: new Map([[1, recoveryArtifactKey]]), currentArtifactKeyVersion: 1,
    resourceHmacKey: recoveryResourceKey,
  });
  const upstreamAdapter = createMysqlUpstreamProjectionAdapter({ db: pool });
  const executionService = new BrowserExecutionService({
    runtimeAdapter, evidenceSink, sessionProvider, timeoutMs: executionTimeoutMs,
  });
  const resolveExecutionContext = async ({ claimedJob, run }) => {
    if (approvedOrder && claimedJob.orderId !== approvedOrder) throw new Error('claimed order is not approved for LIVE payment');
    const sessionIdentity = await resolveSessionIdentity({
      orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId,
    });
    // Two-stage Pro (pro_5x/pro_20x): stage 1 always buys Plus in Checkout; the Pro
    // upgrade runs after payment (UPGRADE_DIALOG_STOP). A free account cannot buy Pro
    // directly, and the Pro tier toggle is absent on the Plus purchase dialog, so the
    // checkout navigation plan is fixed to plus; only the post-payment upgrade uses the order plan.
    const loaded = await upstreamAdapter.load({
      runId: run.runId, manifest, observation: { ...observation, sessionIdentity, plan: 'plus' },
      sessionRef: await resolveSessionRef({ orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId }),
    });
    return {
      job: loaded.job,
      executionOptions: {
        cardMaterialLeaseProvider,
        cardMaterialRef: await resolveCardMaterialRef({ orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId }),
        validateCardMaterialOnly: true,
      },
    };
  };
  let integration;
  const runtime = createBrowserPaymentExecutionRuntime({
    executionService,
    resolveExecutionContext,
    preserveRuntimeOnManualHandoff: typeof postPlusAction === 'function' || postPlusAction !== 'CANCEL_RENEWAL',
    releaseSessionOnComplete: releaseSessionOnComplete === true,
    createPaymentHandler: async ({ claimedJob, run, control }) => async ({
      page, checkout, checkoutContract, cardMaterial, billingEmail, onStage = null,
    }) => {
      if (stopBeforeSubmit === true) {
        return runPreSubmitRehearsal({
          adapter: new LiveChatGPTPaymentAdapter({
            enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION,
            outcomeObserver: async () => { throw new Error('rehearsal never observes a payment outcome'); },
          }),
          control, page, checkout, checkoutContract, cardMaterial, billingEmail,
          operationId: `browser-live-rehearsal:${run.runId}`,
        });
      }
      const plan = typeof resolvePlan === 'function'
        ? await resolvePlan({ orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId }) : 'plus';
      const action = resolvePostPlusAction(plan);
      const sessionRefInput = { orderId: claimedJob.orderId, attemptId: claimedJob.attemptId, runId: run.runId };
      const verifier = new ChatGptPostPaymentVerifier({
        page,
        expectedIdentity: await resolveSessionIdentity(sessionRefInput),
        transactionReader: await transactionReaderFactory({ runId: run.runId }),
        timeoutMs: verificationWindowMs,
        pollIntervalMs: verificationIntervalMs,
        upgradePlan: action === 'UPGRADE_DIALOG_STOP' ? plan : null,
        navigationTimeoutMs: executionTimeoutMs,
        // D-134 (2026-09-08 root cause): payment rotates the ChatGPT session. The
        // backend sets a FRESH session-token (Plus, with a live accessToken) in the
        // browser after checkout succeeds. The order only holds the PRE-payment
        // token (Free, expired accessToken, no auth.openai.com layer to refresh).
        // Reinjecting that old token overwrote the fresh one and forced a false
        // "session expired". Recovery must NOT reinject: it only reloads so the
        // front-end re-establishes login from the post-payment token the browser
        // already holds.
        sessionRecovery: (targetPage) => recoverSessionAfterPayment(targetPage, {
          navigationTimeoutMs: executionTimeoutMs,
        }),
      });
      const watchPostSubmit = createPostSubmitWatch({
        windowMs: postSubmitWatchMs,
        pollIntervalMs: Math.min(verificationIntervalMs, 5_000),
      });
      const adapter = new LiveChatGPTPaymentAdapter({
        enabled: true,
        confirmation: LIVE_PAYMENT_CONFIRMATION,
        // D-154: detect a human-verification challenge raised by the submit click,
        // tell the operator, and wait for a person to satisfy it in the window.
        // Never satisfied here; `humanVerificationWaitMs = 0` keeps the old
        // behaviour except that the reason is now recorded.
        challengeGate: createHumanVerificationGate({
          waitMs: humanVerificationWaitMs,
          pollIntervalMs: verificationIntervalMs,
          notify: async ({ waitMs }) => {
            const message = waitMs > 0
              ? `结账页出现人机验证。请在比特浏览器窗口勾选，${Math.round(waitMs / 1000)} 秒内勾选自动继续；超时表单保留，可自行完成`
              : '结账页出现人机验证。自动化不处理该验证，本单已停并保留现场';
            await notifyOperator({ title: '充值需要人工验证', message });
            // notifyOperator 只弹 macOS 桌面通知（local-operator-notify.js 有意「不出本机」），
            // 人不在电脑前就什么也收不到——2026-09-13 Lemon 真单卡在验证上、全程没收到通知。
            // 这里补一条 operator_alerts：它不在 PHONE_SILENT_TYPES 里，会走既有 Bark 通道推手机。
            // 时机是「检测到的那一刻」，不是 5 分钟后判定付款不明时——那时单早就卡死了。
            // 写告警失败绝不能影响这一单：告警是安全信号，丢一条通知不该让付款流程出错。
            try {
              await upsertBrowserAlertInTransaction(pool, {
                type: 'BROWSER_HUMAN_VERIFICATION',
                orderId: claimedJob.orderId,
                title: '卡在人机验证，只有你能点',
                message: `${message}。系统不会重付，也不会绕过该验证。`,
              });
            } catch { /* 通知尽力而为 */ }
          },
        }),
        // F-47: before spending the whole verification window polling the account,
        // read what the Checkout itself is saying. A declined card is visible on
        // the page within seconds; the old path waited five minutes and then
        // reported "unknown" with no reason at all. This only reads — the funds
        // verdict still goes through the normal unknown/operator-verify path.
        outcomeObserver: async ({ page: submittedPage }) => {
          const observed = await watchPostSubmit(submittedPage).catch(() => ({ state: 'UNREADABLE' }));
          if (observed.state === 'DECLINED' || observed.state === 'PAGE_ERROR') {
            return { status: 'DECLINED', reasonCode: observed.reasonCode, observedText: observed.observedText };
          }
          return { status: (await verifier.confirmPlus()).confirmed ? 'CONFIRMED' : 'UNKNOWN' };
        },
      });
      const paymentResult = await new BrowserPaymentExecutor({
        integration, executionRepository, paymentAdapter: adapter,
        postPaymentVerifier: verifier, enabled: true,
        postPlusAction: action,
        verificationWindowMs, verificationIntervalMs,
      }).execute({
        control, run, page, checkout, checkoutContract, cardMaterial, billingEmail,
        operationId: `browser-live-payment:${run.runId}`,
        beforeSubmit: () => control.assertLeaseBeforeAction('FINAL_PRE_SUBMIT_RECHECK'),
        onStage,  // D-208
      });
      // D-210：付款前失败、但表单被留在屏幕上 → 先别判失败。判了客户就会看到
      // 「没有完成，卡密可以直接重新兑换」并停止轮询，而运营这时正要接手；
      // 客户照那句话做就是两张卡付两次钱。等一个窗口，只认"账号真的变成付费计划"。
      if (paymentResult?.status === 'PRE_SUBMIT_FAILED' && paymentResult.sceneHeld === true
        && operatorTakeoverWindowMs > 0) {
        const watched = await awaitOperatorTakeover({
          verifier, control, windowMs: operatorTakeoverWindowMs,
          // D-213：每轮问一次"还有几单在等这条 lane"。排除自己——等待中的这一单
          // 也是 RECHARGE_PROCESSING，不排除就会把自己数进去、立刻让路。
          queueDepth: () => dispatchRepository.countClaimable({
            excludeOrderId: claimedJob.orderId,
            executorProfileId: profile,
          }),
          notify: async ({ windowMs }) => {
            const minutes = Math.round(windowMs / 60_000);
            const message = `自动化停在付款前，填好的卡和账单已留在 Pilot 窗口。`
              + `你可以直接点订阅；${minutes} 分钟内没人接手才判失败退卡密。`;
            await notifyOperator({ title: '有单等你接手', message }).catch(() => undefined);
            try {
              await upsertBrowserAlertInTransaction(pool, {
                type: 'BROWSER_HUMAN_VERIFICATION',
                orderId: claimedJob.orderId,
                title: '有单等你接手（现场已保留）',
                message,
              });
            } catch { /* 通知尽力而为，绝不影响这一单 */ }
          },
        }).catch(() => ({ takenOver: false, reason: 'WATCH_FAILED' }));
        if (watched.takenOver) {
          // 刻意不自己判成功：worker 不知道运营用的是系统分配的卡还是另一张，
          // 自动记账会记错卡。交给正式收口（close-manually-fulfilled-order.mjs）。
          return { status: 'UNKNOWN', reasonCode: 'OPERATOR_TAKEOVER_DETECTED', paymentSubmitCalls: 0 };
        }
      }
      return paymentResult;
    },
  });
  const workerService = createBrowserWorkerService({
    dispatchRepository, executionRepository, runtime,
    resolveExecutionContext: async (job) => ({
      executorProfileId: job.executorProfileId || profile,
      accountKeyHmac: hmac(runtimeKey, 'account', await resolveAccountKey({ orderId: job.orderId, attemptId: job.attemptId })),
      profileManifestSha256: manifest.profileDigest,
      networkLeaseHmac: hmac(runtimeKey, 'network', manifest.networkDigest),
    }),
  });
  integration = new SharedBrowserRuntimeIntegration({
    workerService, executionRepository, recoveryRepository,
    workerId: worker, executorProfileId: profile, leaseSeconds,
  });
  return Object.freeze({
    workerId: worker,
    approvedOrderId: approvedOrder,
    stopBeforeSubmit: stopBeforeSubmit === true,
    runOnce: () => integration.runPaymentOnce({ approvedOrderId: approvedOrder, safeAbortOnFailure: safeAbortOnFailure === true }),
    resident: approvedOrder == null,
  });
}
