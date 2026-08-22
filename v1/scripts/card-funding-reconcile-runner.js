import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider, mapCardProvisioning } from '../src/providers/index.js';
import { createCardFundingRepository } from '../src/db/repositories/card-funding-repository.js';
import { commitCardTransactionsForCard } from '../src/db/repositories/card-transaction-repository.js';

const config = loadConfig();
const pool = createDatabasePool(config.database);
const providerAccountId = '00000000-0000-4000-8000-000000000101';
const provider = new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey });
const repository = createCardFundingRepository(pool);

try {
  const attempt = await repository.nextPending({ providerAccountId });
  if (!attempt) {
    console.log(JSON.stringify({ handled: false, worker: os.hostname() }));
  } else {
    const [cardEnvelope, transactionEnvelope] = await Promise.all([
      provider.card(attempt.provider_card_id),
      provider.transactions(attempt.provider_card_id)
    ]);
    const [[minimumRow]] = await pool.query(
      `SELECT setting_value FROM app_settings
       WHERE setting_key='default_minimum_required_card_balance' LIMIT 1`
    );
    const snapshot = mapCardProvisioning(cardEnvelope, minimumRow?.setting_value);
    if (snapshot.currentBalance == null) throw new Error('Provider card balance is missing during reconciliation');
    await commitCardTransactionsForCard(pool, {
      cardId: attempt.card_id,
      transactions: transactionEnvelope?.data?.transactions || [],
      cardSnapshot: { currentBalance: snapshot.currentBalance, currency: snapshot.currency }
    });
    const result = await repository.reconcile({ attemptId: attempt.id,
      currentBalance: snapshot.currentBalance, currency: snapshot.currency,
      responseSummary: { transactionCount: transactionEnvelope?.data?.transactions?.length || 0 } });
    console.log(JSON.stringify({ handled: true, result, worker: os.hostname() }));
  }
} finally {
  await pool.end();
}
