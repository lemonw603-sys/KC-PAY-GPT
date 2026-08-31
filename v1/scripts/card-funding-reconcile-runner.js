import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { createCardFundingRepository } from '../src/db/repositories/card-funding-repository.js';
import { resolveCurrentCardProviderAccountId } from '../src/services/provider-route-service.js';
import { createCardStockService } from '../src/services/card-stock-service.js';
import { reconcileNextCardFundingAttempt } from '../src/services/card-funding-reconcile-service.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_RECHARGE_WRITES_ENABLED)) {
  throw new Error('Card funding reconciliation refuses to start with provider writes enabled');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const providerAccountId = await resolveCurrentCardProviderAccountId(pool);
if (!providerAccountId) throw new Error('No active production card provider route');
const provider = new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey });
const repository = createCardFundingRepository(pool);
const stock = createCardStockService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey,
  panHmacKey: config.cardIntakePanHmacKey,
  providerAccountId
});

try {
  const outcome = await reconcileNextCardFundingAttempt({
    pool, repository, provider, stock, providerAccountId
  });
  if (!outcome.handled) {
    console.log(JSON.stringify({ handled: false, worker: os.hostname() }));
  } else {
    console.log(JSON.stringify({ ...outcome, worker: os.hostname() }));
  }
} finally {
  await pool.end();
}
