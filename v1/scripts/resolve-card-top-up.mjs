// D-411：人工了结一笔「补钱结果不明」（告警 CARD_TOP_UP_UNRESOLVED，dedupe card-top-up:<补钱 id>）。
//
//   node scripts/resolve-card-top-up.mjs --top-up <id>                          # dry-run：读卡台实时余额，打印判断，不写
//   node scripts/resolve-card-top-up.mjs --top-up <id> --arrived --apply        # 到账了：了结为 CONFIRMED（注资 +补钱额）
//   node scripts/resolve-card-top-up.mjs --top-up <id> --not-arrived --apply    # 钱没到卡上：了结为 REJECTED，卡解锁
//   Needs DATABASE_URL, SESSION_ENCRYPTION_KEY_BASE64（生产主机 source /etc/pojia/runtime.env）。
//
// 什么时候用：自动核对（CHECK_TOP_UP）判不清、推了「补钱结果不明」之后，人在卡台看过这张卡的余额和账户流水。
// 客户那一单早已换卡走了（补钱结果不明时订单不陪这张卡等），这里只了结这张卡。
//
// 硬校验（不靠人手敲余额，核实要留痕，D-234）：
//   ① 补钱行存在，且还没了结（SUBMITTED / UNKNOWN）；
//   ② 实时读卡台卡详情：尾号与库里一致；
//   ③ --arrived 要求实时余额 ≥ 补前余额 + 补钱额（差 1 分以内算到）；--not-arrived 要求实时余额 < 这个数。
//      读到的余额与判断不符就拒绝，不写库——人看到的和卡台说的不一致时先查清楚。
import mysql from 'mysql2/promise';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { loadTopUp } from '../src/db/repositories/card-top-up-repository.js';
import { createHighvccCardProvider } from '../src/providers/highvcc-card.js';
import { createHighvccAccessTokenReader } from '../src/services/highvcc-card-service.js';
import { toCents, fromCents } from '../src/domain/card-issue-fee.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const arrived = args.includes('--arrived');
const notArrived = args.includes('--not-arrived');
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] || '').trim() : ''; };
const topUpId = value('--top-up');
const actorId = value('--actor') || 'operator';
for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY_BASE64']) {
  if (!process.env[name]) { console.error(`${name} is required`); process.exit(2); }
}
if (!topUpId || (arrived && notArrived) || (apply && !arrived && !notArrived)) {
  console.error('usage: --top-up <id> [--arrived | --not-arrived] [--apply] [--actor <name>]');
  process.exit(2);
}

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const encryptionKey = Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64');
  const topUp = await loadTopUp(pool, topUpId);
  if (!topUp) throw new Error(`card top-up not found: ${topUpId}`);
  const provider = createHighvccCardProvider({ getAccessToken: createHighvccAccessTokenReader({ pool, encryptionKey }) });
  const detail = await provider.detail(String(topUp.provider_card_id || topUp.external_card_id || ''));
  const liveCents = Number(detail?.card?.balance);
  const liveLast4 = String(detail?.card?.lastFour || '');
  const amountCents = toCents(String(topUp.amount));
  const beforeCents = topUp.balance_before == null ? null : toCents(String(topUp.balance_before));
  const targetCents = beforeCents == null ? amountCents : beforeCents + amountCents;
  const liveArrived = Number.isInteger(liveCents) && liveCents >= targetCents - 1;
  const checks = {
    stillOpen: ['SUBMITTED', 'UNKNOWN'].includes(topUp.status),
    last4Matches: Boolean(liveLast4) && liveLast4 === String(topUp.last4 || ''),
    balanceReadable: Number.isInteger(liveCents),
  };
  if (arrived) checks.liveBalanceShowsArrived = liveArrived;
  if (notArrived) checks.liveBalanceShowsNotArrived = Number.isInteger(liveCents) && !liveArrived;
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    topUp: { id: topUp.id, status: topUp.status, errorCode: topUp.error_code, last4: topUp.last4,
      amount: String(topUp.amount), balanceBefore: topUp.balance_before == null ? null : String(topUp.balance_before),
      orderDetached: Boolean(Number(topUp.order_detached)), submittedAt: topUp.submitted_at, sendingAt: topUp.sending_at },
    live: { last4: liveLast4 || null, balance: Number.isInteger(liveCents) ? fromCents(liveCents) : null,
      arrivalTarget: fromCents(targetCents), looksArrived: liveArrived },
    checks,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) { console.log(JSON.stringify({ ...summary, refused: failed }, null, 2)); process.exitCode = 1; }
  else if (!apply) console.log(JSON.stringify(summary, null, 2));
  else {
    const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: encryptionKey });
    const resolvedBy = `operator:${actorId}`;
    const result = arrived
      ? await workflow.confirmTopUp(topUp.id, { observedBalance: fromCents(liveCents), resolvedBy })
      : await workflow.rejectTopUp(topUp.id, { code: 'OPERATOR_NOT_ARRIVED', allowedFrom: ['SUBMITTED', 'UNKNOWN'], resolvedBy,
        message: `operator checked the platform; live balance ${fromCents(liveCents)} < ${fromCents(targetCents)}` });
    const after = await loadTopUp(pool, topUp.id);
    console.log(JSON.stringify({ ...summary, result, statusAfter: after?.status }, null, 2));
  }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
