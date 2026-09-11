import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCheckoutOutcome, createPostSubmitWatch } from '../src/post-submit-outcome-watch.js';

const pageOf = (probes) => {
  const queue = Array.isArray(probes) ? [...probes] : [probes];
  return { evaluate: async () => (queue.length > 1 ? queue.shift() : queue[0]) };
};
const CHECKOUT = 'https://chatgpt.com/checkout/openai_llc/oaics_abc';

test('the Tagalog decline the PH exit actually rendered is recognised', async () => {
  const result = await observeCheckoutOutcome(pageOf({ url: CHECKOUT, texts: ['Tinanggihan ang iyong kard.'] }));
  assert.equal(result.state, 'DECLINED');
  assert.equal(result.reasonCode, 'CARD_DECLINED');
  assert.equal(result.observedText, 'Tinanggihan ang iyong kard.');
});

test('declines are recognised in the other languages Checkout renders', async () => {
  for (const text of ['Your card was declined.', 'Your card has been declined', '您的卡被拒绝了', '余额不足']) {
    const result = await observeCheckoutOutcome(pageOf({ url: CHECKOUT, texts: [text] }));
    assert.equal(result.state, 'DECLINED', text);
  }
});

test('a card number can never ride along in the recorded note', async () => {
  const result = await observeCheckoutOutcome(pageOf({
    url: CHECKOUT, texts: ['Your card 5139 8996 5462 9839 was declined.'],
  }));
  assert.equal(result.state, 'DECLINED');
  assert.equal(/\d{8}/.test(result.observedText), false);
  assert.match(result.observedText, /\[redacted\]/);
});

test('a quiet Checkout is pending, and leaving Checkout is not an error', async () => {
  assert.equal((await observeCheckoutOutcome(pageOf({ url: CHECKOUT, texts: [] }))).state, 'PENDING');
  assert.equal((await observeCheckoutOutcome(pageOf({ url: 'https://chatgpt.com/', texts: [] }))).state, 'LEFT_CHECKOUT');
});

test('an unreadable page is never reported as a decline', async () => {
  const page = { evaluate: async () => { throw new Error('Execution context was destroyed'); } };
  const result = await observeCheckoutOutcome(page);
  assert.equal(result.state, 'UNREADABLE');
});

test('the watch returns on the first decline instead of burning the window', async () => {
  let ticks = 0;
  const page = { evaluate: async () => { ticks += 1; return { url: CHECKOUT, texts: ticks < 3 ? [] : ['Tinanggihan ang iyong kard.'] }; } };
  const watch = createPostSubmitWatch({
    windowMs: 600_000, pollIntervalMs: 1_000,
    now: (() => { let t = 0; return () => (t += 1_000); })(), sleep: async () => undefined,
  });
  const result = await watch(page);
  assert.equal(result.state, 'DECLINED');
  assert.equal(ticks, 3, 'stops as soon as the page says something');
});

test('a silent page still gives up at the window and stays PENDING, never DECLINED', async () => {
  const watch = createPostSubmitWatch({
    windowMs: 5_000, pollIntervalMs: 1_000,
    now: (() => { let t = 0; return () => (t += 1_000); })(), sleep: async () => undefined,
  });
  const result = await watch(pageOf({ url: CHECKOUT, texts: [] }));
  assert.equal(result.state, 'PENDING');
});

test('losing the worker lease stops the watch', async () => {
  const watch = createPostSubmitWatch({
    windowMs: 60_000, pollIntervalMs: 1_000,
    now: (() => { let t = 0; return () => (t += 1_000); })(), sleep: async () => undefined,
  });
  await assert.rejects(
    watch(pageOf({ url: CHECKOUT, texts: [] }), { assertContinue: async () => { throw new Error('LEASE_LOST'); } }),
    /LEASE_LOST/,
  );
});
