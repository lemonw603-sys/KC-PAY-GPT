import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { createCardStockService } from '../src/services/card-stock-service.js';
import {
  createCardStockJobService,
  claimCardStockJob,
  completeCardStockJob,
  failCardStockJob,
  updateCardStockJobProgress
} from '../src/services/card-stock-job-service.js';
import {
  evaluateCardStockRequest,
  refreshProviderSnapshot
} from '../src/services/card-provider-snapshot-service.js';
import { createProviderBalanceSnapshotService } from '../src/services/provider-balance-snapshot-service.js';
import { scheduleAutomaticStockJob } from '../src/services/card-stock-runner-service.js';
import { openStockCards, syncProvisioningStock } from './card-stock.js';
import { resolveCurrentCardProviderAccountId } from '../src/services/provider-route-service.js';
import { recordIssueFee } from '../src/services/card-issue-fee-service.js';

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
const currentCardProviderAccountId = await resolveCurrentCardProviderAccountId(pool);
if (!currentCardProviderAccountId) throw new Error('No active production card provider route');
const stock = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey,
  panHmacKey: config.cardIntakePanHmacKey, providerAccountId: currentCardProviderAccountId });
const balanceSnapshots = createProviderBalanceSnapshotService({ pool });
const stockJobs = createCardStockJobService({ pool });
const refreshSnapshot = () => refreshProviderSnapshot(pool, provider, {
  balanceSnapshotService: balanceSnapshots,
  providerAccountId: currentCardProviderAccountId
});

try {
  const { automatic, providerRulesSynced } = await scheduleAutomaticStockJob({ stockJobs, refreshSnapshot });
  const job = await claimCardStockJob(pool, { workerId });
  if (!job) {
    const sync = await syncProvisioningStock({ pool, provider, stock });
    console.log(JSON.stringify({ handled: false, providerRulesSynced, automatic, stockSync: sync }));
  } else {
    try {
      const remaining = job.requestedCount - job.openedCount;
      const rules = typeof job.rulesSnapshot === 'string'
        ? JSON.parse(job.rulesSnapshot) : job.rulesSnapshot;
      let snapshot = await refreshSnapshot();
      evaluateCardStockRequest(snapshot, {
        cardTypeId: job.cardTypeId,
        amount: Number(job.amount),
        count: remaining,
        expectedCardTypeName: rules?.cardType?.name || null
      });
      // 开卡真实成本 = 开卡前后账户余额之差 − 开进卡里的金额（D-249 面四② T2）。
      // 开卡「前」那次读数本来就有：beforeCard 里的 refreshSnapshot() 会问卡台要余额
      // 并写进 provider_balance_snapshots。这里把它的结果留下来，开卡后再读一次即可。
      let balanceBeforeCard = null;
      const issueFees = [];
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
          balanceBeforeCard = live?.accountBalance ?? null;
        },
        onCardOpened: async ({ index, providerCardId }) => {
          await updateCardStockJobProgress(pool, {
            jobId: job.id,
            workerId,
            openedCount: job.openedCount + index
          });
          // 这一段绝不能让开卡 job 失败：卡已经开出来、钱已经花了，此时因为一次
          // 只读查询出错而把 job 标成失败，会让人以为卡没开出来。最坏情况只是
          // 「这张卡的成本没算出来」，如实记下来即可。
          try {
            const after = await refreshSnapshot();
            issueFees.push(await recordIssueFee(pool, {
              providerAccountId: currentCardProviderAccountId,
              providerCardId,
              balanceBefore: balanceBeforeCard,
              balanceAfter: after?.accountBalance ?? null,
              openCardAmount: Number(job.amount),
              currency: after?.currency || 'USD'
            }));
            balanceBeforeCard = after?.accountBalance ?? null;
          } catch (error) {
            issueFees.push({ providerCardId, recorded: false, reason: error?.code || 'ISSUE_FEE_STEP_FAILED' });
          }
        }
      });
      await completeCardStockJob(pool, {
        jobId: job.id,
        workerId,
        openedCount: job.openedCount + result.opened
      });
      console.log(JSON.stringify({ handled: true, jobId: job.id, source: job.source,
        status: 'COMPLETED', opened: result.opened, automatic, issueFees }));
    } catch (error) {
      const failure = await failCardStockJob(pool, { jobId: job.id, workerId, error });
      console.error(JSON.stringify({ handled: true, jobId: job.id,
        status: failure.status, code: failure.code }));
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
