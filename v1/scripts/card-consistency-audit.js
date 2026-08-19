import { loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { buildCardConsistencyReport } from '../src/diagnostics/card-consistency.js';
import { pathToFileURL } from 'node:url';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fetchAllProviderCards(provider, { pageSize = 50, maxPages = 100 } = {}) {
  const cards = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await provider.cards({ page, pageSize });
    const batch = response.data.cards;
    cards.push(...batch);
    if (batch.length === 0 || cards.length >= response.data.total) return cards;
  }
  throw new Error(`Hnskj card list exceeded ${maxPages} pages`);
}

export async function runCardConsistencyAudit({ pool, provider }) {
  const [localCards, providerCards] = await Promise.all([
    pool.query('SELECT provider_card_id, status FROM cards').then(([rows]) => rows),
    fetchAllProviderCards(provider)
  ]);
  return buildCardConsistencyReport({ providerCards, localCards });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.PROVIDER_WRITES_ENABLED === 'true') {
    throw new Error('Card consistency audit refuses to run while provider writes are enabled');
  }
  const pool = createDatabasePool(loadRuntimeDatabaseConfig());
  const provider = new HnskjCardProvider({
    baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
    apiKey: required('HNSKJ_API_KEY')
  });
  try {
    const report = await runCardConsistencyAudit({ pool, provider });
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      auditFailed: true,
      error: error?.name || 'Error',
      code: error?.code || error?.kind || 'CARD_CONSISTENCY_AUDIT_FAILED'
    }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
