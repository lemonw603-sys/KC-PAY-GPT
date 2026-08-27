import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

import { FileDispatchStore } from '../src/dispatch-store.js';
import { BrowserExecutionService } from '../src/executor.js';
import { createSyntheticJob } from '../src/fixtures.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { AppendOnlyWal, WalEvidenceSink } from '../src/wal.js';

const durationMs = Number(process.env.SOAK_MS ?? 600_000);
const workerCount = Number(process.env.SOAK_WORKERS ?? 8);
const intervalMs = Number(process.env.SOAK_INTERVAL_MS ?? 100);
if (!Number.isFinite(durationMs) || durationMs < 1_000) throw new Error('SOAK_MS must be at least 1000');
if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error('SOAK_WORKERS must be positive');

const dir = await mkdtemp(join(tmpdir(), 'browser-mvp-soak-'));
const dispatchPath = join(dir, 'dispatch.json');
const walPath = join(dir, 'events.wal');
const store = await new FileDispatchStore({ filePath: dispatchPath, leaseMs: 5_000 }).init();
const wal = await new AppendOnlyWal({ filePath: walPath }).init();
const sink = new WalEvidenceSink(wal);
const claimedIds = new Set();
const metrics = { jobsEnqueued: 0, jobsCompleted: 0, duplicateClaims: 0, errors: 0, workerClaims: 0 };
let nextJob = 0;

async function enqueueOne() {
  const index = nextJob++;
  const job = createSyntheticJob({
    jobId: `brjob:soak:${String(index).padStart(8, '0')}`,
    orderRef: `order:soak:${String(index).padStart(8, '0')}`,
    attemptRef: `attempt:soak:${String(index).padStart(8, '0')}`,
    profileRef: 'profile:soak:0001',
  });
  await store.enqueue(job);
  metrics.jobsEnqueued += 1;
}

for (let index = 0; index < workerCount * 2; index += 1) await enqueueOne();

// One real local BrowserContext preflight keeps the soak tied to the M2 runtime.
const preflightEvidence = new MemoryEvidenceSink();
const preflight = new BrowserExecutionService({
  runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
  evidenceSink: preflightEvidence,
  timeoutMs: 3_000,
});
const fixtureHtml = encodeURIComponent('<title>Browser MVP soak</title><main data-browser-mvp-marker>observe-only</main>');
const preflightJob = createSyntheticJob({
  state: 'RUNNING',
  jobId: 'brjob:soak:preflight',
  metadata: {
    source: 'soak-preflight',
    pageContract: {
      urlPrefix: `data:text/html,${fixtureHtml}`,
      title: 'Browser MVP soak',
      requiredSelector: '[data-browser-mvp-marker]',
      markerText: 'observe-only',
    },
  },
});
await preflight.execute(preflightJob, { assertLease: async () => true });

const startedAt = Date.now();
async function worker(workerIndex) {
  while (Date.now() - startedAt < durationMs) {
    try {
      const item = await store.claim(`worker:soak:${workerIndex}`);
      if (!item) {
        await enqueueOne();
        await delay(intervalMs);
        continue;
      }
      metrics.workerClaims += 1;
      if (claimedIds.has(item.job.jobId)) metrics.duplicateClaims += 1;
      claimedIds.add(item.job.jobId);
      await sink.append({
        jobId: item.job.jobId,
        type: 'intent',
        sequence: 1,
        payloadDigest: 'a'.repeat(64),
        summary: { action: 'soak-observe', worker: `worker:${workerIndex}` },
      });
      await sink.append({
        jobId: item.job.jobId,
        type: 'checkpoint',
        sequence: 2,
        payloadDigest: 'b'.repeat(64),
        summary: { action: 'soak-checkpoint' },
      });
      await store.complete({ jobId: item.job.jobId, leaseToken: item.leaseToken });
      await sink.append({
        jobId: item.job.jobId,
        type: 'completion',
        sequence: 3,
        payloadDigest: 'c'.repeat(64),
        summary: { action: 'soak-complete' },
      });
      metrics.jobsCompleted += 1;
      await delay(intervalMs);
    } catch {
      metrics.errors += 1;
    }
  }
}

await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index)));
// Drain claims made at the stop boundary so the authoritative residual count is
// zero; this does not extend the measured soak window.
while (true) {
  const item = await store.claim('worker:soak:drain');
  if (!item) break;
  metrics.workerClaims += 1;
  if (claimedIds.has(item.job.jobId)) metrics.duplicateClaims += 1;
  claimedIds.add(item.job.jobId);
  await sink.append({ jobId: item.job.jobId, type: 'intent', sequence: 1, payloadDigest: 'a'.repeat(64), summary: { action: 'soak-drain' } });
  await sink.append({ jobId: item.job.jobId, type: 'checkpoint', sequence: 2, payloadDigest: 'b'.repeat(64), summary: { action: 'soak-drain-checkpoint' } });
  await store.complete({ jobId: item.job.jobId, leaseToken: item.leaseToken });
  await sink.append({ jobId: item.job.jobId, type: 'completion', sequence: 3, payloadDigest: 'c'.repeat(64), summary: { action: 'soak-drain-complete' } });
  metrics.jobsCompleted += 1;
}
const snapshot = await store.snapshot();
const residual = Object.values(snapshot.jobs).filter((entry) => !['COMPLETED', 'RECONCILE_ONLY', 'FROZEN'].includes(entry.job.state));
const records = await wal.verify();
const walBytes = (await stat(walPath)).size;
const report = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  workerCount,
  intervalMs,
  dispatchPath,
  walPath,
  metrics,
  uniqueClaims: claimedIds.size,
  residualJobs: residual.length,
  walRecords: records.length,
  walBytes,
  throughputPerSecond: metrics.jobsCompleted / Math.max(1, (Date.now() - startedAt) / 1000),
  preflight: { events: preflightEvidence.events.length, submitCalls: 0 },
};
const reportPath = join(dir, 'report.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
