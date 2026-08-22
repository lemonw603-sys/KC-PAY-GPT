import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { commitCardTransactionsForCard } from '../src/db/repositories/card-transaction-repository.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { recordProviderCall } from '../src/providers/provider-call-recorder.js';
import { createCardStockService, mapStockCard } from '../src/services/card-stock-service.js';
import { readAllCardTransactions } from '../src/services/card-transaction-reader.js';
import {
  claimCardSyncJob,
  completeCardSyncJob,
  failCardSyncJob,
  scheduleDueCardSyncJobs
} from '../src/services/card-sync-job-service.js';
import { resolveCurrentCardProviderAccountId } from '../src/services/provider-route-service.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_RECHARGE_WRITES_ENABLED)) {
  throw new Error('Card read sync runner refuses to start with provider writes enabled');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const currentCardProviderAccountId = await resolveCurrentCardProviderAccountId(pool);
if (!currentCardProviderAccountId) throw new Error('No active production card provider route');
const workerId = `card-read-sync-${os.hostname()}-${process.pid}`;
const provider = new HnskjCardProvider({
  baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
  apiKey: String(process.env.HNSKJ_API_KEY || '')
});
const stock = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey,
  panHmacKey: config.cardIntakePanHmacKey, providerAccountId: currentCardProviderAccountId });

try {
  const scheduled = await scheduleDueCardSyncJobs(pool);
  const job = await claimCardSyncJob(pool, { workerId });
  if (!job) {
    console.log(JSON.stringify({ handled: false, scheduled: scheduled.queued }));
  } else {
    try {
      const detail = await recordProviderCall({
        pool,
        orderId: job.order_id || null,
        provider: 'hnskj',
        operation: 'card_reconciliation_detail',
        requestKey: `card-read-sync:${job.id}:detail`,
        attemptNo: job.attempts,
        action: () => provider.card(job.provider_card_id),
        summarize: (value) => {
          const data = value?.data?.card ?? value?.data ?? {};
          return {
            providerCardId: job.provider_card_id,
            status: data.status || null,
            currentBalance: data.cardBalance ?? data.currentBalance ?? null,
            currency: data.currency || null
          };
        }
      });
      const mapped = mapStockCard(detail, {
        providerCardId: job.provider_card_id,
        cardTypeId: job.card_type_id,
        fundedAmount: job.funded_amount
      });
      await stock.register(mapped);
      const transactions = await readAllCardTransactions({
        fetchPage: (page, pageSize) => recordProviderCall({
          pool,
          orderId: job.order_id || null,
          provider: 'hnskj',
          operation: 'card_reconciliation_transactions',
          requestKey: `card-read-sync:${job.id}:transactions:${page}`,
          attemptNo: job.attempts,
          action: () => provider.transactions(job.provider_card_id, { page, pageSize }),
          summarize: (value) => ({
            providerCardId: job.provider_card_id,
            page: value.data.page,
            count: value.data.transactions.length,
            total: value.data.total,
            types: [...new Set(value.data.transactions.map((item) => item.type))],
            statuses: [...new Set(value.data.transactions.map((item) => item.status))]
          })
        })
      });
      await commitCardTransactionsForCard(pool, {
        cardId: job.card_id,
        orderId: job.order_id || null,
        transactions,
        cardSnapshot: mapped
      });
      await completeCardSyncJob(pool, { jobId: job.id, workerId });
      console.log(JSON.stringify({
        handled: true,
        jobId: job.id,
        providerCardId: job.provider_card_id,
        transactionCount: transactions.length,
        scheduled: scheduled.queued,
        status: 'COMPLETED'
      }));
    } catch (error) {
      await failCardSyncJob(pool, { job, workerId, error });
      console.error(JSON.stringify({
        handled: true,
        jobId: job.id,
        status: job.attempts < job.maxAttempts ? 'RETRY_PENDING' : 'REVIEW_REQUIRED',
        code: error?.code || error?.kind || 'CARD_SYNC_FAILED'
      }));
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
