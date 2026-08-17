import { createApp } from './app/create-app.js';
import { loadConfig } from './config.js';
import { checkDatabaseReady, createDatabasePool } from './db/pool.js';
import { createOrderIntakeService } from './services/order-intake-service.js';

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const createCustomerOrder = createOrderIntakeService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey
});
const app = createApp({
  readiness: () => checkDatabaseReady(pool),
  createCustomerOrder
});

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

const server = app.listen(config.port, () => {
  console.log(`pojia-v1 listening on port ${config.port}`);
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
