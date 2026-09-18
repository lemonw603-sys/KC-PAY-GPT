// 人工核对完一个 REVIEW_REQUIRED 的开卡 job 之后结清它，并解除该台的停摆（第④步收尾发现，2026-09-18）。
//
//   node scripts/resolve-reviewed-stock-job.mjs --job <jobId> --card <externalCardId>            # dry-run：只校验并打印，不写
//   node scripts/resolve-reviewed-stock-job.mjs --job <jobId> --card <externalCardId> --apply    # 结清
//   Needs DATABASE_URL（生产主机 source /etc/pojia/runtime.env）。
//
// 用在「卡台已经开出卡、系统当时没入库、人已用 reconcile-highvcc-card.mjs 补记好」之后：
// 那个脚本只补卡，不认识 job / 故障态 / 告警，所以补完卡调度器仍每轮 FUNDS_REVIEW_REQUIRED。
//
// 硬校验（不靠解析错误文本，D-172 惯犯 3）：
//   ① job 存在且 status='REVIEW_REQUIRED'；
//   ② --card 指的卡确实在库里，且属于同一个卡台账户，且 created_at >= job.created_at
//      —— 这三条一起证明「这张卡就是这个 job 开出来的、现在已经入库」；
//   ③ 结清后该台没有别的未解决付费 job 才解除故障态与告警（否则只结清这一个）。
import mysql from 'mysql2/promise';
import { resolveReviewedCardStockJob, unresolvedPaidJobsSql } from '../src/services/card-stock-job-service.js';
import { clearSupplyFault, resolveSupplyAlert } from '../src/services/card-supply-scheduler-service.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] || '').trim() : ''; };
const jobId = value('--job');
const externalCardId = value('--card');
const actorId = value('--actor') || 'lemon-via-fable';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!jobId || !externalCardId) { console.error('usage: --job <jobId> --card <externalCardId> [--apply]'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const [[job]] = await pool.query(
    `SELECT id, status, job_source, provider_account_id, product_code, opened_count, error_code, error_message, created_at, finished_at
       FROM card_stock_jobs WHERE id = ?`, [jobId]);
  if (!job) throw new Error(`card stock job not found: ${jobId}`);
  const [[card]] = await pool.query(
    `SELECT id, last4, provider_account_id, inventory_status, current_balance, created_at
       FROM cards WHERE BINARY external_card_id = BINARY ?`, [externalCardId]);
  const checks = {
    jobIsReviewRequired: job.status === 'REVIEW_REQUIRED',
    cardIsInInventory: Boolean(card),
    cardBelongsToSameAccount: Boolean(card) && card.provider_account_id === job.provider_account_id,
    cardCreatedAfterJob: Boolean(card) && new Date(card.created_at).getTime() >= new Date(job.created_at).getTime(),
  };
  const [blockingBefore] = await pool.query(unresolvedPaidJobsSql());
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    job: { id: job.id, status: job.status, source: job.job_source, account: job.provider_account_id, product: job.product_code,
      openedCount: Number(job.opened_count || 0), errorCode: job.error_code, createdAt: job.created_at },
    card: card ? { last4: card.last4, inventoryStatus: card.inventory_status, balance: String(card.current_balance), createdAt: card.created_at } : null,
    checks,
    willSetOpenedCount: 1,
    blockingSchedulerBefore: blockingBefore.length,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) { console.log(JSON.stringify({ ...summary, refused: failed }, null, 2)); process.exitCode = 1; }
  else if (!apply) console.log(JSON.stringify(summary, null, 2));
  else {
    const resolved = await resolveReviewedCardStockJob(pool, { jobId, openedCount: 1, actorId,
      note: `card ${externalCardId} (last4 ${card.last4}) was opened on the platform and recorded by reconcile-highvcc-card.mjs; job closed manually` });
    const [blockingAfter] = await pool.query(unresolvedPaidJobsSql());
    let faultCleared = false;
    if (blockingAfter.length === 0) {
      await clearSupplyFault(pool, { providerAccountId: job.provider_account_id });
      await resolveSupplyAlert(pool, `card-supply-open-failed:${job.provider_account_id}`);
      faultCleared = true;
    }
    const [[account]] = await pool.query(
      `SELECT supply_fault_state, supply_fault_reason FROM provider_accounts WHERE id = ?`, [job.provider_account_id]);
    console.log(JSON.stringify({ ...summary, resolved, blockingSchedulerAfter: blockingAfter.length, faultCleared,
      accountFaultState: account?.supply_fault_state, accountFaultReason: account?.supply_fault_reason }, null, 2));
  }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
