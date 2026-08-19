import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { syncCardCatalog } from '../src/services/card-catalog-sync-service.js';
import { createCardStockService } from '../src/services/card-stock-service.js';

if (process.env.PROVIDER_WRITES_ENABLED === 'true' || process.env.PROVIDER_CARD_WRITES_ENABLED === 'true') {
  throw new Error('Card catalog sync refuses to run with provider writes enabled');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const provider = new HnskjCardProvider({
  baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
  apiKey: String(process.env.HNSKJ_API_KEY || '')
});
const stock = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey });

try {
  console.log(JSON.stringify(await syncCardCatalog({ pool, provider, stock })));
} finally {
  await pool.end();
}
