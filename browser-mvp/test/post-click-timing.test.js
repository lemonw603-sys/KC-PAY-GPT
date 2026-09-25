import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createPostClickTiming } from '../src/post-click-timing.js';
import { createPaymentOutcomeObserver, timedGate } from '../src/shared-live-composition.js';

// D-389：点完付款后的计时只记录、不改流程。演练停在点击前跑不到这段，所以这里直接测
// 生产用的那两个函数（createPaymentOutcomeObserver / timedGate）：结果、错误、分支都必须
// 和不计时时一模一样；写文件失败不能碰到付款。

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'post-click-timing-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const lines = async (file) => (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
const page = (url = 'https://chatgpt.com/checkout/openai_llc/cs_live_secret123?token=abc') => ({ url: () => url });
const verifier = (confirmPlus, report = { recovered: false, steps: [] }) => ({ confirmPlus, recoveryReport: () => report });

test('a confirmed payment passes through untouched and every post-click segment is timed', async () => withDir(async (dir) => {
  const file = join(dir, 'timing.jsonl');
  const recorder = createPostClickTiming({ file });
  const timing = recorder.start({ runId: 'run-1', plan: 'plus' });
  const verification = { confirmed: true, evidence: { kind: 'PLUS_ACTIVE', identityMatched: true, httpStatus: 200 } };
  const gateResult = { challenged: false, cleared: true, waitedMs: 0 };
  const seenGateArgs = [];
  const gate = timedGate(timing, async (args) => { seenGateArgs.push(args); return gateResult; });
  const gateArgs = { page: page(), operationId: 'op-1', assertContinue: async () => undefined };
  assert.equal(await gate(gateArgs), gateResult, 'the gate result is the same object');
  assert.equal(seenGateArgs[0], gateArgs, 'the gate gets the same arguments');

  const observe = createPaymentOutcomeObserver({
    watchPostSubmit: async () => ({ state: 'LEFT_CHECKOUT' }),
    verifier: verifier(async () => verification),
    timing,
  });
  const outcome = await observe({ page: page() });
  assert.deepEqual(outcome, { status: 'CONFIRMED', plusVerification: verification });
  assert.equal(outcome.plusVerification, verification);
  timing.finish({ status: 'SUCCEEDED', paymentSubmitCalls: 1 });

  await recorder.drain();
  const recorded = await lines(file);
  assert.deepEqual(recorded.map((r) => r.event), ['human-verification-gate', 'checkout-outcome-watch', 'confirm-plan-active', 'payment-result']);
  assert.ok(recorded.every((r) => r.runId === 'run-1' && r.plan === 'plus' && typeof r.at === 'string'));
  assert.equal(recorded[1].state, 'LEFT_CHECKOUT');
  assert.equal(recorded[2].confirmed, true);
  assert.equal(recorded[2].identityMatched, true);
  assert.equal(recorded[2].httpStatus, 200);
  assert.equal(recorded[3].status, 'SUCCEEDED');
  const text = await readFile(file, 'utf8');
  assert.doesNotMatch(text, /cs_live_secret123|token=abc/, 'only host and first path segment are kept');
  assert.match(text, /"where":"chatgpt\.com\/checkout"/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
}));

test('a declined card still returns DECLINED without asking the account, exactly as before', async () => withDir(async (dir) => {
  const recorder = createPostClickTiming({ file: join(dir, 't.jsonl') });
  let asked = 0;
  const observe = createPaymentOutcomeObserver({
    watchPostSubmit: async () => ({ state: 'DECLINED', reasonCode: 'CARD_DECLINED', observedText: 'Your card was declined' }),
    verifier: verifier(async () => { asked += 1; return { confirmed: true }; }),
    timing: recorder.start({ runId: 'run-2' }),
  });
  assert.deepEqual(await observe({ page: page() }), { status: 'DECLINED', reasonCode: 'CARD_DECLINED', observedText: 'Your card was declined' });
  assert.equal(asked, 0);
}));

test('an unconfirmed account stays UNKNOWN, and a throwing check throws the very same error', async () => withDir(async (dir) => {
  const file = join(dir, 't.jsonl');
  const recorder = createPostClickTiming({ file });
  const timing = recorder.start({ runId: 'run-3' });
  const unconfirmed = { confirmed: false, evidence: { identityMatched: false } };
  const unknown = await createPaymentOutcomeObserver({
    watchPostSubmit: async () => ({ state: 'PENDING' }), verifier: verifier(async () => unconfirmed), timing,
  })({ page: page() });
  assert.deepEqual(unknown, { status: 'UNKNOWN', plusVerification: unconfirmed });

  const boom = Object.assign(new Error('session invalid 4111111111111111'), { code: 'SESSION_INVALID' });
  const report = { recovered: false, recoveryStep: 'reload', errorCode: 'SESSION_RECOVERY_FAILED', steps: [] };
  await assert.rejects(
    createPaymentOutcomeObserver({ watchPostSubmit: async () => ({ state: 'LEFT_CHECKOUT' }), verifier: verifier(async () => { throw boom; }, report), timing })({ page: page() }),
    (error) => error === boom,
  );
  await recorder.drain();
  const failed = (await lines(file)).at(-1);
  assert.equal(failed.event, 'confirm-plan-active');
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'SESSION_INVALID');
  assert.doesNotMatch(failed.error.message, /4111111111111111/, 'long digit runs never reach the file');
  assert.equal(failed.recovery.recoveryStep, 'reload', 'the recovery ladder result is kept on failure too');
}));

test('a page watch that throws still falls through to the account check (UNREADABLE), as before', async () => {
  let asked = 0;
  const observe = createPaymentOutcomeObserver({
    watchPostSubmit: async () => { throw new Error('page closed'); },
    verifier: verifier(async () => { asked += 1; return { confirmed: true }; }),
    timing: createPostClickTiming().start({ runId: 'run-4' }),
  });
  assert.equal((await observe({ page: page() })).status, 'CONFIRMED');
  assert.equal(asked, 1);
});

test('a broken disk never reaches the payment: results and errors are unchanged when writing fails', async () => {
  const recorder = createPostClickTiming({ file: '/nonexistent-dir/timing.jsonl', write: async () => { throw new Error('EACCES'); } });
  const timing = recorder.start({ runId: 'run-5' });
  const verification = { confirmed: true, evidence: { identityMatched: true } };
  const observe = createPaymentOutcomeObserver({ watchPostSubmit: async () => ({ state: 'LEFT_CHECKOUT' }), verifier: verifier(async () => verification), timing });
  assert.deepEqual(await observe({ page: page() }), { status: 'CONFIRMED', plusVerification: verification });
  const gateError = new Error('lease lost');
  await assert.rejects(timedGate(timing, async () => { throw gateError; })({ page: page() }), (error) => error === gateError);
  timing.finish({ status: 'UNKNOWN' });
  timing.fail(new Error('x'));
  await recorder.drain();
});

test('a describe hook that throws only costs the record, never the result', async () => withDir(async (dir) => {
  const file = join(dir, 't.jsonl');
  const recorder = createPostClickTiming({ file });
  const timing = recorder.start({ runId: 'run-6' });
  const broken = { confirmPlus: async () => ({ confirmed: true }), recoveryReport: () => { throw new Error('bad report'); } };
  const observe = createPaymentOutcomeObserver({ watchPostSubmit: async () => ({ state: 'LEFT_CHECKOUT' }), verifier: broken, timing });
  assert.equal((await observe({ page: page() })).status, 'CONFIRMED');
  await recorder.drain();
  assert.equal((await lines(file)).at(-1).describeFailed, true);
}));

test('without a file nothing is written and nothing changes (the default for every caller but the pool)', async () => {
  let writes = 0;
  const recorder = createPostClickTiming({ write: async () => { writes += 1; } });
  assert.equal(recorder.enabled, false);
  const observe = createPaymentOutcomeObserver({
    watchPostSubmit: async () => ({ state: 'LEFT_CHECKOUT' }), verifier: verifier(async () => ({ confirmed: false })), timing: recorder.start({ runId: 'r' }),
  });
  assert.equal((await observe({ page: page() })).status, 'UNKNOWN');
  // and the observer works with no timing argument at all
  assert.equal((await createPaymentOutcomeObserver({ watchPostSubmit: async () => ({ state: 'LEFT_CHECKOUT' }), verifier: verifier(async () => ({ confirmed: true })) })({ page: page() })).status, 'CONFIRMED');
  await recorder.drain();
  assert.equal(writes, 0);
});

test('an oversized file is rolled over once, so the record cannot grow without bound', async () => withDir(async (dir) => {
  const file = join(dir, 't.jsonl');
  await writeFile(file, 'x'.repeat(200));
  const recorder = createPostClickTiming({ file, maxBytes: 100 });
  recorder.start({ runId: 'run-7' }).finish({ status: 'SUCCEEDED' });
  await recorder.drain();
  assert.equal((await readFile(`${file}.1`, 'utf8')).length, 200);
  assert.equal((await lines(file)).length, 1);
}));
