import os from 'node:os';
import { loadWorkerConfig } from './config.js';
import { createDatabasePool } from './db/pool.js';
import { createWorkflowRepository } from './db/repositories/workflow-repository.js';
import { ZzshuRechargeProvider } from './providers/index.js';
import { recordProviderCall } from './providers/provider-call-recorder.js';
import { createWorkflowHandlers } from './workers/workflow-handlers.js';
import { runWorkerLoop } from './workers/worker-runtime.js';

const config = loadWorkerConfig();
const pool = createDatabasePool(config.database);
const workerId = config.workerId || `${os.hostname()}-${process.pid}`;
const abortController = new AbortController();

function unavailable(operation) {
  return () => {
    throw new Error(`${operation} is disabled until its provider contract is verified`);
  };
}

const cardProvider = {
  purchaseCard: unavailable('card purchase'),
  card: unavailable('card details')
};
const rechargeProvider = config.providerReadsEnabled
  ? new ZzshuRechargeProvider({
      baseUrl: config.zzshuApiBaseUrl,
      apiKey: config.zzshuApiKey
    })
  : {
      createDirectOrder: unavailable('recharge creation'),
      queryStatus: unavailable('recharge status query')
    };
const workflow = createWorkflowRepository(pool, {
  sessionEncryptionKey: config.sessionEncryptionKey
});
const handlers = createWorkflowHandlers({
  workflow,
  cardProvider,
  rechargeProvider,
  recordCall: (input) => recordProviderCall({ pool, ...input }),
  mapPurchasedCard: unavailable('card purchase response mapping'),
  mapCardCredentials: unavailable('card credentials mapping')
});

function requestShutdown(signal) {
  if (abortController.signal.aborted) return;
  console.log(`received ${signal}, stopping worker`);
  abortController.abort();
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

console.log(`pojia-v1 worker ${workerId} started`);
await runWorkerLoop({
  pool,
  workerId,
  handlers,
  leaseSeconds: config.workerLeaseSeconds,
  idleDelayMs: config.workerPollIntervalMs,
  providerReadsEnabled: config.providerReadsEnabled,
  providerWritesEnabled: config.providerWritesEnabled,
  signal: abortController.signal,
  onError: (error) => {
    console.error('worker iteration failed', {
      name: error?.name || 'Error',
      code: error?.code || error?.kind || 'WORKER_ITERATION_FAILED'
    });
  }
});
await pool.end();
console.log(`pojia-v1 worker ${workerId} stopped`);
