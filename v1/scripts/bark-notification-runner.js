import { loadBarkNotificationConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';
import { createBarkClient } from '../src/notifications/bark-client.js';
import { dispatchOneBarkNotification } from '../src/notifications/bark-dispatcher.js';

const config = loadBarkNotificationConfig();
if (!config.enabled) {
  console.log('Bark notifications are disabled');
  process.exit(0);
}

const pool = createDatabasePool(config.database);
const repository = createAlertNotificationRepository(pool);
const client = createBarkClient({
  serverUrl: config.serverUrl,
  deviceKey: config.deviceKey,
  group: config.group,
  timeoutMs: config.requestTimeoutMs
});
const abortController = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => abortController.abort());
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('Bark notification runner started');
try {
  while (!abortController.signal.aborted) {
    const result = await dispatchOneBarkNotification({
      repository,
      client,
      maxAttempts: config.maxAttempts
    });
    if (!result.handled) await delay(config.pollIntervalMs);
  }
} catch (error) {
  console.error('Bark notification runner failed', {
    name: error?.name || 'Error',
    code: error?.code || 'BARK_RUNNER_FAILED'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
  console.log('Bark notification runner stopped');
}
