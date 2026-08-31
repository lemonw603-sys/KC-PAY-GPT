import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { createCardFundingRepository } from '../src/db/repositories/card-funding-repository.js';
import { executeCardFundingAttempt } from '../src/services/card-funding-executor.js';
import { resolveCurrentCardProviderAccountId } from '../src/services/provider-route-service.js';

if (!isEnvTrue(process.env.CARD_FUNDING_EXECUTION_ENABLED)) {
  throw new Error('Card funding runner is disabled by CARD_FUNDING_EXECUTION_ENABLED');
}
if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_RECHARGE_WRITES_ENABLED)
  || !isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)) {
  throw new Error('Card funding runner requires only PROVIDER_CARD_WRITES_ENABLED=true');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const providerAccountId = await resolveCurrentCardProviderAccountId(pool);
if (!providerAccountId) throw new Error('No active production card provider route');
const provider = new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey });
const repository = createCardFundingRepository(pool);

try {
  const [[setting]] = await pool.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key='card_balance_recharge_enabled' LIMIT 1`
  );
  if (setting?.setting_value !== 'true') {
    console.log(JSON.stringify({ handled: false, reason: 'CARD_BALANCE_RECHARGE_DISABLED' }));
  } else {
    const attempt = await repository.nextPrepared({ providerAccountId });
    if (!attempt) {
      console.log(JSON.stringify({ handled: false }));
    } else {
      const result = await executeCardFundingAttempt({
        repository, provider, attemptId: attempt.id, providerAccountId,
        requestKey: attempt.idempotency_key
      });
      console.log(JSON.stringify({ handled: true, result, worker: os.hostname() }));
    }
  }
} finally {
  await pool.end();
}
