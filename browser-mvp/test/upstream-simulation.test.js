import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { FileDispatchStore } from '../src/dispatch-store.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { BrowserExecutionService } from '../src/executor.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { createSyntheticManifest } from '../src/fixtures.js';
import { runNonPaymentUpstreamSimulation } from '../src/nonpayment-simulation.js';
import { ContractError, hasSensitiveKey } from '../src/contracts.js';
import { projectUpstreamBrowserJob } from '../src/shared-contract-adapter.js';

const now = Date.parse('2026-08-26T00:00:00.000Z');
const pageHtml = encodeURIComponent(
  '<title>Browser MVP fixture</title><main data-browser-mvp-marker>observe-only</main>',
);

function projection(overrides = {}) {
  return {
    order: { id: 'ord-upstream-0001', status: 'CARD_READY' },
    attempt: { id: 'att-upstream-0001', status: 'PENDING' },
    profile: { id: 'prof-upstream-0001' },
    card: {
      ref: 'card:inventory:0001',
      routeRef: 'route:browser:0001',
      providerAccountRef: 'provider-account:hnskj:0001',
      inventoryStatus: 'AVAILABLE',
      readiness: {
        status: 'READY',
        evidenceDigest: 'a'.repeat(64),
        observedAt: now - 1_000,
        validUntil: now + 60_000,
      },
    },
    route: {
      ref: 'route:browser:0001',
      cardProviderRef: 'provider-account:hnskj:0001',
      executorKind: 'BROWSER',
      status: 'ACTIVE',
    },
    sessionRef: 'session-ref:upstream-0001',
    auditRef: 'audit:upstream-0001',
    fundsGate: { status: 'NOT_REQUESTED' },
    observation: {
      pageContract: {
        urlPrefix: `data:text/html,${pageHtml}`,
        title: 'Browser MVP fixture',
        requiredSelector: '[data-browser-mvp-marker]',
        markerText: 'observe-only',
      },
    },
    ...overrides,
  };
}

test('upstream projection carries only card/route/readiness references', () => {
  const job = projectUpstreamBrowserJob(projection(), {
    manifest: createSyntheticManifest(),
    now,
  });
  assert.equal(job.metadata.upstream.cardRef, 'card:inventory:0001');
  assert.equal(job.metadata.upstream.routeRef, 'route:browser:0001');
  assert.equal(job.metadata.upstream.providerAccountRef, 'provider-account:hnskj:0001');
  assert.equal(hasSensitiveKey(job), false);
  assert.equal('cardNumber' in job.metadata.upstream, false);
  assert.equal('cvv' in job.metadata.upstream, false);
});

test('stale, mismatched, or non-browser upstream projections fail before dispatch', () => {
  assert.throws(
    () => projectUpstreamBrowserJob(projection({
      card: { ...projection().card, readiness: { ...projection().card.readiness, validUntil: now - 1 } },
    }), { now }),
    ContractError,
  );
  assert.throws(
    () => projectUpstreamBrowserJob(projection({
      route: { ...projection().route, cardProviderRef: 'provider-account:other:0001' },
    }), { now }),
    ContractError,
  );
  assert.throws(
    () => projectUpstreamBrowserJob(projection({
      route: { ...projection().route, executorKind: 'API' },
    }), { now }),
    ContractError,
  );
});

test('non-payment simulation runs upstream projection through dispatch and BrowserContext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-upstream-sim-'));
  try {
    const dispatchStore = await new FileDispatchStore({
      filePath: join(dir, 'dispatch.json'),
      leaseMs: 5_000,
    }).init();
    const evidenceSink = new MemoryEvidenceSink();
    const executionService = new BrowserExecutionService({
      runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
      evidenceSink,
      timeoutMs: 2_000,
    });
    const result = await runNonPaymentUpstreamSimulation({
      projection: projection({ sessionRef: undefined }),
      dispatchStore,
      executionService,
      now,
    });
    assert.equal(result.result.status, 'OBSERVED');
    assert.equal(result.result.submitCalls, 0);
    assert.equal(result.completed.job.state, 'COMPLETED');
    assert.deepEqual(evidenceSink.events.map((event) => event.type), ['intent', 'checkpoint']);
    const snapshot = await dispatchStore.snapshot();
    assert.equal(snapshot.jobs[result.job.jobId].job.state, 'COMPLETED');
    assert.equal(snapshot.jobs[result.job.jobId].job.metadata.upstream.cardRef, 'card:inventory:0001');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
