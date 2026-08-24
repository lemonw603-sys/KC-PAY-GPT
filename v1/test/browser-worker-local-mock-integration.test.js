import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import { createBrowserWorkerService } from '../src/services/browser-worker-service.js';

const require = createRequire(import.meta.url);
const { createMockBrowserServer } = require('../../browser-poc/mock-browser-server');
const { inspectSyntheticCheckout } = require('../../browser-poc/local-mock-page-adapter');
const digest = (c) => c.repeat(64);

test('Worker control shell drives a local mock BrowserContext without payment', async () => {
  const mock = createMockBrowserServer();
  const baseUrl = await mock.start();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const calls = [];
  let completed = false;
  const dispatchRepository = {
    async claim() { return { jobId: 11, jobKey: 'local-mock-job', attemptId: 'attempt-1', status: 'CLAIMED', leaseOwner: 'local-worker', leaseToken: 'local-token' }; },
    async heartbeat(input) { calls.push(['heartbeat', input.jobId]); return { jobId: input.jobId }; },
    async complete(input) { completed = true; return { jobId: input.jobId, status: 'COMPLETED' }; }
  };
  const executionRepository = {
    async beginRun(input) { calls.push(['beginRun', input.attemptId]); return { runId: input.runId, runStatus: 'RUNNING', paymentState: 'NOT_STARTED' }; },
    async getRecoveryState() { return { recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' }; }
  };
  const runtime = {
    async navigate(url) { await page.goto(url); return { title: await page.title(), url: page.url() }; }
  };
  const service = createBrowserWorkerService({
    dispatchRepository, executionRepository,
    resolveExecutionContext: async () => ({ executorProfileId: 'profile-local', accountKeyHmac: digest('a'), profileManifestSha256: digest('b'), networkLeaseHmac: digest('c'), runId: 'run-local' }),
    runtime
  });
  try {
    const job = await service.claim('local-worker');
    const control = await service.runClaimedJob(job, { workerId: 'local-worker' });
    const result = await control.perform('navigate', (navigate) => navigate(`${baseUrl}/account?runId=local-mock&scenario=SUCCESS`));
    assert.equal(result.title, 'Browser executor local mock');
    assert.match(result.url, /\/account\?/);
    assert.equal(mock.gateway.submitCalls, 0);
    await control.complete();
    assert.equal(completed, true);
    assert.deepEqual(calls.map(([kind]) => kind), ['beginRun', 'heartbeat']);
  } finally {
    await context.close(); await browser.close(); await mock.stop();
  }
});

test('Worker fails closed on local checkout signature drift before any submit', async () => {
  const mock = createMockBrowserServer();
  const baseUrl = await mock.start();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const dispatchRepository = {
    async heartbeat(input) { return { jobId: input.jobId }; },
    async complete() { throw new Error('complete must not run after drift'); }
  };
  const executionRepository = {
    async beginRun(input) { return { runId: input.runId, runStatus: 'RUNNING', paymentState: 'NOT_STARTED' }; },
    async getRecoveryState() { return { recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' }; }
  };
  const service = createBrowserWorkerService({
    dispatchRepository, executionRepository,
    resolveExecutionContext: async () => ({ executorProfileId: 'profile-local', accountKeyHmac: digest('a'), profileManifestSha256: digest('b'), networkLeaseHmac: digest('c'), runId: 'run-drift' }),
    runtime: { async navigate(url) { await page.goto(url); return { url: page.url() }; } }
  });
  try {
    const control = await service.runClaimedJob({ jobId: 12, jobKey: 'drift-job', attemptId: 'attempt-drift', status: 'CLAIMED', leaseOwner: 'drift-worker', leaseToken: 'drift-token' }, { workerId: 'drift-worker' });
    await control.perform('navigate', (navigate) => navigate(`${baseUrl}/account?runId=drift&scenario=SUCCESS&variant=DRIFTED`));
    await page.getByRole('link', { name: 'Start synthetic checkout' }).click();
    const inspection = await inspectSyntheticCheckout(page);
    assert.equal(inspection.status, 'PAGE_SIGNATURE_MISMATCH');
    assert.equal(mock.gateway.submitCalls, 0);
    control.stop();
  } finally { await context.close(); await browser.close(); await mock.stop(); }
});

test('Worker aborts a local page action on lease loss with no submit event', async () => {
  let submitEvents = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') { setTimeout(() => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<form action="/submit" method="post"><button type="submit">submit</button></form>'); }, 5000); return; }
    if (request.url === '/submit') submitEvents += 1;
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let heartbeats = 0;
  const dispatchRepository = {
    async heartbeat(input) { heartbeats += 1; if (heartbeats > 1) throw Object.assign(new Error('expired'), { code: 'LEASE_NOT_OWNED' }); return { jobId: input.jobId }; }
  };
  const executionRepository = { async beginRun(input) { return { runId: input.runId, runStatus: 'RUNNING', paymentState: 'NOT_STARTED' }; }, async getRecoveryState() { return { recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' }; } };
  const service = createBrowserWorkerService({
    dispatchRepository, executionRepository,
    resolveExecutionContext: async () => ({ executorProfileId: 'profile-local', accountKeyHmac: digest('a'), profileManifestSha256: digest('b'), networkLeaseHmac: digest('c'), runId: 'run-abort' }),
    runtime: { async navigate(url, { signal } = {}) { const abort = new Promise((_, reject) => signal?.addEventListener('abort', () => { page.close().catch(() => {}); reject(new Error('page closed')); }, { once: true })); await Promise.race([page.goto(url), abort]); } }
  });
  try {
    const control = await service.runClaimedJob({ jobId: 13, jobKey: 'abort-job', attemptId: 'attempt-abort', status: 'CLAIMED', leaseOwner: 'abort-worker', leaseToken: 'abort-token' }, { workerId: 'abort-worker', leaseSeconds: 10 });
    await assert.rejects(control.perform('navigate', (navigate, { signal }) => navigate(`http://127.0.0.1:${address.port}/slow`, { signal }), { actionTimeoutMs: 5000 }), (error) => error.code === 'LEASE_LOST_DURING_ACTION');
    assert.equal(submitEvents, 0);
  } finally { await context.close().catch(() => {}); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('Worker stops a multi-page local run after an operator freeze', async () => {
  const mock = createMockBrowserServer();
  const baseUrl = await mock.start();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const accountPage = await context.newPage();
  let frozen = false;
  const dispatchRepository = { async heartbeat(input) { return { jobId: input.jobId }; } };
  const executionRepository = {
    async beginRun(input) { return { runId: input.runId, runStatus: 'RUNNING', paymentState: 'NOT_STARTED' }; },
    async getRecoveryState() { return frozen ? { recoveryMode: 'RECONCILE_ONLY', runStatus: 'RECONCILE_ONLY' } : { recoveryMode: 'RESUMABLE', runStatus: 'RUNNING' }; }
  };
  const service = createBrowserWorkerService({
    dispatchRepository, executionRepository,
    resolveExecutionContext: async () => ({ executorProfileId: 'profile-local', accountKeyHmac: digest('a'), profileManifestSha256: digest('b'), networkLeaseHmac: digest('c'), runId: 'run-freeze' }),
    runtime: {
      async navigate(url) { await accountPage.goto(url); return { url: accountPage.url() }; },
      async openCheckoutPopup() {
        const popupPromise = accountPage.waitForEvent('popup');
        await accountPage.getByRole('link', { name: 'Start synthetic checkout' }).click();
        const popup = await popupPromise;
        await popup.getByRole('heading', { name: 'Synthetic Plus checkout' }).waitFor();
        return { url: popup.url(), page: popup };
      },
      async sensitiveAction() { throw new Error('sensitive action must be blocked after freeze'); }
    }
  });
  try {
    const control = await service.runClaimedJob({ jobId: 14, jobKey: 'freeze-job', attemptId: 'attempt-freeze', status: 'CLAIMED', leaseOwner: 'freeze-worker', leaseToken: 'freeze-token' }, { workerId: 'freeze-worker' });
    await control.perform('navigate', (navigate) => navigate(`${baseUrl}/account?runId=freeze&scenario=SUCCESS&popup=1`));
    const popup = await control.perform('openCheckoutPopup', (open) => open());
    assert.match(popup.url, /\/checkout\?/);
    assert.equal(mock.gateway.submitCalls, 0);
    frozen = true;
    await assert.rejects(control.perform('sensitiveAction', (action) => action()), (error) => error.code === 'RUN_NOT_ACTIONABLE');
    assert.equal(mock.gateway.submitCalls, 0);
    await popup.page.close();
  } finally { await context.close(); await browser.close(); await mock.stop(); }
});
