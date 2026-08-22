import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserWorkerProcess } from '../src/services/browser-worker-process.js';

function service() {
  return {
    claim: async () => null,
    runClaimedJob: async () => { throw new Error('not called'); }
  };
}

test('Browser worker process requires an explicit LOCAL_MOCK runtime manifest', () => {
  assert.throws(
    () => createBrowserWorkerProcess({ workerService: service(), workerId: 'worker-1', runtime: { mode: 'REAL' }, executeJob: async () => {} }),
    (error) => error.code === 'RUNTIME_MANIFEST_REQUIRED'
  );
  assert.throws(
    () => createBrowserWorkerProcess({ workerService: service(), workerId: 'worker-1', runtimeMode: 'REAL', runtime: { mode: 'REAL' }, executeJob: async () => {} }),
    (error) => error.code === 'REAL_RUNTIME_NOT_APPROVED'
  );
});

test('Browser worker process runs only the local mock loop', async () => {
  const process = createBrowserWorkerProcess({
    workerService: service(),
    workerId: 'worker-1',
    runtime: { mode: 'LOCAL_MOCK', manifestSha256: 'local-test' },
    executeJob: async () => 'noop'
  });
  const results = await process.run({ iterations: 2 });
  assert.deepEqual(results.map((result) => result.status), ['IDLE', 'IDLE']);
});

test('Browser worker process stop makes subsequent runs a no-op', async () => {
  const process = createBrowserWorkerProcess({
    workerService: service(), workerId: 'worker-1',
    runtime: { mode: 'LOCAL_MOCK', manifestSha256: 'local-test' },
    executeJob: async () => 'noop'
  });
  process.stop();
  assert.deepEqual(await process.run({ iterations: 2 }), []);
});
