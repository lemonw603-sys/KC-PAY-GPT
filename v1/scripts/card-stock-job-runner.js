import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { createCardStockService } from '../src/services/card-stock-service.js';
import {
  claimCardStockJob,
  completeCardStockJob,
  failCardStockJob,
  updateCardStockJobProgress
} from '../src/services/card-stock-job-service.js';
import { openStockCards } from './card-stock.js';

if (process.env.PROVIDER_WRITES_ENABLED === 'true' || process.env.PROVIDER_CARD_WRITES_ENABLED !== 'true') {
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

try {
  const job = await claimCardStockJob(pool, { workerId });
  if (!job) {
    console.log(JSON.stringify({ handled: false }));
  } else {
    try {
      const remaining = job.requestedCount - job.openedCount;
      const result = await openStockCards({
        provider,
        stock,
        count: remaining,
        amount: Number(job.amount),
        cardTypeId: job.cardTypeId,
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
