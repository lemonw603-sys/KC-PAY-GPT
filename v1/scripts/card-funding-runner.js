import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { createCardFundingRepository } from '../src/db/repositories/card-funding-repository.js';
import { createCardFundingScheduler } from '../src/services/card-funding-scheduler.js';
import { executeCardFundingAttempt } from '../src/services/card-funding-executor.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED) || !isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)) {
  throw new Error('Card funding runner requires only PROVIDER_CARD_WRITES_ENABLED=true');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const providerAccountId = '00000000-0000-4000-8000-000000000101';
const provider = new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey });
const repository = createCardFundingRepository(pool);
const scheduler = createCardFundingScheduler({ pool, fundingRepository: repository });

try {
  const scheduled = await scheduler.scheduleLowBalance({ limit: 10 });
  const attempt = await repository.nextPrepared({ providerAccountId });
  if (!attempt) {
    console.log(JSON.stringify({ handled: false, scheduled }));
  } else {
    const result = await executeCardFundingAttempt({
      repository, provider, attemptId: attempt.id, providerAccountId,
      requestKey: attempt.idempotency_key
    });
    console.log(JSON.stringify({ handled: true, scheduled, result, worker: os.hostname() }));
  }
} finally {
  await pool.end();
}
