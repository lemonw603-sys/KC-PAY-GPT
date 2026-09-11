import test from 'node:test';
import assert from 'node:assert/strict';
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
