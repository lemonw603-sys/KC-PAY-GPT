import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileDispatchStore } from '../src/dispatch-store.js';
import { createSyntheticEvidence, createSyntheticJob } from '../src/fixtures.js';
import { reconcileIncompleteJobs } from '../src/recovery.js';
import { AppendOnlyWal, WalEvidenceSink, WalIntegrityError } from '../src/wal.js';

async function makePaths() {
  const dir = await mkdtemp(join(tmpdir(), 'browser-mvp-wal-'));
  return { dir, dispatchPath: join(dir, 'dispatch.json'), walPath: join(dir, 'events.wal') };
}

test('WAL appends a verifiable hash chain and survives a fresh instance', async () => {
  const { dir, walPath } = await makePaths();
  try {
    const wal = await new AppendOnlyWal({ filePath: walPath, clock: () => 123 }).init();
    const sink = new WalEvidenceSink(wal);
    const job = createSyntheticJob({ jobId: 'brjob:synth:wal' });
    await sink.append(createSyntheticEvidence(job));
    await sink.append({ ...createSyntheticEvidence(job), type: 'checkpoint', sequence: 2 });
    const restarted = await new AppendOnlyWal({ filePath: walPath }).init();
    assert.equal((await restarted.verify()).length, 2);
    assert.equal((await readFile(walPath, 'utf8')).endsWith('\n'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('WAL truncation and tampering stop recovery instead of replaying work', async () => {
  const { dir, walPath } = await makePaths();
  try {
    const wal = await new AppendOnlyWal({ filePath: walPath }).init();
    await wal.append(createSyntheticEvidence(createSyntheticJob({ jobId: 'brjob:synth:tamper' })));
    const original = await readFile(walPath, 'utf8');
    await writeFile(walPath, `${original.slice(0, -8)}`);
    await assert.rejects(() => wal.verify(), WalIntegrityError);
    await writeFile(walPath, `${original.trim()}\n`);
    const altered = original.replace('"intent"', '"freeze"');
    await writeFile(walPath, altered);
    await assert.rejects(() => wal.verify(), WalIntegrityError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restart with intent/checkpoint but no terminal event enters reconcile-only', async () => {
  const { dir, dispatchPath, walPath } = await makePaths();
  try {
    const store = await new FileDispatchStore({ filePath: dispatchPath, clock: () => 100 }).init();
    const job = createSyntheticJob({ jobId: 'brjob:synth:recover' });
    await store.enqueue(job);
    const claimed = await store.claim('worker:crash');
    const wal = await new AppendOnlyWal({ filePath: walPath }).init();
    await wal.append(createSyntheticEvidence({ ...claimed.job }));
    await wal.append({ ...createSyntheticEvidence(claimed.job), type: 'checkpoint', sequence: 2 });
    const restartedStore = await new FileDispatchStore({ filePath: dispatchPath, clock: () => 200 }).init();
    const restartedWal = await new AppendOnlyWal({ filePath: walPath }).init();
    const result = await reconcileIncompleteJobs({ store: restartedStore, wal: restartedWal, now: 200 });
    assert.equal(result.verifiedRecords, 2);
    assert.equal(result.reconciled[0].state, 'RECONCILE_ONLY');
    assert.equal((await restartedStore.snapshot()).jobs[job.jobId].job.state, 'RECONCILE_ONLY');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
