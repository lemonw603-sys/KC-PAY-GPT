import { createBrowserWorkerProcess } from '../src/services/browser-worker-process.js';

const workerProcess = createBrowserWorkerProcess({
  workerService: {
    claim: async () => null,
    runClaimedJob: async () => { throw new Error('unexpected claimed job'); }
  },
  workerId: process.env.BROWSER_TEST_WORKER_ID || 'browser-test-worker',
  runtime: { mode: 'LOCAL_MOCK', manifestSha256: 'local-child' },
  executeJob: async () => 'noop'
});

process.stdout.write('READY\n');

process.on('SIGTERM', () => {
  workerProcess.stop();
  process.stdout.write('STOPPED\n', () => process.exit(0));
});

if (process.env.BROWSER_TEST_CRASH === '1') {
  setTimeout(() => process.exit(42), 25);
}

setInterval(() => {}, 1000);
