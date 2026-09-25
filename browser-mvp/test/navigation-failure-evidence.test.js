import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } from '../src/chatgpt-checkout-navigator.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT } from '../src/checkout-observer.js';
import { BrowserExecutionService } from '../src/executor.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createSyntheticJob } from '../src/fixtures.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { defaultNavigationEvidenceOptions, startNavigationEvidence } from '../src/navigation-failure-evidence.js';

// D-379 / D-380：导航失败存本机证据包（完整 trace + 现场），成功丢弃；取证出错不改变订单结局。

async function tmpRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'nav-evidence-')); }
async function listDirs(root) {
  try { return (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
}
const mode = async (p) => (await fs.stat(p)).mode & 0o777;

// A page whose "payment form" request fails with a body we must be able to read back later.
function failingSite() {
  return createServer((request, response) => {
    if (request.url === '/api/payment-form') {
      response.writeHead(500, { 'content-type': 'application/json', 'set-cookie': 'probe=1' });
      response.end(JSON.stringify({ error: 'payment form unavailable for this region' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<title>Evidence fixture</title><main>Configure your plan</main>
      <script>console.error('boot warning from fixture');
        fetch('/api/payment-form', { headers: { Authorization: 'Bearer fixture-bearer' } })
          .then((r) => { if (!r.ok) throw new Error('Unable to load payment form'); });</script>`);
  });
}

async function withPage(fn, server = failingSite()) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    return await fn({ page, context, base });
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
}

test('a navigation failure leaves a complete local bundle: trace, console, page errors, network with the failing body, page, screenshot', async () => {
  const root = await tmpRoot();
  await withPage(async ({ page, base }) => {
    const recorder = await startNavigationEvidence({ page, runRef: 'run:4523dfa2-e579-4c03', root });
    await page.goto(base);
    await page.waitForTimeout(500);
    const out = await recorder.capture({ reason: 'CHECKOUT_NAVIGATION_FAILED', error: new Error('run lease expired\nstack'), actions: ['pricing-already-open', 'upgrade-requested'] });
    assert.match(out.evidenceRef, /^\d{8}T\d{6}Z-4523dfa2e579$/);
    const dir = path.join(root, out.evidenceRef);
    const files = (await fs.readdir(dir)).sort();
    assert.deepEqual(files, ['console.json', 'network.json', 'page-errors.json', 'page.aria.txt', 'page.html', 'screenshot.png', 'summary.json', 'trace.zip']);
    assert.equal(await mode(root), 0o700);
    assert.equal(await mode(dir), 0o700);
    for (const file of files) assert.equal(await mode(path.join(dir, file)), 0o600, file);
    const network = JSON.parse(await fs.readFile(path.join(dir, 'network.json'), 'utf8'));
    const failing = network.find((row) => row.url.endsWith('/api/payment-form'));
    assert.equal(failing.status, 500);
    assert.match(failing.body, /payment form unavailable for this region/);
    assert.match(JSON.stringify(JSON.parse(await fs.readFile(path.join(dir, 'page-errors.json'), 'utf8'))), /Unable to load payment form/);
    assert.match(await fs.readFile(path.join(dir, 'console.json'), 'utf8'), /boot warning from fixture/);
    assert.match(await fs.readFile(path.join(dir, 'page.aria.txt'), 'utf8'), /Configure your plan/);
    const summary = JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf8'));
    assert.equal(summary.reason, 'CHECKOUT_NAVIGATION_FAILED');
    assert.equal(summary.error, 'run lease expired');
    assert.deepEqual(summary.actions, ['pricing-already-open', 'upgrade-requested']);
    // D-380: the trace keeps everything, request headers included.
    const listing = execFileSync('unzip', ['-l', path.join(dir, 'trace.zip')], { encoding: 'utf8' });
    assert.match(listing, /trace\.trace/);
    assert.match(execFileSync('unzip', ['-p', path.join(dir, 'trace.zip'), 'trace.network'], { encoding: 'utf8' }), /fixture-bearer/);
  });
});

test('a successful navigation discards the recording: no bundle, and later actions are in no recording', async () => {
  const root = await tmpRoot();
  await withPage(async ({ page, context, base }) => {
    const recorder = await startNavigationEvidence({ page, runRef: 'run:ok', root });
    await page.goto(base);
    await recorder.discard();
    assert.deepEqual(await listDirs(root), []);
    // Tracing is really off: a fresh start succeeds instead of "already started".
    await context.tracing.start({ snapshots: true });
    await context.tracing.stop();
    assert.deepEqual(await recorder.capture({ reason: 'late' }), { evidenceRef: null, evidenceError: 'already-finished' });
    assert.deepEqual(await listDirs(root), []);
  });
});

test('evidence that cannot be written never throws; the caller gets evidenceRef null', async () => {
  const blocker = path.join(await tmpRoot(), 'a-file');
  await fs.writeFile(blocker, 'x');
  await withPage(async ({ page, base }) => {
    const recorder = await startNavigationEvidence({ page, runRef: 'run:x', root: path.join(blocker, 'evidence') });
    await page.goto(base);
    const out = await recorder.capture({ reason: 'CHECKOUT_NAVIGATION_FAILED' });
    assert.equal(out.evidenceRef, null);
    assert.ok(out.evidenceError);
  });
});

test('a recording left running by an earlier run is replaced, not a reason to lose this run\'s evidence', async () => {
  const root = await tmpRoot();
  await withPage(async ({ page, context, base }) => {
    await context.tracing.start({ snapshots: true });
    const recorder = await startNavigationEvidence({ page, runRef: 'run:stale', root });
    await page.goto(base);
    const out = await recorder.capture({ reason: 'X' });
    const dir = path.join(root, out.evidenceRef);
    assert.ok((await fs.readdir(dir)).includes('trace.zip'));
    const summary = JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf8'));
    assert.ok(summary.notes.some((note) => note.startsWith('trace-restarted')));
  });
});

test('bundles older than 14 days are removed when a new one is written; the size cap drops screenshot, html, then trace', async () => {
  const root = await tmpRoot();
  const old = path.join(root, '20260901T000000Z-old');
  const recent = path.join(root, '20260924T000000Z-recent');
  await fs.mkdir(old); await fs.mkdir(recent);
  const now = Date.now();
  await fs.utimes(old, new Date(now - 15 * 86_400_000), new Date(now - 15 * 86_400_000));
  await withPage(async ({ page, base }) => {
    const recorder = await startNavigationEvidence({ page, runRef: 'run:cap', root, maxBundleBytes: 1 });
    await page.goto(base);
    const out = await recorder.capture({ reason: 'X' });
    const dirs = await listDirs(root);
    assert.ok(!dirs.includes('20260901T000000Z-old'), 'old bundle pruned');
    assert.ok(dirs.includes('20260924T000000Z-recent'), 'recent bundle kept');
    const files = await fs.readdir(path.join(root, out.evidenceRef));
    for (const dropped of ['screenshot.png', 'page.html', 'trace.zip']) assert.ok(!files.includes(dropped), `${dropped} dropped by the cap`);
    const summary = JSON.parse(await fs.readFile(path.join(root, out.evidenceRef, 'summary.json'), 'utf8'));
    assert.equal(summary.notes.filter((note) => note.startsWith('dropped ')).length, 3);
  });
});

test('evidence is off under the test runner and with BROWSER_NAVIGATION_EVIDENCE=off, on otherwise', () => {
  assert.equal(defaultNavigationEvidenceOptions({ NODE_TEST_CONTEXT: 'child-v8' }).enabled, false);
  assert.equal(defaultNavigationEvidenceOptions({ BROWSER_NAVIGATION_EVIDENCE: 'off' }).enabled, false);
  assert.equal(defaultNavigationEvidenceOptions({}).enabled, true);
  assert.equal(defaultNavigationEvidenceOptions({ BROWSER_EVIDENCE_DIR: '/x' }).root, '/x');
});

// ---- through the real executor ----

function navigatorSite({ checkoutWorks }) {
  return createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/api/auth/session') {
      response.end(JSON.stringify({ user: { id: 'user-fixture', email: 'buyer@example.test' }, account: { id: 'account-fixture' }, accessToken: 'fixture-access-token' }));
      return;
    }
    if (request.url?.startsWith('/backend-api/accounts/check/')) {
      response.end(JSON.stringify({ accounts: { default: { entitlement: { has_active_subscription: false, subscription_plan: 'free' } } } }));
      return;
    }
    if (request.url?.startsWith('/checkout/')) {
      response.end('<title>Checkout</title><main data-testid="checkout-page-content">checkout</main>');
      return;
    }
    const plus = checkoutWorks
      ? `<button type="button" onclick="location.href='/checkout/oaics_fixture'">Upgrade to Plus</button>`
      : '<button type="button">Upgrade to Pro</button>';
    response.end(`<title>Navigator fixture</title><main data-browser-mvp-marker>observe-only</main>
      <button type="button" aria-label="Upgrade" onclick="document.querySelector('[role=dialog]').hidden=false">Upgrade</button>
      <section role="dialog" hidden>${plus}</section>`);
  });
}

// 成功用例只测到「导航成功」为止：执行器写下 checkout-navigation 那一刻把测试页关掉，后面的结账页检查立刻失败
// （否则要跑一分多钟）。那是导航之后的失败，不该留证据——这条也一并验了。录制若没在这之前停掉，断言当场红。
class CloseOnNavigatedSink extends MemoryEvidenceSink {
  constructor(pageRef) { super(); this.pageRef = pageRef; }
  async append(event) {
    const result = await super.append(event);
    if (event.summary?.action === 'checkout-navigation') await this.pageRef.page?.close().catch(() => undefined);
    return result;
  }
}

async function runExecutor({ checkoutWorks, navigationEvidence }) {
  const server = navigatorSite({ checkoutWorks });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const pageRef = {};
  const evidenceSink = new CloseOnNavigatedSink(pageRef);
  const start = navigationEvidence?.start || startNavigationEvidence;
  const tracked = { ...navigationEvidence, start: async (options) => { pageRef.page = options.page; return start(options); } };
  const executor = new BrowserExecutionService({ runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }), evidenceSink, timeoutMs: 3_000, navigationEvidence: tracked });
  const job = createSyntheticJob({
    state: 'RUNNING',
    metadata: {
      pageContract: { urlPrefix: `${base}/`, title: 'Navigator fixture', requiredSelector: '[data-browser-mvp-marker]', markerText: 'observe-only' },
      sessionIdentity: { email: 'buyer@example.test', accountId: 'account-fixture' },
      accountProbeContract: { accountCheckPath: '/backend-api/accounts/check/v4-fixture' },
      checkoutNavigationContract: { ...CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, homeUrlPrefix: `${base}/`, checkoutUrlPrefix: `${base}/checkout/`, openPricingSelectors: ['button[aria-label="Upgrade"]'] },
      checkoutContract: { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, urlPrefix: `${base}/checkout/` },
    },
  });
  let error = null;
  try { await executor.execute(job, { assertLease: async () => true }); } catch (caught) { error = caught; }
  finally { server.close(); await once(server, 'close'); }
  return { error, events: evidenceSink.events };
}

test('executor: a navigation failure writes a bundle and names it on the fail-closed event; the outcome is unchanged', async () => {
  const root = await tmpRoot();
  const { error, events } = await runExecutor({ checkoutWorks: false, navigationEvidence: { enabled: true, root } });
  assert.equal(error?.reason, 'CHECKOUT_NAVIGATION_FAILED');
  const closed = events.at(-1).summary;
  assert.equal(closed.reason, 'CHECKOUT_NAVIGATION_FAILED');
  assert.deepEqual(closed.navigationActions, ['pricing-opened']);
  assert.deepEqual(await listDirs(root), [closed.evidenceRef]);
  assert.ok((await fs.readdir(path.join(root, closed.evidenceRef))).includes('trace.zip'));
});

test('executor: when the evidence cannot be written the order still fails the same way, with evidenceRef null', async () => {
  const blocker = path.join(await tmpRoot(), 'a-file');
  await fs.writeFile(blocker, 'x');
  const { error, events } = await runExecutor({ checkoutWorks: false, navigationEvidence: { enabled: true, root: path.join(blocker, 'evidence') } });
  assert.equal(error?.reason, 'CHECKOUT_NAVIGATION_FAILED');
  const closed = events.at(-1).summary;
  assert.equal(closed.reason, 'CHECKOUT_NAVIGATION_FAILED');
  assert.match(closed.navigationError, /upgrade control/);
  assert.equal(closed.evidenceRef, null);
});

test('executor: a navigation that reaches Checkout leaves no bundle behind', async () => {
  const root = await tmpRoot();
  const { events } = await runExecutor({ checkoutWorks: true, navigationEvidence: { enabled: true, root } });
  assert.ok(events.some((event) => event.summary?.action === 'checkout-navigation'), 'navigation succeeded');
  assert.deepEqual(await listDirs(root), []);
});

test('executor: with evidence off, the fail-closed event carries no evidenceRef at all (same as before)', async () => {
  const { events } = await runExecutor({ checkoutWorks: false, navigationEvidence: { enabled: false } });
  assert.equal('evidenceRef' in events.at(-1).summary, false);
});

test('executor: the recording is stopped as soon as navigation succeeds, before anything after it (card entry) runs', async () => {
  const root = await tmpRoot();
  const calls = [];
  const start = async (options) => {
    const recorder = await startNavigationEvidence(options);
    const context = options.page.context();
    return {
      async discard() { calls.push('discard'); await recorder.discard(); calls.push(`tracing-free:${await context.tracing.start().then(() => context.tracing.stop()).then(() => true, () => false)}`); },
      async capture(args) { calls.push('capture'); return recorder.capture(args); },
    };
  };
  const { events } = await runExecutor({ checkoutWorks: true, navigationEvidence: { enabled: true, root, start } });
  const navigated = events.findIndex((event) => event.summary?.action === 'checkout-navigation');
  assert.ok(navigated >= 0, 'navigation succeeded');
  assert.deepEqual(calls, ['discard', 'tracing-free:true']);
  assert.deepEqual(await listDirs(root), []);
});

