/**
 * Human-verification gate (D-154).
 *
 * ChatGPT can answer the single payment submit click with a human-verification
 * challenge ("One more step before you're done — I am human", hCaptcha). The
 * challenge exists to keep automation out of the purchase, so this module never
 * touches it: it only DETECTS the challenge, tells the operator, and waits for a
 * person to satisfy it in the visible browser window. No clicking, no solving,
 * no third-party solver, no attempt to avoid triggering it.
 *
 * The payment button has already been clicked once when this runs. Waiting adds
 * no second click and no new funds risk: the page is left exactly as the click
 * left it, which is also what lets the operator finish it by hand.
 */

const CHALLENGE_PROBE = () => {
  const frames = Array.from(document.querySelectorAll('iframe'));
  // A vendor frame counts only when it is actually on screen. Invisible/zero-size
  // challenge frames are routinely embedded for passive scoring; treating those as
  // a challenge would stall every payment waiting for a checkbox nobody can see.
  const vendorFrame = frames.some((frame) => {
    const src = String(frame.getAttribute('src') || '');
    // Stripe 代理托管 hCaptcha：真实挑战的 src 是 js.stripe.com/v3/hcaptcha-inner-…，
    // 域名里根本没有 hcaptcha.com，所以只匹配厂商域名会漏掉 ChatGPT 结账页上的每一次
    // 挑战——2026-09-12 真单卡在验证弹窗上，这里三个信号全部没命中（D-190 续）。
    // 路径形态一并匹配；被动评分的 hcaptcha-invisible-… 虽然也会命中，但它是 1280x1、
    // hidden，被下面的可见性与尺寸过滤挡掉，这个分工不变。
    if (!/(^|\.)hcaptcha\.com|hcaptcha[-_]|recaptcha|turnstile|challenges\.cloudflare\.com/i.test(src)) return false;
    const style = window.getComputedStyle(frame);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const box = frame.getBoundingClientRect();
    return box.width > 40 && box.height > 40;
  });
  const widget = Boolean(document.querySelector('.h-captcha, [data-hcaptcha-widget-id], [data-sitekey]'));
  const body = String(document.body?.innerText || '');
  // Matched as a presence signal only; the text is never acted on as instructions.
  const prompt = /one more step before you'?re done|select the checkbox below|i am human|verify you are human/i.test(body);
  return { vendorFrame, widget, prompt };
};

/** Read-only: is a human-verification challenge on screen right now? */
export async function detectHumanVerification(page) {
  try {
    const probe = await page.evaluate(CHALLENGE_PROBE);
    const present = Boolean(probe.vendorFrame || (probe.widget && probe.prompt) || probe.prompt);
    return { present, signals: probe };
  } catch (error) {
    // A navigating/closing page is not evidence of a challenge.
    return { present: false, signals: null, probeError: String(error?.message || '').slice(0, 120) };
  }
}

/**
 * Builds the gate the payment adapter calls right after its single submit click.
 * `waitMs <= 0` disables waiting: the gate still reports a detected challenge so
 * the run records why it stalled instead of failing silently.
 */
export function createHumanVerificationGate({
  waitMs = 0,
  pollIntervalMs = 3_000,
  clearedStableMs = 2_000,
  notify = async () => undefined,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const wait = Number.isFinite(waitMs) ? Math.max(0, Math.trunc(waitMs)) : 0;
  const interval = Math.min(Math.max(500, Math.trunc(pollIntervalMs) || 3_000), 15_000);
  return async function humanVerificationGate({ page, operationId, assertContinue } = {}) {
    if (!page) throw new TypeError('page is required');
    const first = await detectHumanVerification(page);
    if (!first.present) return { challenged: false, cleared: true, waitedMs: 0 };
    const startedAt = now();
    await notify({ operationId: operationId || null, waitMs: wait, signals: first.signals });
    if (wait === 0) return { challenged: true, cleared: false, waitedMs: 0, reason: 'HUMAN_VERIFICATION_WAIT_DISABLED' };
    const deadline = startedAt + wait;
    let clearedSince = null;
    while (now() < deadline) {
      await sleep(interval);
      if (typeof assertContinue === 'function') await assertContinue();
      const probe = await detectHumanVerification(page);
      if (probe.present) { clearedSince = null; continue; }
      // Require the challenge to stay gone briefly: hCaptcha re-renders between steps.
      if (clearedSince == null) clearedSince = now();
      if (now() - clearedSince >= clearedStableMs) {
        return { challenged: true, cleared: true, waitedMs: now() - startedAt };
      }
    }
    return { challenged: true, cleared: false, waitedMs: now() - startedAt, reason: 'HUMAN_VERIFICATION_TIMEOUT' };
  };
}
