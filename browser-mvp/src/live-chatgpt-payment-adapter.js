import { ContractError } from './contracts.js';
import { assertCardMaterial } from './card-material-lease.js';
import { SECURE_CARD_FIELD_SELECTORS } from './nonpayment-card-fill.js';
import { fillBillingAddress, fillTransientBillingEmail } from './billing-address-fill.js';
import { observeCheckout } from './checkout-observer.js';

export const LIVE_PAYMENT_CONFIRMATION = 'I-CONFIRM-LIVE-BROWSER-PAYMENT-ADAPTER';

export class LiveChatGPTPaymentAdapterError extends Error {
  constructor(message, code, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LiveChatGPTPaymentAdapterError';
    this.code = code;
  }
}

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new LiveChatGPTPaymentAdapterError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

async function oneVisible(page, selector, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const matches = [];
    for (const frame of page.frames()) {
      const locator = frame.locator(selector);
      for (let i = 0; i < await locator.count(); i += 1) {
        if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
      }
    }
    if (matches.length === 1) return matches[0];
    if (Date.now() >= deadline) throw new LiveChatGPTPaymentAdapterError(`${label} must resolve to one visible control`, 'CHECKOUT_DRIFT');
    await page.waitForTimeout(100);
  }
}

async function observeStrictQuoteAfterReprice(page, checkoutContract, timeoutMs, assertContinue) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    await assertContinue();
    try { return await observeCheckout(page, checkoutContract); } catch (error) {
      lastError = error;
      const pending = /tax is not zero|summary is incomplete|quote is incomplete|quote total does not match subtotal/i
        .test(String(error?.message || ''));
      if (!pending || Date.now() >= deadline) throw error;
      await page.waitForTimeout(250);
    }
  } while (true);
  throw lastError;
}

/**
 * Minimal LIVE adapter. It is inert unless both enabled=true and the exact
 * confirmation string are supplied by a separately controlled caller.
 * The adapter never decides success from a click; the caller must provide an
 * outcome observer, otherwise the result is deliberately UNKNOWN.
 */
// 「规则说不该付」的失败：留下填好的表单会诱导人违规付款，必须清空。
const POLICY_REFUSAL_PATTERN = /tax is not zero|quote (total does not match|is incomplete)|submit selector changed|currency does not match|summary is incomplete/i;

export class LiveChatGPTPaymentAdapter {
  constructor({ enabled = false, confirmation = '', outcomeObserver = null, challengeGate = null } = {}) {
    this.enabled = enabled === true && confirmation === LIVE_PAYMENT_CONFIRMATION;
    this.outcomeObserver = outcomeObserver;
    // D-154: optional human-verification gate. It only observes and waits; it
    // never satisfies the challenge and never issues a second submit click.
    this.challengeGate = challengeGate;
  }

  async submit({
    page, checkout, checkoutContract, cardMaterial, billingEmail, operationId,
    assertContinue = async () => undefined,
    beforeSubmit = async () => undefined,
    authorizeSubmit = null,
    repriceTimeoutMs = 30_000,
    // D-208：付款这一趟占全流程 73% 的时间，内部一个埋点都没有。运营问「卡在哪」
    // 时错误还没抛出来，stage 帮不上忙——只能看到 checkout-navigation 之后 56 秒黑盒。
    // 这个回调在每次跨步时同步调一次，由调用方落成事件。**它绝不能影响付款**：
    // 下面的 setStage 把它整个 try 住，抛什么都咽掉。
    onStage = null,
  } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
    const op = required(operationId, 'operationId');
    if (!checkout?.recognized || typeof checkout.submitControlSelector !== 'string' || !checkout.submitControlSelector.trim()) {
      throw new LiveChatGPTPaymentAdapterError('recognized Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (!checkoutContract || checkoutContract.requiredCurrency !== 'PHP'
      || checkoutContract.requireZeroTax !== true
      || checkoutContract.requireQuoteConsistency !== true) {
      throw new LiveChatGPTPaymentAdapterError('strict PHP zero-tax Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (typeof assertContinue !== 'function' || typeof beforeSubmit !== 'function') {
      throw new TypeError('assertContinue and beforeSubmit are required');
    }
    if (typeof authorizeSubmit !== 'function') throw new TypeError('authorizeSubmit is required');
    if (!Number.isInteger(repriceTimeoutMs) || repriceTimeoutMs < 1_000 || repriceTimeoutMs > 60_000) {
      throw new TypeError('repriceTimeoutMs must be between 1000 and 60000');
    }
    let submitted = false;
    let holdForReconcile = false;
    // D-205：卡三个字段都写进去了。之后任何失败都是"就差点一下"的完整现场，
    // 清掉它等于毁掉运营接手的机会和排查的唯一证据。
    let cardFieldsFilled = false;
    // D-205：区分两类失败前失败。
    //  - 故障类（超时、断连、页面抖动）：该付但没付成 → 留现场给运营接手。
    //  - 规则拒绝类（税不为零、报价对不上、币种/按钮变了）：**本来就不该付**。
    //    留一个填好的表单 + 亮着的订阅按钮，等于把人往违规付款上推：含税价
    //    ₱1,100 vs 免税价 ₱982.14，一点下去就多付 ₱117.86，而「必须零税」
    //    是项目硬约束。这类必须擦干净，让人看到空表单就知道有问题。
    let policyRefusal = false;
    // D-154: set only when a human-verification challenge raised by our single
    // submit click is still unanswered when we let go. The filled form is then
    // left for the PERSON who has to satisfy that challenge; clearing it would
    // strand them with an empty card form and no way to finish the purchase.
    let holdForHumanVerification = false;
    let stage = 'validate-card-material';
    let stageStartedAt = Date.now();
    const setStage = (next) => {
      const now = Date.now();
      const previousStage = stage;
      const previousElapsedMs = now - stageStartedAt;
      stage = next;
      stageStartedAt = now;
      if (typeof onStage !== 'function') return;
      try { onStage({ stage: next, previousStage, previousElapsedMs }); }
      catch { /* 埋点失败绝不影响付款：丢一条观察 << 让一单出错 */ }
    };
    try {
      assertCardMaterial(cardMaterial);
      // Stripe Link 的处理在 executor 的**观察之前**完成（D-201 修正）：观察器一旦发现
      // 卡字段缺失就判 CHECKOUT_OBSERVATION_FAILED，放在这里已经太晚。
      setStage('resolve-secure-card-controls');
      const fields = {};
      for (const [name, selector] of Object.entries(SECURE_CARD_FIELD_SELECTORS)) {
        fields[name] = await oneVisible(page, selector, name);
      }
      const values = {
        cardNumber: String(cardMaterial.pan).replace(/\s+/g, ''),
        expiry: `${String(cardMaterial.expMonth).padStart(2, '0')} / ${String(cardMaterial.expYear).slice(-2)}`,
        cvc: String(cardMaterial.cvc),
      };
      if (!/^\d{12,19}$/.test(values.cardNumber) || !/^\d{3,4}$/.test(values.cvc)) {
        throw new LiveChatGPTPaymentAdapterError('card material format is invalid', 'CARD_MATERIAL_INVALID');
      }
      try {
        setStage('fill-secure-card-controls');
        for (const [name, field] of Object.entries(fields)) {
          await assertContinue();
          if ((await field.inputValue()).trim()) throw new LiveChatGPTPaymentAdapterError(`${name} secure field is not empty`, 'CHECKOUT_DRIFT');
          await field.fill(values[name]);
        }
        cardFieldsFilled = true;
        if (!cardMaterial.billingAddress) {
          throw new LiveChatGPTPaymentAdapterError('billing address is required', 'CARD_MATERIAL_INVALID');
        }
        setStage('fill-billing-address');
        await assertContinue();
        await fillBillingAddress(page, cardMaterial.billingAddress, { timeoutMs: repriceTimeoutMs });
        setStage('fill-billing-email');
        await assertContinue();
        // Not every Checkout implementation asks for a receipt email (see
        // fillTransientBillingEmail). A page that does ask still must resolve to
        // exactly one field, so this cannot silently skip a real requirement.
        await fillTransientBillingEmail(page, billingEmail, { timeoutMs: repriceTimeoutMs });
        setStage('wait-for-zero-tax-requote');
        const strictCheckout = await observeStrictQuoteAfterReprice(
          page, checkoutContract, repriceTimeoutMs, assertContinue,
        );
        if (strictCheckout.submitControlSelector !== checkout.submitControlSelector) {
          throw new LiveChatGPTPaymentAdapterError('payment submit selector changed after requote', 'CHECKOUT_DRIFT');
        }
        setStage('final-pre-submit-check');
        await assertContinue();
        await beforeSubmit({ checkout: strictCheckout });
        await assertContinue();
        const submit = await oneVisible(page, strictCheckout.submitControlSelector, 'payment submit control');
        const shape = await submit.evaluate((element) => ({
          tag: element.tagName.toLowerCase(), type: element.getAttribute('type')?.toLowerCase() || null,
        }));
        if (shape.tag !== 'button' || shape.type !== 'submit') throw new ContractError('payment submit control shape drift');
        const intent = await authorizeSubmit();
        if (!intent?.executeExternal) {
          // Intentional in-attempt hold: no external submit happens, so keep the
          // filled form for the reconcile/requote path (do not clear below).
          holdForReconcile = true;
          return {
            status: 'RECONCILE_ONLY',
            quote: { currency: strictCheckout.currency, amount: strictCheckout.amount, estimatedTax: strictCheckout.estimatedTax },
          };
        }
        setStage('submit-payment');
        await submit.click();
        submitted = true;
        if (typeof this.outcomeObserver !== 'function') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome observer is required after submit', 'PAYMENT_RESULT_UNKNOWN');
        }
        let challenge = null;
        if (typeof this.challengeGate === 'function') {
          setStage('human-verification-gate');
          challenge = await this.challengeGate({ page, operationId: op, assertContinue });
          if (challenge?.challenged && !challenge.cleared) {
            holdForHumanVerification = true;
            // The click already happened, so this stays an UNKNOWN result: the
            // page may still settle after we let go. The reason is recorded so
            // the run says "a person had to verify" instead of nothing at all.
            const waiting = new LiveChatGPTPaymentAdapterError(
              `payment is waiting on human verification (${challenge.reason || 'HUMAN_VERIFICATION_REQUIRED'})`,
              'PAYMENT_RESULT_UNKNOWN',
            );
            // 结构化标识，别让上游去解析 message：只有人能过这一关，运营必须被叫醒。
            // 2026-09-12 真单卡在验证弹窗上，v1 侧只收到一个笼统的 PAYMENT_RESULT_UNKNOWN，
            // 于是告警落进「中间态不响手机」的静音名单，运营什么也没收到（D-190 续）。
            waiting.humanVerification = challenge.reason || 'HUMAN_VERIFICATION_REQUIRED';
            throw waiting;
          }
        }
        setStage('observe-payment-outcome');
        const outcome = await this.outcomeObserver({ page, operationId: op, challenge });
        if (outcome?.status === 'DECLINED') {
          // F-47: the Checkout stated the outcome itself. Returning it (instead of
          // throwing a bare "unknown") carries the reason to the run record. The
          // funds semantics are unchanged: anything that is not CONFIRMED still
          // locks the attempt for an operator to verify — no retry, no card swap.
          return {
            status: 'DECLINED',
            reasonCode: outcome.reasonCode || 'CARD_DECLINED',
            observedText: outcome.observedText || null,
            quote: {
              currency: strictCheckout.currency,
              amount: strictCheckout.amount,
              estimatedTax: strictCheckout.estimatedTax,
            },
          };
        }
        if (outcome?.status !== 'CONFIRMED') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome was not confirmed', 'PAYMENT_RESULT_UNKNOWN');
        }
        return {
          status: 'CONFIRMED', providerCallRef: `browser:${op}`,
          quote: {
            currency: strictCheckout.currency,
            amount: strictCheckout.amount,
            estimatedTax: strictCheckout.estimatedTax,
          },
        };
      } catch (error) {
        // Runs before the finally below, so it can tell that block which kind of
        // failure this was. Matching on message (not code) because all of these
        // arrive as CHECKOUT_DRIFT — the code alone cannot separate "the page
        // broke" from "the price was wrong".
        policyRefusal = POLICY_REFUSAL_PATTERN.test(String(error?.message || ''))
          || POLICY_REFUSAL_PATTERN.test(String(error?.cause?.message || ''));
        // D-210：现场会被下面的 finally 留在屏幕上（条件与 holdForOperator 一致）。
        // 上层据此给运营留出接手时间，而不是当场判失败、退 CDK、告诉客户"没完成，
        // 卡密可以重新兑换"——那句话在运营正要接手的几分钟里是危险的：客户照做就会
        // 变成两张卡付两次钱。
        if (cardFieldsFilled && !submitted && !policyRefusal) {
          try { error.sceneHeld = true; } catch { /* 冻结过的错误对象就算了 */ }
        }
        throw error;
      } finally {
        // Clear the secure card fields on every exit EXCEPT the intentional
        // reconcile hold (holdForReconcile), which deliberately keeps the filled
        // form for an in-attempt requote. This covers both the post-submit
        // boundary (submitted) and — critically — a pre-submit failure (drift/
        // timeout/lease loss): leaving the PAN in the field would keep card data
        // resident in a reusable page and poison any retry that reuses the same
        // checkout, which then fails the "secure field is not empty" guard
        // forever. Cleanup is best effort; after submit the page may have moved.
        // The one exception is holdForHumanVerification (D-154): the challenge is
        // still on screen and only a person can clear it, so the form stays. The
        // next order navigates to its own checkout, so nothing is reused.
        //
        // D-205 adds a second exception, requested by the operator after watching
        // it happen twice: the card went in whole, billing was filled, the price
        // settled — and then a pre-submit step failed and this block wiped the
        // lot. What the operator saw was a complete form emptying itself one step
        // short of Subscribe. Every normal return below happens after
        // submitted=true, so "filled but never submitted" is exactly the
        // fail-before-payment case, and that scene now stays on screen.
        // Same safety boundary as D-203: the next order runs startFresh=true and
        // closes this checkout page first, so the PAN never reaches another
        // customer's session.
        const holdForOperator = cardFieldsFilled && !submitted && !policyRefusal;
        if ((submitted || !holdForReconcile) && !holdForHumanVerification && !holdForOperator) {
          for (const field of Object.values(fields)) {
            try { await field.fill(''); } catch {
              await field.evaluate((element) => { element.value = ''; element.dispatchEvent(new Event('input', { bubbles: true })); }).catch(() => undefined);
            }
          }
        }
      }
    } catch (error) {
      // D-205：不带 stage 抛出去，日志里就只剩一个光秃秃的 CHECKOUT_DRIFT，
      // 连死在哪一步都说不出（2026-09-13 连着两单都是这样）。
      if (error instanceof LiveChatGPTPaymentAdapterError) {
        if (!error.stage) error.stage = stage;
        throw error;
      }
      const failure = new LiveChatGPTPaymentAdapterError(
        `LIVE Browser payment failed at ${stage}`,
        submitted ? 'PAYMENT_RESULT_UNKNOWN' : 'CHECKOUT_DRIFT', error,
      );
      failure.stage = stage;
      throw failure;
    }
  }
}
