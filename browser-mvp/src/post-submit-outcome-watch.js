/**
 * Post-submit page watch (F-47).
 *
 * After the single payment click the worker used to do exactly one thing: poll
 * the account until Plus appeared. A declined card therefore looked identical to
 * a hung page — five minutes of silence and then "payment result unknown", with
 * no reason recorded, even though the Checkout was showing "your card was
 * declined" the whole time (observed 2026-09-11, both in English and Tagalog).
 *
 * This module only READS the page. It never clicks, never resubmits, and never
 * decides that money did or did not move: a decline it sees is reported as a
 * reason, and the funds verdict still goes through the normal unknown/verify
 * path. Page text is treated as data, never as instructions.
 */

const DECLINE_PATTERNS = [
  // en — the wording varies ("was declined", "has been declined", and the card
  // number sometimes sits between the noun and the verb), so match loosely.
  /card\b[^.\n]{0,40}\b(declined|rejected)\b/i, /\b(declined|rejected)\b[^.\n]{0,20}\bcard\b/i,
  /declined by (your|the) (bank|card issuer)/i,
  /payment\b[^.\n]{0,30}\b(declined|unsuccessful|failed)\b/i, /insufficient funds/i,
  /incorrect (card number|cvc|security code)/i, /expired card/i,
  // tl (the PH exit renders Checkout in Filipino)
  /tinanggihan ang iyong kard/i, /tinanggihan/i,
  // zh
  /卡(片)?被拒|拒绝了您的卡|付款失败|余额不足|卡号(有误|不正确)/,
];

const GENERIC_ERROR_PATTERNS = [
  /something went wrong/i, /try again/i, /error/i, /may error/i, /出错|错误|请重试/,
];

/** Digit runs of 8+ never belong in an error note; a PAN must not ride along. */
const redact = (text) => String(text || '').replace(/\d[\d\s-]{6,}\d/g, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 200);

const PAGE_PROBE = () => {
  const nodes = Array.from(document.querySelectorAll('[role="alert"], [aria-live], [data-testid*="error" i], [class*="error" i], [class*="Error"]'));
  const texts = nodes
    .filter((node) => {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .map((node) => String(node.innerText || '').trim())
    .filter((text) => text.length > 0 && text.length < 400);
  return { url: location.href, texts: Array.from(new Set(texts)).slice(0, 6) };
};

/** Read-only classification of whatever the Checkout is showing right now. */
export async function observeCheckoutOutcome(page, { checkoutUrlPrefix = 'https://chatgpt.com/checkout/' } = {}) {
  let probe;
  try {
    probe = await page.evaluate(PAGE_PROBE);
  } catch (error) {
    return { state: 'UNREADABLE', detail: String(error?.message || '').slice(0, 80) };
  }
  const onCheckout = String(probe.url || '').startsWith(checkoutUrlPrefix);
  for (const text of probe.texts) {
    if (DECLINE_PATTERNS.some((pattern) => pattern.test(text))) {
      return { state: 'DECLINED', reasonCode: 'CARD_DECLINED', observedText: redact(text) };
    }
  }
  for (const text of probe.texts) {
    if (GENERIC_ERROR_PATTERNS.some((pattern) => pattern.test(text))) {
      return { state: 'PAGE_ERROR', reasonCode: 'CHECKOUT_PAGE_ERROR', observedText: redact(text) };
    }
  }
  return { state: onCheckout ? 'PENDING' : 'LEFT_CHECKOUT' };
}

/**
 * Polls the Checkout for a definite answer so a decline costs seconds instead of
 * the whole verification window. Returns as soon as the page says something, the
 * page leaves Checkout (payment accepted, redirect), or `windowMs` elapses.
 */
export function createPostSubmitWatch({
  windowMs = 60_000,
  pollIntervalMs = 2_000,
  checkoutUrlPrefix = 'https://chatgpt.com/checkout/',
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const total = Math.max(0, Math.trunc(windowMs) || 0);
  const interval = Math.min(Math.max(250, Math.trunc(pollIntervalMs) || 2_000), 10_000);
  return async function watchPostSubmit(page, { assertContinue } = {}) {
    const deadline = now() + total;
    let last = { state: 'PENDING' };
    while (true) {
      last = await observeCheckoutOutcome(page, { checkoutUrlPrefix });
      if (last.state === 'DECLINED' || last.state === 'PAGE_ERROR' || last.state === 'LEFT_CHECKOUT') return last;
      if (now() >= deadline) return { ...last, state: last.state === 'UNREADABLE' ? 'UNREADABLE' : 'PENDING' };
      await sleep(interval);
      if (typeof assertContinue === 'function') await assertContinue();
    }
  };
}
