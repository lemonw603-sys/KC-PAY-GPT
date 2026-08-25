import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileDispatchStore, JobConflictError, LeaseLostError } from '../src/dispatch-store.js';
import { createSyntheticJob } from '../src/fixtures.js';

async function makeStore(clock, leaseMs = 10_000) {
  const dir = await mkdtemp(join(tmpdir(), 'browser-mvp-'));
  const store = new FileDispatchStore({ filePath: join(dir, 'dispatch.json'), leaseMs, clock });
  await store.init();
  return { dir, store };
}

test('enqueue is durable and idempotent', async () => {
  const clock = () => 1_000;
  const { dir, store } = await makeStore(clock);
  try {
    const job = createSyntheticJob();
    assert.equal((await store.enqueue(job)).created, true);
    assert.equal((await store.enqueue(job)).created, false);
    await assert.rejects(() => store.enqueue({ ...job, metadata: { changed: true } }), JobConflictError);
    const persisted = JSON.parse(await readFile(join(dir, 'dispatch.json'), 'utf8'));
    assert.equal(Object.keys(persisted.jobs).length, 1);
    assert.equal(persisted.idempotency[job.jobId], job.jobId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expired lease is recoverable and old token cannot heartbeat or complete', async () => {
  let now = 100;
  const { dir, store } = await makeStore(() => now, 100);
  try {
    const job = createSyntheticJob({ jobId: 'brjob:synth:lease' });
    await store.enqueue(job);
    const first = await store.claim('worker:one');
    now = 250;
    assert.deepEqual(await store.recover(), [job.jobId]);
    const second = await store.claim('worker:two');
    assert.notEqual(first.leaseToken, second.leaseToken);
    await assert.rejects(() => store.heartbeat(job.jobId, first.leaseToken), LeaseLostError);
    await assert.rejects(() => store.complete({ jobId: job.jobId, leaseToken: first.leaseToken }), LeaseLostError);
    await store.complete({ jobId: job.jobId, leaseToken: second.leaseToken });
    assert.equal((await store.snapshot()).jobs[job.jobId].job.state, 'COMPLETED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('eight concurrent mock workers claim 240 jobs exactly once', async () => {
  const { dir, store } = await makeStore(() => 1_000_000, 10_000);
  try {
    const jobs = Array.from({ length: 240 }, (_, index) => createSyntheticJob({
      jobId: `brjob:synth:${String(index).padStart(4, '0')}`,
      orderRef: `order:synth:${String(index).padStart(4, '0')}`,
      attemptRef: `attempt:synth:${String(index).padStart(4, '0')}`,
      profileRef: `profile:synth:${String(index).padStart(4, '0')}`,
    }));
    await Promise.all(jobs.map((job) => store.enqueue(job)));
    const claimed = [];
    await Promise.all(Array.from({ length: 8 }, async (_, workerIndex) => {
      while (true) {
        const item = await store.claim(`worker:${workerIndex}`);
        if (!item) return;
        claimed.push(item.job.jobId);
        await store.complete({ jobId: item.job.jobId, leaseToken: item.leaseToken });
      }
    }));
    assert.equal(claimed.length, 240);
    assert.equal(new Set(claimed).size, 240);
    const snapshot = await store.snapshot();
    assert.equal(Object.values(snapshot.jobs).filter((entry) => entry.job.state !== 'COMPLETED').length, 0);
    assert.equal(Object.values(snapshot.jobs).reduce((sum, entry) => sum + entry.attempts, 0), 240);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
