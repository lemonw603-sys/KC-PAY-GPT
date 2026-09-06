import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProductionLiveArgs, withPoolLifecycle } from '../src/production-live-worker.js';

test('production LIVE entrypoint requires one explicit safe mode', () => {
  assert.deepEqual(parseProductionLiveArgs(['--check']), { checkOnly: true });
  assert.deepEqual(parseProductionLiveArgs(['--once']), { checkOnly: false });
  assert.throws(() => parseProductionLiveArgs([]));
  assert.throws(() => parseProductionLiveArgs(['--check', '--once']));
  assert.throws(() => parseProductionLiveArgs(['--loop']));
});

test('production LIVE pool stays open until the worker operation settles', async () => {
  const calls = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const pool = { async end() { calls.push('pool-end'); } };
  const running = withPoolLifecycle(pool, async () => {
    calls.push('worker-start');
    await pending;
    calls.push('worker-finish');
    return { status: 'DONE' };
  });
  await Promise.resolve();
  assert.deepEqual(calls, ['worker-start']);
  release();
  assert.deepEqual(await running, { status: 'DONE' });
  assert.deepEqual(calls, ['worker-start', 'worker-finish', 'pool-end']);
});
