// 供卡执行器：每分钟由 pojia-card-stock-runner.timer 跑一次（D-247 面二③「三条开卡线合一」）。
//   ① 调度：按台 × 产品看水位/等卡单，缺口 → 建一张卡的 job（card-supply-scheduler-service）。
//   ② 执行：领一个 job，按 job 所属卡台的 open_adapter 选适配器开一张（hnskj / highvcc 同一条路）。
//   ③ 没 job 时：hnskj 的 PROVISIONING 卡补同步。
// 人工 job（后台按钮）与自动 job 同一张表、同一个执行者，不再 ssh 手跑。
// 开卡真实成本 = 开卡前后钱包余额之差 − 开进卡里的金额（D-255 T2），两台通用。
import os from 'node:os';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import {
  claimCardStockJob,
  completeCardStockJob,
  failCardStockJob,
  updateCardStockJobProgress
} from '../src/services/card-stock-job-service.js';
import { createCardOpenAdapters } from '../src/services/card-open-adapters.js';
import {
  ALERT_TYPES, clearSupplyFault, createCardSupplyScheduler, markSupplyFault,
  resolveSupplyAlert, supplyBlockedAlertKey, takeoverWaitingOrders, upsertSupplyAlert
} from '../src/services/card-supply-scheduler-service.js';
import { listCardProviderAccounts } from '../src/services/provider-route-service.js';
import { recordIssueFee } from '../src/services/card-issue-fee-service.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED) || !isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)) {
  throw new Error('Card stock runner requires only PROVIDER_CARD_WRITES_ENABLED=true');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const workerId = `card-stock-${os.hostname()}-${process.pid}`;
const adapters = createCardOpenAdapters({ pool, config });
const scheduler = createCardSupplyScheduler({ pool, adapters });

/** 卡台侧的失败（不是我们自己的预检）→ 标该台故障，让调度器下一分钟转另一台；并推手机。 */
const PROVIDER_FAULT_KINDS = new Set(['PROVIDER', 'TIMEOUT', 'TRANSPORT', 'MAINTENANCE', 'SCHEMA']);
function isProviderFault(error) {
  const code = String(error?.code || error?.kind || '').toUpperCase();
  return PROVIDER_FAULT_KINDS.has(code) || code.startsWith('HIGHVCC_') || code === 'CARD_STOCK_PURCHASE_DISABLED'
    || code === 'CARD_STOCK_PROVISIONING_TIMEOUT' || code === 'CARD_STOCK_CARD_FAILED';
}

async function executeJob(job) {
  const accounts = await listCardProviderAccounts(pool);
  const account = accounts.find((row) => row.id === job.providerAccountId);
  if (!account) throw Object.assign(new Error(`job ${job.id} names an unknown card provider account`), { code: 'CARD_PROVIDER_ROUTE_UNAVAILABLE' });
  const adapter = adapters.for(account.openAdapter);
  if (!adapter) throw Object.assign(new Error(`no open adapter for ${account.displayName}`), { code: 'CARD_PROVIDER_ROUTE_UNAVAILABLE' });
  const remaining = job.requestedCount - job.openedCount;
  const issueFees = [];
  let opened = 0;
  for (let index = 0; index < remaining; index += 1) {
    const before = await adapter.readWallet(account);
    if (before.purchaseEnabled === false) {
      throw Object.assign(new Error('card provider currently forbids opening cards'), { code: 'CARD_STOCK_PURCHASE_DISABLED' });
    }
    const segment = job.cardTypeId;
    // hnskj 自己的规则预检（卡段/金额范围/在线上限/账户余额）用刚读的快照；highvcc 没有这层。
    await adapter.preflight(account, { segment, amount: job.amount, wallet: before });
    const result = await adapter.openOne(account, { segment, amount: job.amount, jobId: job.id });
    opened += 1;
    await updateCardStockJobProgress(pool, { jobId: job.id, workerId, openedCount: job.openedCount + opened });
    // 这一段绝不能让 job 失败：卡已经开出来、钱已经花了。最坏只是「这张卡的成本没算出来」。
    try {
      const after = await adapter.readWallet(account);
      issueFees.push(await recordIssueFee(pool, {
        providerAccountId: account.id,
        providerCardId: result.providerCardId,
        balanceBefore: before.availableBalance,
        balanceAfter: after.availableBalance,
        openCardAmount: job.amount,
        currency: after.currency || 'USD'
      }));
    } catch (error) {
      issueFees.push({ providerCardId: result.providerCardId, recorded: false, reason: error?.code || 'ISSUE_FEE_STEP_FAILED' });
    }
  }
  // 转台开出的卡要给等它的单用：把还没分配的等待单从故障台改冻到这台（D-252 打架 2）。
  let takenOver = 0;
  if (job.fallbackForProviderAccountId && job.productCode) {
    const [[product]] = await pool.query(
      `SELECT id FROM products WHERE legacy_plan_type = ? OR product_code = ? LIMIT 1`, [job.productCode, job.productCode]
    );
    if (product?.id) {
      takenOver = await takeoverWaitingOrders(pool, {
        productId: product.id, fromProviderAccountId: job.fallbackForProviderAccountId, toProviderAccountId: account.id
      });
    }
  }
  await completeCardStockJob(pool, { jobId: job.id, workerId, openedCount: job.openedCount + opened });
  await clearSupplyFault(pool, { providerAccountId: account.id });
  await resolveSupplyAlert(pool, `card-supply-open-failed:${account.id}`);
  // 真开出了卡，「缺卡但开不出来」才算结束（D-363）；转台开的记在缺卡那台名下。
  if (opened > 0 && job.productCode) {
    await resolveSupplyAlert(pool, supplyBlockedAlertKey(job.fallbackForProviderAccountId || account.id, job.productCode));
  }
  return { opened, issueFees, takenOver, account: account.displayName };
}

try {
  const schedule = await scheduler.run();
  const job = await claimCardStockJob(pool, { workerId });
  if (!job) {
    const idle = {};
    for (const account of await listCardProviderAccounts(pool)) {
      const adapter = account.openAdapter ? adapters.for(account.openAdapter) : null;
      if (adapter?.idle) idle[account.displayName] = await adapter.idle(account).catch((error) => ({ failed: error?.code || 'IDLE_FAILED' }));
    }
    console.log(JSON.stringify({ handled: false, schedule: { reason: schedule.reason, decisions: schedule.decisions, scheduled: schedule.scheduled }, idle }));
  } else {
    try {
      const result = await executeJob(job);
      console.log(JSON.stringify({ handled: true, jobId: job.id, source: job.source, providerAccountId: job.providerAccountId,
        productCode: job.productCode, status: 'COMPLETED', ...result, schedule: { reason: schedule.reason } }));
    } catch (error) {
      const failure = await failCardStockJob(pool, { jobId: job.id, workerId, error });
      if (isProviderFault(error)) {
        await markSupplyFault(pool, { providerAccountId: job.providerAccountId, reason: failure.code });
      }
      // 开卡失败必推手机（D-249 面四①「供给」类）；预检类失败（没花钱）也推，但只推一次（dedupe 按台）。
      await upsertSupplyAlert(pool, {
        type: ALERT_TYPES.OPEN_FAILED, key: `card-supply-open-failed:${job.providerAccountId}`,
        severity: failure.status === 'REVIEW_REQUIRED' ? 'critical' : 'warning',
        title: failure.status === 'REVIEW_REQUIRED' ? '开卡失败，需要人核对' : '开卡未成功',
        message: `job ${job.id}（${job.source}，${job.productCode || '?'}）在卡台 ${job.providerAccountId} 失败：${failure.code}。${failure.status === 'REVIEW_REQUIRED' ? '可能已扣款，人工核对前不会再自动开。' : '没有扣款，条件恢复后会再试。'}`
      });
      console.error(JSON.stringify({ handled: true, jobId: job.id, status: failure.status, code: failure.code }));
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
