import { createApp } from './app/create-app.js';
import { loadConfig } from './config.js';
import { checkDatabaseReady, createDatabasePool } from './db/pool.js';
import { createOrderIntakeService } from './services/order-intake-service.js';
import { createOrderStatusService } from './services/order-status-service.js';
import { createAdminReadService } from './services/admin-read-service.js';
import { createAdminCdkService, revokeCdkBatch } from './services/cdk-service.js';
import { createAdminSessionAuth } from './security/admin-session.js';
import { createCardStockService } from './services/card-stock-service.js';
import { createCardStockJobService } from './services/card-stock-job-service.js';

const config = loadConfig();
const pool = createDatabasePool(config.database);
const createCustomerOrder = createOrderIntakeService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey
});
const getCustomerOrderStatus = createOrderStatusService({ pool });
const adminReadService = createAdminReadService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey
});
const cardStockService = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey });
const cardStockJobService = createCardStockJobService({ pool });
const createAdminCdkBatch = createAdminCdkService({ pool });
const adminAuth = config.adminPasswordHash
  ? createAdminSessionAuth({
    passwordHash: config.adminPasswordHash,
    sessionSecret: config.adminSessionSecret,
    secureCookies: config.nodeEnv === 'production'
  })
  : null;
const app = createApp({
  readiness: () => checkDatabaseReady(pool),
  createCustomerOrder,
  getCustomerOrderStatus,
  adminAuth,
  getAdminOverview: adminReadService.getOverview,
  listAdminOrders: adminReadService.listOrders,
  getAdminOrder: adminReadService.getOrder,
  listAdminAlerts: adminReadService.listAlerts,
  requestCardTransactionSync: adminReadService.requestCardTransactionSync
  ,getAdminCardStock: async () => ({
    ...await cardStockService.status(),
    ...await cardStockJobService.listJobs({ limit: 20 })
  })
  ,setAdminCardStockThreshold: (value) => cardStockService.setThreshold(value)
  ,createAdminCardStockJob: cardStockJobService.createJob
  ,createAdminCdkBatch
  ,revokeAdminCdkBatch: (batchNo, reason) => revokeCdkBatch(pool, batchNo, reason)
});

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`pojia-v1 listening on ${config.host}:${config.port}`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);

  server.close(async () => {
    await pool.end();
    process.exitCode = 0;
  });

  setTimeout(() => {
    process.exitCode = 1;
    server.closeAllConnections?.();
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
