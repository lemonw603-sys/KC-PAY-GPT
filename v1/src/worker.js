import os from 'node:os';
import { loadWorkerConfig } from './config.js';
import { createDatabasePool } from './db/pool.js';
import { createWorkflowRepository } from './db/repositories/workflow-repository.js';
import { createRechargeAttemptRepository } from './db/repositories/recharge-attempt-repository.js';
import {
  HnskjCardProvider,
  ZzshuRechargeProvider,
  mapPurchasedCard,
  mapCardCredentials,
  mapCardProvisioning
} from './providers/index.js';
import { buildDirectOrderRequest } from './providers/zzshu-recharge.js';
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

const hnskjReadProvider = (config.providerReadsEnabled || config.providerCardWritesEnabled)
  ? new HnskjCardProvider({
      baseUrl: config.hnskjApiBaseUrl,
      apiKey: config.hnskjApiKey
    })
  : null;
const cardProvider = {
  cardTypes: hnskjReadProvider
    ? hnskjReadProvider.cardTypes.bind(hnskjReadProvider)
    : unavailable('card types'),
  cards: hnskjReadProvider
    ? hnskjReadProvider.cards.bind(hnskjReadProvider)
    : unavailable('cards list'),
  purchaseCard: config.providerCardWritesEnabled
    ? hnskjReadProvider?.purchaseCard.bind(hnskjReadProvider) || unavailable('card purchase provider')
    : unavailable('card purchase'),
  card: hnskjReadProvider
    ? hnskjReadProvider.card.bind(hnskjReadProvider)
    : unavailable('card details'),
  transactions: hnskjReadProvider
    ? hnskjReadProvider.transactions.bind(hnskjReadProvider)
    : unavailable('card transactions')
};
const rechargeProvider = (config.providerReadsEnabled || config.providerRechargeWritesEnabled)
  ? new ZzshuRechargeProvider({
      baseUrl: config.zzshuApiBaseUrl,
      apiKey: config.zzshuApiKey
    })
  : {
      createDirectOrder: unavailable('recharge creation'),
      queryStatus: unavailable('recharge status query'),
      queryStatusWithSession: unavailable('recharge status and Session query')
    };
const workflow = createWorkflowRepository(pool, {
  sessionEncryptionKey: config.sessionEncryptionKey,
  panHmacKey: config.cardIntakePanHmacKey
});
const rechargeAttemptRepository = createRechargeAttemptRepository(pool);
const handlers = createWorkflowHandlers({
  workflow,
  cardProvider,
  rechargeProvider,
  recordCall: (input) => recordProviderCall({ pool, ...input }),
  mapPurchasedCard,
  mapCardProvisioning,
  mapCardCredentials,
  buildDirectOrderRequest,
  rechargeAttemptRepository,
  rechargeWritesEnabled: config.providerRechargeWritesEnabled
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
  workerConcurrency: config.workerConcurrency,
  idleDelayMs: config.workerPollIntervalMs,
  providerReadsEnabled: config.providerReadsEnabled,
  providerWritesEnabled: config.providerWritesEnabled,
  providerCardWritesEnabled: config.providerCardWritesEnabled,
  providerRechargeWritesEnabled: config.providerRechargeWritesEnabled,
  heartbeat: () => pool.query(
    `UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE setting_key = 'worker_heartbeat_at'`,
    [new Date().toISOString()]
  ),
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
