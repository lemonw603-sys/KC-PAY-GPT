import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHumanVerificationGate, detectHumanVerification } from '../src/human-verification-gate.js';

const pageWith = (probes) => {
  const queue = [...probes];
  return { evaluate: async () => (queue.length > 1 ? queue.shift() : queue[0]) };
};
const clean = { vendorFrame: false, widget: false, prompt: false };
const captcha = { vendorFrame: true, widget: true, prompt: true };

test('a checkout with no challenge is not reported as challenged', async () => {
  const probe = await detectHumanVerification(pageWith([clean]));
  assert.equal(probe.present, false);
});

test('an hCaptcha frame or its prompt text is detected', async () => {
  assert.equal((await detectHumanVerification(pageWith([captcha]))).present, true);
  assert.equal((await detectHumanVerification(pageWith([{ ...clean, prompt: true }]))).present, true);
  assert.equal((await detectHumanVerification(pageWith([{ ...clean, vendorFrame: true }]))).present, true);
});

test('a page that navigates while probed is not treated as a challenge', async () => {
  const page = { evaluate: async () => { throw new Error('Execution context was destroyed'); } };
  const probe = await detectHumanVerification(page);
  assert.equal(probe.present, false);
  assert.ok(probe.probeError);
});

test('no challenge means the gate returns immediately and notifies nobody', async () => {
  let notified = 0;
  const gate = createHumanVerificationGate({ waitMs: 60_000, notify: async () => { notified += 1; } });
  const result = await gate({ page: pageWith([clean]), operationId: 'op-1' });
  assert.deepEqual(result, { challenged: false, cleared: true, waitedMs: 0 });
  assert.equal(notified, 0);
});

test('a detected challenge notifies exactly once and never touches the page', async () => {
  let notified = 0;
  const page = { evaluate: async () => captcha };
  const gate = createHumanVerificationGate({
    waitMs: 6_000, pollIntervalMs: 1_000, notify: async () => { notified += 1; },
    now: (() => { let t = 0; return () => (t += 1_000); })(), sleep: async () => undefined,
  });
  const result = await gate({ page, operationId: 'op-2' });
  assert.equal(notified, 1);
  assert.equal(result.challenged, true);
  assert.equal(result.cleared, false);
  assert.equal(result.reason, 'HUMAN_VERIFICATION_TIMEOUT');
  // The page object exposes no click/fill surface at all: the gate cannot act on the challenge.
  assert.deepEqual(Object.keys(page), ['evaluate']);
});

test('the gate resumes once a person clears the challenge and it stays cleared', async () => {
  const probes = [captcha, captcha, clean, clean, clean, clean];
  let i = 0;
  const page = { evaluate: async () => probes[Math.min(i++, probes.length - 1)] };
  const gate = createHumanVerificationGate({
    waitMs: 60_000, pollIntervalMs: 1_000, clearedStableMs: 1_000,
    notify: async () => undefined,
    now: (() => { let t = 0; return () => (t += 1_000); })(), sleep: async () => undefined,
  });
  const result = await gate({ page, operationId: 'op-3' });
  assert.equal(result.challenged, true);
  assert.equal(result.cleared, true);
});

test('waitMs=0 reports the challenge without waiting', async () => {
  const gate = createHumanVerificationGate({ waitMs: 0, notify: async () => undefined });
  const result = await gate({ page: { evaluate: async () => captcha } });
  assert.equal(result.cleared, false);
  assert.equal(result.reason, 'HUMAN_VERIFICATION_WAIT_DISABLED');
});

test('losing the worker lease while waiting stops the gate instead of holding the page', async () => {
  const gate = createHumanVerificationGate({
    waitMs: 60_000, pollIntervalMs: 1_000, notify: async () => undefined,
    now: (() => { let t = 0; return () => (t += 1_000); })(), sleep: async () => undefined,
  });
  await assert.rejects(
    gate({ page: { evaluate: async () => captcha }, assertContinue: async () => { throw new Error('LEASE_LOST'); } }),
    /LEASE_LOST/,
  );
});

test('Stripe 代理托管的可见 hCaptcha 挑战会被识别，隐形评分框不会', async () => {
  // 2026-09-12 真单卡在结账页的验证弹窗上，三个信号全部没命中：Stripe 把 hCaptcha 托管在
  // js.stripe.com/v3/hcaptcha-inner-… 下，域名里没有 hcaptcha.com，旧正则一个都匹配不到。
  // 同一页面上还有 js.stripe.com/v3/hcaptcha-invisible-…（1280x1、hidden）做被动评分，
  // 它绝不能被当成挑战，否则每一单都会停下来等一个没人看得见的勾选框。（D-190 续）
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(`
      <iframe src="https://js.stripe.com/v3/hcaptcha-inner-ca2a4503.html" style="width:1280px;height:633px"></iframe>
      <iframe src="https://js.stripe.com/v3/hcaptcha-invisible-67ecf066.html" style="width:1280px;height:1px;display:block"></iframe>
    `);
    const challenged = await detectHumanVerification(page);
    assert.equal(challenged.present, true, '可见的 Stripe hCaptcha 必须识别为挑战');
    assert.equal(challenged.signals.vendorFrame, true);

    // 只剩隐形评分框：必须判定为「没有挑战」，否则每单都会白等
    await page.setContent(`
      <iframe src="https://js.stripe.com/v3/hcaptcha-invisible-67ecf066.html" style="width:1280px;height:1px;display:block"></iframe>
    `);
    const passive = await detectHumanVerification(page);
    assert.equal(passive.present, false, '隐形评分框不是挑战，不能停下来等人');
  } finally {
    await browser.close();
  }
});
