import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { BrowserExecutionError, BrowserExecutionService } from '../src/executor.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';
import { createSyntheticJob } from '../src/fixtures.js';

const pageContract = {
  urlPrefix: 'data:text/html,',
  title: 'Browser MVP fixture',
  requiredSelector: '[data-browser-mvp-marker]',
  markerText: 'observe-only',
};

function makeJob(html = '<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main>') {
  const encoded = encodeURIComponent(html);
  return createSyntheticJob({
    state: 'RUNNING',
    metadata: { source: 'playwright-fixture', pageContract: { ...pageContract, urlPrefix: `data:text/html,${encoded}` } },
  });
}

async function withExecutor(callback) {
  const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
  const evidenceSink = new MemoryEvidenceSink();
  const executor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, timeoutMs: 3_000 });
  return callback(executor, evidenceSink);
}

test('local BrowserContext observes a page and never exposes a submit operation', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    const result = await executor.execute(makeJob(), { assertLease: async () => true });
    assert.equal(result.status, 'OBSERVED');
    assert.equal(result.submitCalls, 0);
    assert.deepEqual(evidenceSink.events.map((event) => event.type), ['intent', 'checkpoint']);
  });
});

test('page checkpoint waits for client hydration before checking the final title', async () => {
  await withExecutor(async (executor) => {
    const job = makeJob(`
      <title>Loading application</title>
      <script>
        setTimeout(() => {
          document.title = 'Browser MVP fixture';
          document.body.innerHTML = '<main data-browser-mvp-marker>observe-only</main>';
        }, 50);
      </script>
    `);
    const result = await executor.execute(job, { assertLease: async () => true });
    assert.equal(result.status, 'OBSERVED');
    assert.equal(result.submitCalls, 0);
  });
});

test('executor bootstraps an opaque Session lease before page observation', async () => {
  const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
  const evidenceSink = new MemoryEvidenceSink();
  const sessionProvider = new CookieSessionBootstrapAdapter({
    source: { load: async () => ({ cookieHeader: '__Secure-next-auth.session-token=fixture-session' }) },
  });
  const executor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, sessionProvider, timeoutMs: 3_000 });
  const job = makeJob();
  job.metadata.sessionRef = 'session-ref:executor';
  const result = await executor.execute(job, { assertLease: async () => true });
  assert.equal(result.sessionBootstrapped, true);
  assert.equal(result.submitCalls, 0);
  assert.equal(evidenceSink.events[1].summary.action, 'session-bootstrap');
  assert.equal(evidenceSink.events[1].summary.sessionDigest.length, 64);
});

test('page drift fails closed and records a redacted freeze reason', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    await assert.rejects(
      () => executor.execute(makeJob('<title>Unexpected page</title><main data-browser-mvp-marker>observe-only</main>'), { assertLease: async () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'PAGE_DRIFT',
    );
    assert.equal(evidenceSink.events.at(-1).type, 'freeze');
    assert.equal(evidenceSink.events.at(-1).summary.reason, 'PAGE_DRIFT');
  });
});

test('lease loss after navigation fails closed before checkpoint', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    let checks = 0;
    await assert.rejects(
      () => executor.execute(makeJob(), { assertLease: async () => ++checks < 2 }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'LEASE_LOST',
    );
    assert.deepEqual(evidenceSink.events.map((event) => event.type), ['intent', 'freeze']);
  });
});

test('manual freeze and navigation timeout both fail closed', async () => {
  await withExecutor(async (executor, evidenceSink) => {
    await assert.rejects(
      () => executor.execute(makeJob(), { assertLease: async () => true, freezeRequested: () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'MANUAL_FREEZE',
    );
    assert.equal(evidenceSink.events.at(-1).summary.reason, 'MANUAL_FREEZE');
  });

  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main>');
    }, 250);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/slow`;
    const runtimeAdapter = new LocalPlaywrightRuntimeAdapter({ browserType: chromium });
    const evidenceSink = new MemoryEvidenceSink();
    const timedExecutor = new BrowserExecutionService({ runtimeAdapter, evidenceSink, timeoutMs: 20 });
    const job = createSyntheticJob({
      state: 'RUNNING',
      metadata: { source: 'slow-fixture', pageContract: { ...pageContract, urlPrefix: url } },
    });
    await assert.rejects(
      () => timedExecutor.execute(job, { assertLease: async () => true }),
      (error) => error instanceof BrowserExecutionError && error.reason === 'ACTION_TIMEOUT',
    );
    assert.equal(evidenceSink.events.at(-1).summary.reason, 'ACTION_TIMEOUT');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
