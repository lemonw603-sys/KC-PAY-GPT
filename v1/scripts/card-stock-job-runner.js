import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { createCardStockService } from '../src/services/card-stock-service.js';
import {
  claimCardStockJob,
  completeCardStockJob,
  failCardStockJob,
  updateCardStockJobProgress
} from '../src/services/card-stock-job-service.js';
import {
  evaluateCardStockRequest,
  readProviderSnapshot,
  refreshProviderSnapshot,
  snapshotIsFresh
} from '../src/services/card-provider-snapshot-service.js';
import { createProviderBalanceSnapshotService } from '../src/services/provider-balance-snapshot-service.js';
import { openStockCards, syncProvisioningStock } from './card-stock.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED) || !isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)) {
  throw new Error('Card stock runner requires only PROVIDER_CARD_WRITES_ENABLED=true');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const workerId = `card-stock-${os.hostname()}-${process.pid}`;
const provider = new HnskjCardProvider({
  baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
  apiKey: String(process.env.HNSKJ_API_KEY || '')
});
const stock = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey });
const balanceSnapshots = createProviderBalanceSnapshotService({ pool });
const refreshSnapshot = () => refreshProviderSnapshot(pool, provider, {
  balanceSnapshotService: balanceSnapshots
});

try {
  let snapshot = await readProviderSnapshot(pool);
  if (!snapshotIsFresh(snapshot, { maxAgeMs: 60_000 })) {
    snapshot = await refreshSnapshot();
  }
  const job = await claimCardStockJob(pool, { workerId });
  if (!job) {
    const sync = await syncProvisioningStock({ pool, provider, stock });
    console.log(JSON.stringify({ handled: false, providerRulesSynced: true, stockSync: sync }));
  } else {
    try {
      const remaining = job.requestedCount - job.openedCount;
      const rules = typeof job.rulesSnapshot === 'string'
        ? JSON.parse(job.rulesSnapshot) : job.rulesSnapshot;
      snapshot = await refreshSnapshot();
      evaluateCardStockRequest(snapshot, {
        cardTypeId: job.cardTypeId,
        amount: Number(job.amount),
        count: remaining,
        expectedCardTypeName: rules?.cardType?.name || null
      });
      const result = await openStockCards({
        provider,
        stock,
        count: remaining,
        amount: Number(job.amount),
        cardTypeId: job.cardTypeId,
        beforeCard: async ({ remaining: cardsRemaining }) => {
          const live = await refreshSnapshot();
          evaluateCardStockRequest(live, {
            cardTypeId: job.cardTypeId,
            amount: Number(job.amount),
            count: cardsRemaining,
            expectedCardTypeName: rules?.cardType?.name || null
          });
        },
        onCardOpened: ({ index }) => updateCardStockJobProgress(pool, {
          jobId: job.id,
          workerId,
          openedCount: job.openedCount + index
        })
      });
      await completeCardStockJob(pool, {
        jobId: job.id,
        workerId,
        openedCount: job.openedCount + result.opened
      });
      console.log(JSON.stringify({ handled: true, jobId: job.id, status: 'COMPLETED', opened: result.opened }));
    } catch (error) {
      await failCardStockJob(pool, { jobId: job.id, workerId, error });
      console.error(JSON.stringify({ handled: true, jobId: job.id, status: 'REVIEW_REQUIRED', code: error?.code || error?.kind || 'FAILED' }));
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
