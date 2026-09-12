import { createHash } from 'node:crypto';

import { assertJobEnvelope, ContractError } from './contracts.js';
import { probeSessionIdentity } from './session-identity-probe.js';
import { observeCheckout } from './checkout-observer.js';
import { navigateToChatGPTCheckout } from './chatgpt-checkout-navigator.js';
import { fillSecureCardFieldsNonPayment } from './nonpayment-card-fill.js';
import { fillBillingAddress, fillTransientBillingEmail } from './billing-address-fill.js';
import { assertCardMaterial } from './card-material-lease.js';

export class BrowserExecutionError extends Error {
  constructor(reason, message = `Browser execution stopped: ${reason}`, cause) {
    super(message, { cause });
    this.name = 'BrowserExecutionError';
    this.reason = reason;
    this.failClosed = true;
  }
}

function digest(input) {
  return createHash('sha256').update(input).digest('hex');
}

async function observeCheckoutAfterRequote(page, contract, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  let lastError;
  do {
    try {
      return await observeCheckout(page, contract);
    } catch (error) {
      lastError = error;
      const pendingRequote = /tax is not zero|summary is incomplete|quote is incomplete|quote total does not match subtotal/i
        .test(String(error?.message || ''));
      if (!pendingRequote || Date.now() >= deadline) throw error;
      await page.waitForTimeout(250);
    }
  } while (true);
  throw lastError;
}

function assertReadOnlyPageContract(contract, { identityProbeRequired = false } = {}) {
  if (!contract || typeof contract !== 'object') throw new ContractError('pageContract is required');
  if (typeof contract.urlPrefix !== 'string' || contract.urlPrefix.length === 0) throw new ContractError('pageContract.urlPrefix is required');
  if (typeof contract.title !== 'string' || contract.title.length === 0) throw new ContractError('pageContract.title is required');
  if (typeof contract.requiredSelector !== 'string' || contract.requiredSelector.length === 0) throw new ContractError('pageContract.requiredSelector is required');
  if (typeof contract.markerText !== 'string') throw new ContractError('pageContract.markerText must be a string');
  if (!identityProbeRequired && contract.markerText.length === 0) throw new ContractError('pageContract.markerText is required');
}

async function activeOrderPage(context, urlPrefix, timeoutMs) {
  const existing = typeof context.pages === 'function'
    ? context.pages().filter((page) => !page.isClosed?.() && page.url().startsWith(urlPrefix))
    : [];
  if (existing.length > 1) {
    throw new BrowserExecutionError(
      'PROFILE_PAGE_AMBIGUOUS',
      'active Profile has multiple matching ChatGPT pages; preserve them for operator recovery',
    );
  }
  if (existing.length === 1) return existing[0];
  const page = await context.newPage();
  await page.goto(urlPrefix, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  return page;
}

export class BrowserExecutionService {
  constructor({ runtimeAdapter, evidenceSink, sessionProvider = null, clock = () => Date.now(), timeoutMs = 5_000 } = {}) {
    if (!runtimeAdapter || typeof runtimeAdapter.open !== 'function' || typeof runtimeAdapter.close !== 'function') throw new TypeError('runtimeAdapter is required');
    if (!evidenceSink || typeof evidenceSink.append !== 'function') throw new TypeError('evidenceSink is required');
    this.runtimeAdapter = runtimeAdapter;
    this.evidenceSink = evidenceSink;
    this.sessionProvider = sessionProvider;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  async execute(job, {
    assertLease,
    signal = null,
    freezeRequested = () => false,
    cardMaterialLeaseProvider = null,
    cardMaterialLease = null,
    cardMaterialRef = null,
    validateCardMaterialOnly = false,
    fillCardFields = false,
    paymentHandler = null,
    preserveRuntimeOnManualHandoff = false,
    preserveRuntimeOnFailure = false,
    // Resident identity: once the order is COMPLETED the next customer must
    // not inherit this login. Only the session/login cookies go; the device
    // and Cloudflare cookies stay (see session-bootstrap.clearSession).
    releaseSessionOnComplete = false,
    // A fresh run (not a lease-recovered resume) must not inherit whatever the
    // resident identity's page still shows from the previous job, e.g. a
    // Checkout with filled Stripe fields after a rehearsal stop: start from
    // the home page so identity probe and pricing modal begin clean.
    startFresh = false,
  } = {}) {
    assertJobEnvelope(job);
    if (job.state !== 'RUNNING') throw new BrowserExecutionError('INVALID_STATE', 'job must be RUNNING before Browser execution');
    if (typeof assertLease !== 'function') throw new TypeError('assertLease callback is required');
    assertReadOnlyPageContract(job.metadata?.pageContract, {
      identityProbeRequired: Boolean(job.metadata?.accountProbeContract),
    });
    if (job.metadata?.checkoutNavigationContract && !job.metadata?.checkoutContract) {
      throw new ContractError('checkoutContract is required when Checkout navigation is enabled');
    }
    if (job.metadata?.accountProbeContract && !job.metadata?.sessionIdentity) {
      throw new ContractError('sessionIdentity is required when account probing is enabled');
    }
    if (paymentHandler != null && typeof paymentHandler !== 'function') {
      throw new TypeError('paymentHandler must be a function');
    }
    if ((preserveRuntimeOnManualHandoff || preserveRuntimeOnFailure)
      && typeof this.runtimeAdapter.detach !== 'function') {
      throw new ContractError('runtimeAdapter.detach is required to preserve an active-order Profile');
    }
    if (paymentHandler && fillCardFields) {
      throw new ContractError('paymentHandler and non-payment card fill are mutually exclusive');
    }
    const startedAt = this.clock();
    let evidenceSequence = 0;
    await this._event(job, 'intent', ++evidenceSequence, { action: 'observe-page', mode: job.manifest.mode });
    let runtime;
    let sessionLease;
    let sessionBootstrapped = false;
    let ownedCardMaterialLease = false;
    let abortRuntime;
    let preserveRuntime = false;
    try {
      if (signal?.aborted) throw new BrowserExecutionError('LEASE_LOST');
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      runtime = await this.runtimeAdapter.open(job.manifest, { profileRef: job.profileRef });
      abortRuntime = () => {
        // Disconnecting CDP interrupts Playwright waits without destroying the
        // active order's visible Profile. Destructive close remains reserved
        // for a terminal execution path.
        const stop = preserveRuntimeOnFailure
          ? this.runtimeAdapter.detach.bind(this.runtimeAdapter)
          : this.runtimeAdapter.close.bind(this.runtimeAdapter);
        stop(runtime).catch(() => undefined);
      };
      signal?.addEventListener('abort', abortRuntime, { once: true });
      if (signal?.aborted) throw new BrowserExecutionError('LEASE_LOST');
      if (job.metadata?.sessionRef) {
        if (!this.sessionProvider || typeof this.sessionProvider.open !== 'function' || typeof this.sessionProvider.bootstrap !== 'function') {
          throw new BrowserExecutionError('SESSION_PROVIDER_UNAVAILABLE');
        }
        let sessionResult;
        if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
        try {
          sessionLease = await this.sessionProvider.open(job.metadata.sessionRef, { purpose: 'browser-observe' });
          // 一上来就换掉窗口里的登录态，不先试着复用（2026-09-12 Lemon 定，D-187）。
          //
          // 原来首次注入不传 replaceExisting，遇到窗口里已有登录 cookie 就保留旧的、
          // 不注入这一单的 Session，等身份探测发现对不上再替换重试。那是为了照顾
          // 「同一个客户的 Session 轮换过」的情况，但真实业务是不同客户依次提交，
          // 连续两单同号的概率很低，于是几乎每单都要先失败一轮、多打一次 ChatGPT。
          // 第一单真实客户单（PJV1--wEBaAETWx_pKBpTZVp9）就是这样：窗口里留着上一个
          // 账号的登录态，这一单的 Session 从没被注入过。（该单最终失败，但失败与这次
          // 多余请求之间的因果没有证据，未下结论。）
          //
          // 换成首次即替换还有一个更要紧的好处：身份真对不上时直接抛
          // SESSION_IDENTITY_MISMATCH，订单转 WAITING_FOR_SESSION，客户能在页面上
          // 自己换个账号接着跑；而原来的重试路径最后报 CHATGPT_ACCESS_BLOCKED，
          // 那是终态失败，客户只能找客服。
          sessionResult = await this.sessionProvider.bootstrap(sessionLease, runtime.context, { replaceExisting: true });
          sessionBootstrapped = true;
          // 注入完就不再需要租约：不会再有第二次注入，继续持有只是拖长占用。
          await this.sessionProvider.close(sessionLease);
          sessionLease = null;
        } catch (error) {
          const sessionReasons = [
            'BROWSER_PREFLIGHT_CONTEXT_UNAVAILABLE', 'BROWSER_PREFLIGHT_SOURCE_UNAVAILABLE',
            'SESSION_INVALID', 'SESSION_MATERIAL_INVALID', 'INCOMPLETE_SESSION',
            'INVALID_SESSION_EXPIRY', 'SESSION_EXPIRED', 'INVALID_SESSION_TOKEN',
            'INVALID_ACCESS_TOKEN', 'INVALID_ACCESS_TOKEN_CLAIMS', 'ACCESS_TOKEN_EXPIRED',
            'ACCESS_TOKEN_NEAR_EXPIRY',
          ];
          const reason = sessionReasons.includes(error?.code) ? error.code : 'SESSION_INVALID';
          throw new BrowserExecutionError(
            reason,
            reason === 'SESSION_INVALID'
              ? 'stored Browser Session is unavailable or invalid'
              : 'Browser preflight Session source is temporarily unavailable',
            error,
          );
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'session-bootstrap',
          sessionDigest: sessionResult.sessionDigest,
          cookieCount: sessionResult.cookieCount,
          // D-187 的核心行为是「先把窗口里的旧登录态清掉再注入」，可这两个数字一直没落库，
          // 2026-09-12 真单跑完也证明不了窗口真被清过（D-190）。都是计数，不含 cookie 值。
          replacedCookieCount: sessionResult.replacedCookieCount ?? null,
          clearedLoginCookieCount: sessionResult.clearedLoginCookieCount ?? null,
        });
      }
      // Reuse the active order's sole ChatGPT page. Creating another tab on
      // every retry was both wasteful and a needless account-risk signal.
      const page = await activeOrderPage(
        runtime.context, job.metadata.pageContract.urlPrefix, this.timeoutMs,
      );
      // A reused tab was loaded before this order's session cookies were injected,
      // so its DOM still shows the previous (logged-out) state even when its URL
      // already matches. Reload it after bootstrap so the injected session takes
      // effect before the page is read; a freshly created tab was already navigated
      // with the cookies in place.
      if (sessionBootstrapped || (startFresh && page.url() !== job.metadata.pageContract.urlPrefix)) {
        await page.goto(job.metadata.pageContract.urlPrefix, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
        // 名字从 page-reset 改来：它只是注入后重新导航让 cookie 生效，不清任何东西。
        // 旧名字让人以为窗口被清理过——2026-09-12 查根因时我自己先被它误导了一次。
        await this._event(job, 'checkpoint', ++evidenceSequence, { action: 'page-reload-after-inject', urlPrefix: job.metadata.pageContract.urlPrefix });
      }
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      let sessionIdentity = null;
      let transientBillingEmail = null;
      if (job.metadata.sessionIdentity) {
        const probe = () => probeSessionIdentity(
          page,
          job.metadata.sessionIdentity,
          {
            ...(job.metadata.accountProbeContract || {}),
            stabilizationTimeoutMs: Math.min(this.timeoutMs, 15_000),
            onVerifiedEmail: (email) => { transientBillingEmail = email; },
          },
        );
        const classify = (error) => ([
          'SESSION_INVALID',
          'SESSION_IDENTITY_MISMATCH',
          'ACCOUNT_STATUS_UNKNOWN',
          'CHATGPT_ACCESS_BLOCKED',
        ].includes(error?.code) ? error.code : 'SESSION_IDENTITY_MISMATCH');
        try {
          sessionIdentity = await probe();
        } catch (error) {
          // 窗口里的登录态在上面已经被这一单的 Session 整个替掉了，探测还对不上身份，
          // 就是客户提交的 Session 本身不对（或已失效）。不重试，直接 fail closed：
          // SESSION_INVALID / SESSION_IDENTITY_MISMATCH 都映射成 WAITING_FOR_SESSION，
          // 客户在充值页上自己换个账号就能接着跑（2026-09-12，D-187）。
          throw new BrowserExecutionError(classify(error), error.message, error);
        } finally {
          if (sessionLease && this.sessionProvider) {
            await this.sessionProvider.close(sessionLease).catch(() => undefined);
            sessionLease = null;
          }
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'account-readonly-probe',
          loggedIn: sessionIdentity.loggedIn,
          identityMatched: sessionIdentity.identityMatched,
          subscriptionStatus: sessionIdentity.subscriptionStatus || null,
          alreadyPlus: sessionIdentity.alreadyPlus ?? null,
          submitCalls: 0,
        });
        if (sessionIdentity.alreadyPlus) {
          throw new BrowserExecutionError(
            'ACCOUNT_ALREADY_PLUS',
            'target account is not a free account before payment',
          );
        }
      }
      const checkpoint = await this._checkPage(page, job.metadata.pageContract);
      await this._event(job, 'checkpoint', ++evidenceSequence, {
        action: 'page-signature',
        urlPrefix: job.metadata.pageContract.urlPrefix,
        observedUrlDigest: digest(page.url()),
        observedTitleDigest: digest(checkpoint.title),
        frameCount: checkpoint.frameCount,
      });
      if (cardMaterialRef != null) {
        if (cardMaterialLease || !cardMaterialLeaseProvider || typeof cardMaterialLeaseProvider.open !== 'function') {
          throw new BrowserExecutionError('CARD_MATERIAL_PRECHECK_CONTRACT');
        }
        if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
        try {
          cardMaterialLease = await cardMaterialLeaseProvider.open(cardMaterialRef, {
            purpose: 'browser-nonpayment-preflight',
            // One lease covers identity, Checkout creation, address/email
            // entry, requote and the single submit. The old 60-second default
            // could expire during a normal real page flow and force a restart.
            ttlMs: 5 * 60_000,
          });
          ownedCardMaterialLease = true;
        } catch (error) {
          throw new BrowserExecutionError('CARD_NOT_READY', 'stored card material is unavailable or invalid', error);
        }
      }
      let cardMaterialReady = false;
      if (validateCardMaterialOnly) {
        if (!cardMaterialLeaseProvider || !cardMaterialLease
          || typeof cardMaterialLeaseProvider.withMaterial !== 'function') {
          throw new BrowserExecutionError('CARD_MATERIAL_PRECHECK_CONTRACT');
        }
        try {
          await cardMaterialLeaseProvider.withMaterial(cardMaterialLease, (material) => {
            assertCardMaterial(material);
          });
          cardMaterialReady = true;
          if (!fillCardFields && !paymentHandler && ownedCardMaterialLease) {
            await cardMaterialLeaseProvider.close(cardMaterialLease);
            cardMaterialLease = null;
            ownedCardMaterialLease = false;
          }
        } catch (error) {
          throw new BrowserExecutionError('CARD_NOT_READY', 'stored card material preflight failed', error);
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'card-material-preflight',
          ready: true,
          fieldsWritten: 0,
          submitCalls: 0,
        });
      }
      let checkoutNavigation = null;
      if (job.metadata.checkoutNavigationContract) {
        const assertContinue = async () => {
          if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
          if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
        };
        try {
          checkoutNavigation = await navigateToChatGPTCheckout(page, job.metadata.checkoutNavigationContract, {
            timeoutMs: this.timeoutMs,
            assertContinue,
            plan: job.metadata.plan || 'plus',
          });
        } catch (error) {
          if (error instanceof BrowserExecutionError) throw error;
          if (error?.code === 'SESSION_INVALID') throw new BrowserExecutionError('SESSION_INVALID', error.message, error);
          throw new BrowserExecutionError('CHECKOUT_NAVIGATION_FAILED', error.message, error);
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'checkout-navigation',
          plan: checkoutNavigation.plan || 'plus',
          checkoutCreated: checkoutNavigation.checkoutCreated,
          questionnaireSkipped: checkoutNavigation.questionnaireSkipped,
          checkoutUrlDigest: checkoutNavigation.checkoutUrlDigest,
          submitCalls: 0,
        });
      }
      // With a paymentHandler the LIVE adapter owns the single pass of
      // card → address → email → requote → submit. Filling address/email here
      // first and then demanding a strict zero-tax requote before the card
      // existed is exactly what stalled the 2026-09-06 real order at Checkout.
      const observeOnly = !fillCardFields && !paymentHandler;
      if (observeOnly && cardMaterialLease && cardMaterialLeaseProvider && typeof cardMaterialLeaseProvider.withMaterial === 'function') {
        await cardMaterialLeaseProvider.withMaterial(cardMaterialLease, async (material) => {
          if (material?.billingAddress) await fillBillingAddress(page, material.billingAddress, { timeoutMs: this.timeoutMs });
        });
      }
      if (observeOnly && transientBillingEmail) {
        await fillTransientBillingEmail(page, transientBillingEmail, { timeoutMs: this.timeoutMs });
      }
      let checkout = null;
      let checkoutBeforeBilling = null;
      let paymentResult = null;
      if (job.metadata.checkoutContract) {
        try {
          checkoutBeforeBilling = await observeCheckout(page, {
            ...job.metadata.checkoutContract,
            requireZeroTax: false,
            requireQuoteConsistency: false,
          });
          if (observeOnly) checkout = await observeCheckoutAfterRequote(page, job.metadata.checkoutContract, this.timeoutMs);
        } catch (error) {
          throw new BrowserExecutionError('CHECKOUT_OBSERVATION_FAILED', error.message, error);
        }
      }
      let cardFill = null;
      if (fillCardFields) {
        if (!cardMaterialLeaseProvider || !cardMaterialLease || !checkoutBeforeBilling) {
          throw new BrowserExecutionError('CARD_MATERIAL_FILL_CONTRACT');
        }
        try {
          cardFill = await fillSecureCardFieldsNonPayment(page, {
            cardMaterialLeaseProvider,
            lease: cardMaterialLease,
            assertContinue: async () => {
              if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
              if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
            },
            timeoutMs: this.timeoutMs,
            whileFilled: async (material) => {
              if (material?.billingAddress) await fillBillingAddress(page, material.billingAddress, { timeoutMs: this.timeoutMs });
              if (transientBillingEmail) await fillTransientBillingEmail(page, transientBillingEmail, { timeoutMs: this.timeoutMs });
              try {
                checkout = await observeCheckoutAfterRequote(page, job.metadata.checkoutContract, this.timeoutMs);
              } catch (error) {
                throw new BrowserExecutionError('CHECKOUT_OBSERVATION_FAILED', error.message, error);
              }
            },
          });
        } catch (error) {
          if (error instanceof BrowserExecutionError) throw error;
          throw new BrowserExecutionError('CARD_MATERIAL_FILL_FAILED', error.message, error);
        }
      }
      if (paymentHandler) {
        if (!cardMaterialLeaseProvider || !cardMaterialLease || !checkoutBeforeBilling
          || !job.metadata.checkoutContract || !transientBillingEmail) {
          throw new BrowserExecutionError('PAYMENT_RUNTIME_CONTRACT');
        }
        try {
          paymentResult = await cardMaterialLeaseProvider.withMaterial(cardMaterialLease, (material) => (
            paymentHandler({
              page,
              checkout: checkoutBeforeBilling,
              checkoutContract: job.metadata.checkoutContract,
              cardMaterial: material,
              billingEmail: transientBillingEmail,
              sessionIdentity,
            })
          ));
          preserveRuntime = (preserveRuntimeOnManualHandoff && paymentResult?.preserveProfile === true)
            || (paymentResult?.status === 'PRE_SUBMIT_STOPPED' && typeof this.runtimeAdapter.detach === 'function');
        } catch (error) {
          if (error instanceof BrowserExecutionError) throw error;
          throw new BrowserExecutionError(error?.code || 'PAYMENT_EXECUTION_FAILED', error.message, error);
        }
      }
      if (releaseSessionOnComplete && paymentResult?.status === 'COMPLETED'
        && this.sessionProvider && typeof this.sessionProvider.clearSession === 'function') {
        const released = await this.sessionProvider.clearSession(runtime.context).catch(() => null);
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'session-released',
          clearedCookieCount: released?.clearedCookieCount ?? null,
          clearedLoginCookieCount: released?.clearedLoginCookieCount ?? null,
        });
      }
      const readonlyChecklist = job.metadata.accountProbeContract ? {
        loggedIn: sessionIdentity?.loggedIn === true,
        identityMatched: sessionIdentity?.identityMatched === true,
        alreadyPlus: sessionIdentity?.alreadyPlus === true,
        plusEntryPresent: checkoutNavigation?.plusEntryPresent === true,
        checkoutRecognized: checkout?.recognized === true,
        fieldsWritten: 0,
        submitCalls: 0,
      } : null;
      const submitCalls = Number(paymentResult?.paymentSubmitCalls || 0);
      const status = !paymentResult ? 'OBSERVED'
        : paymentResult.status === 'PRE_SUBMIT_STOPPED' ? 'PRE_SUBMIT_STOPPED' : 'PAYMENT_EXECUTED';
      return { status, startedAt, finishedAt: this.clock(), submitCalls, sessionBootstrapped, cardMaterialReady, sessionIdentity, checkoutNavigation, checkoutBeforeBilling, checkout, cardFill, paymentResult, readonlyChecklist };
    } catch (error) {
      const failure = error instanceof BrowserExecutionError
        ? error
        : new BrowserExecutionError(error.name === 'TimeoutError' ? 'ACTION_TIMEOUT' : 'PAGE_CHECKPOINT_FAILED', error.message, error);
      if (preserveRuntimeOnFailure && runtime
        && !['SESSION_INVALID', 'SESSION_IDENTITY_MISMATCH'].includes(failure.reason)) {
        preserveRuntime = true;
      }
      await this._event(job, 'freeze', ++evidenceSequence, {
        action: 'fail-closed', reason: failure.reason,
        ...(failure.evidenceDetail && typeof failure.evidenceDetail === 'object' ? failure.evidenceDetail : {}),
      });
      throw failure;
    } finally {
      if (abortRuntime) signal?.removeEventListener('abort', abortRuntime);
      if (runtime) {
        if (preserveRuntime) await this.runtimeAdapter.detach(runtime).catch(() => undefined);
        else await this.runtimeAdapter.close(runtime).catch(() => undefined);
      }
      if (sessionLease && this.sessionProvider) await this.sessionProvider.close(sessionLease).catch(() => undefined);
      if (ownedCardMaterialLease && cardMaterialLease && cardMaterialLeaseProvider) {
        await cardMaterialLeaseProvider.close(cardMaterialLease).catch(() => undefined);
      }
    }
  }

  // PAGE_DRIFT 只说「页面对不上」，不说对不上哪一项、当时是什么值——2026-09-12 真单
  // 撞上它时只能靠推测（D-190）。这里把判据带出来：哪一项失败、实际值、期望值。
  // URL 只留 origin+pathname，query 可能带 token，不进证据。
  #drift(check, detail) {
    const error = new BrowserExecutionError('PAGE_DRIFT', `page signature mismatch on ${check}`);
    error.evidenceDetail = { check, ...detail };
    return error;
  }

  async _checkPage(page, contract) {
    const url = page.url();
    const safeUrl = (raw) => {
      try { const u = new URL(raw); return `${u.origin}${u.pathname}`; } catch { return '(unparseable)'; }
    };
    if (!url.startsWith(contract.urlPrefix)) {
      throw this.#drift('url', { actualUrl: safeUrl(url), expectedPrefix: contract.urlPrefix });
    }
    const marker = page.locator(contract.requiredSelector);
    try {
      await marker.waitFor({ state: 'visible', timeout: this.timeoutMs });
    } catch (error) {
      const notVisible = this.#drift('marker-visible', { selector: contract.requiredSelector });
      notVisible.cause = error;
      throw notVisible;
    }
    const markerCount = await marker.count();
    if (markerCount !== 1) {
      throw this.#drift('marker-count', { selector: contract.requiredSelector, actualCount: markerCount });
    }
    const title = await page.title();
    // ChatGPT titles its app "ChatGPT", the plan picker "ChatGPT Plans" and
    // the marketing shell "ChatGPT: ...". A resumed run may legitimately sit
    // on the plan picker, so any "ChatGPT"-prefixed title is the same app;
    // logged-out shells are rejected by the identity probe, not by the title.
    const titleMatches = contract.title === 'ChatGPT'
      ? title === contract.title || title.startsWith(`${contract.title}:`) || title.startsWith(`${contract.title} `)
      : title === contract.title;
    if (!titleMatches) {
      throw this.#drift('title', {
        actualTitle: String(title).slice(0, 120), expectedTitle: contract.title, actualUrl: safeUrl(url),
      });
    }
    const text = await marker.textContent();
    if (contract.markerText && !text?.includes(contract.markerText)) {
      throw this.#drift('marker-text', { selector: contract.requiredSelector, expectedText: contract.markerText });
    }
    return { title, frameCount: page.frames().length };
  }

  async _event(job, type, sequence, summary) {
    await this.evidenceSink.append({
      jobId: job.jobId,
      type,
      sequence,
      payloadDigest: digest(`${job.jobId}:${type}:${sequence}:${JSON.stringify(summary)}`),
      summary,
      // Timeline keys for database sinks; opaque refs, never material.
      ...(typeof job.orderRef === 'string' ? { orderRef: job.orderRef } : {}),
      ...(typeof job.metadata?.browserRunRef === 'string' ? { runRef: job.metadata.browserRunRef } : {}),
    });
  }
}
