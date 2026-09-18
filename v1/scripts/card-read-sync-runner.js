import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { syncHnskjCardReadOnly } from '../src/services/card-on-demand-sync-service.js';
import { createCardStockService } from '../src/services/card-stock-service.js';
import {
  claimCardSyncJob,
  completeCardSyncJob,
  failCardSyncJob,
  scheduleDueCardSyncJobs
} from '../src/services/card-sync-job-service.js';
import { CARD_ADAPTER_HNSKJ, resolveCardProviderAccountIdForAdapter } from '../src/services/provider-route-service.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)
  || isEnvTrue(process.env.PROVIDER_RECHARGE_WRITES_ENABLED)) {
  throw new Error('Card read sync runner refuses to start with provider writes enabled');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const currentCardProviderAccountId = await resolveCardProviderAccountIdForAdapter(pool, CARD_ADAPTER_HNSKJ);
if (!currentCardProviderAccountId) throw new Error('No healthy card provider account is served by the hnskj adapter');
const workerId = `card-read-sync-${os.hostname()}-${process.pid}`;
const provider = new HnskjCardProvider({
  baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
  apiKey: String(process.env.HNSKJ_API_KEY || '')
});
const stock = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey,
  panHmacKey: config.cardIntakePanHmacKey, providerAccountId: currentCardProviderAccountId });

const maxConcurrency = Math.min(6, Math.max(1, Number(process.env.CARD_SYNC_CONCURRENCY || 4)));

async function processJob(job, scheduled) {
  const owner = job.leaseWorkerId;
  // Maintenance retries deliberately preserve the card's failure budget, so
  // the numeric attempt may be reused. Bind read-call audit keys to the unique
  // claim owner as well, preventing a retry from colliding with an earlier
  // provider_calls row while keeping every external read auditable.
  const claimKey = `${job.id}:${owner}`;
  try {
    // 同步一张卡的实现与分卡时的「当场同步」共用（card-on-demand-sync-service）。
    const { transactionCount: count } = await syncHnskjCardReadOnly({
      pool, provider, stock,
      card: { id: job.card_id, providerCardId: job.provider_card_id, cardTypeId: job.card_type_id,
        fundedAmount: job.funded_amount, minimumRequiredBalance: job.minimum_required_card_balance },
      orderId: job.order_id || null, requestKeyPrefix: `card-read-sync:${claimKey}`, attemptNo: job.attempts
    });
    const transactions = { length: count };
    await completeCardSyncJob(pool, { jobId: job.id, workerId: owner });
    console.log(JSON.stringify({ handled: true, jobId: job.id, providerCardId: job.provider_card_id,
      transactionCount: transactions.length, scheduled: scheduled.queued, status: 'COMPLETED' }));
    return true;
  } catch (error) {
    const failed = await failCardSyncJob(pool, { job, workerId: owner, error });
    console.error(JSON.stringify({ handled: true, jobId: job.id,
      status: failed.status === 'PENDING' ? 'RETRY_PENDING' : 'REVIEW_REQUIRED',
      retryAfterSeconds: failed.status === 'PENDING' ? failed.retryDelaySeconds : null,
      code: error?.code || error?.kind || 'CARD_SYNC_FAILED' }));
    return false;
  }
}

try {
  const scheduled = await scheduleDueCardSyncJobs(pool);
  const jobs = [];
  for (let index = 0; index < maxConcurrency; index += 1) {
    const job = await claimCardSyncJob(pool, { workerId: `${workerId}-${index}` });
    if (!job) break;
    // The claim lease owner is unique per slot and is passed through processing.
    jobs.push({ ...job, leaseWorkerId: `${workerId}-${index}` });
  }
  if (!jobs.length) {
    console.log(JSON.stringify({ handled: false, scheduled: scheduled.queued }));
  } else {
    const results = await Promise.all(jobs.map((job) => processJob(job, scheduled)));
    if (results.some((result) => !result)) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
