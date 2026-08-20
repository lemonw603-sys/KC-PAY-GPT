import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { syncCardCatalog } from '../src/services/card-catalog-sync-service.js';
import { createCardIntakeService } from '../src/services/card-intake-service.js';
import { createCardIntakeRepository } from '../src/db/repositories/card-intake-repository.js';

if (process.env.PROVIDER_WRITES_ENABLED === 'true' || process.env.PROVIDER_CARD_WRITES_ENABLED === 'true') {
  throw new Error('Card catalog sync refuses to run with provider writes enabled');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const provider = new HnskjCardProvider({
  baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
  apiKey: String(process.env.HNSKJ_API_KEY || '')
});
const [[settings]] = await pool.query(
  `SELECT MAX(CASE WHEN setting_key = 'default_card_type_id' THEN setting_value END) AS card_type_id,
          MAX(CASE WHEN setting_key = 'default_minimum_required_card_balance' THEN setting_value END) AS minimum_balance
   FROM app_settings`
);
const intake = createCardIntakeService({
  provider,
  repository: createCardIntakeRepository({ pool }),
  providerAccountId: '00000000-0000-4000-8000-000000000101',
  sessionEncryptionKey: config.sessionEncryptionKey,
  assumeDedicatedAccount: true,
  validationRules: {
    allowedCardTypeIds: [String(settings.card_type_id || '')],
    minimumBalance: String(settings.minimum_balance || '')
  }
});

try {
  console.log(JSON.stringify(await syncCardCatalog({ pool, provider, intake })));
} finally {
  await pool.end();
}
