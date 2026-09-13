#!/usr/bin/env node
// 一条命令完成「核实 + 退回 CDK」：拿客户手上的卡密，查这单到底扣没扣钱，确认没扣才退回。
//
//   node v1/scripts/verify-and-return-cdk.mjs <CDK码>            # 默认只核实、不动数据（dry-run）
//   node v1/scripts/verify-and-return-cdk.mjs <CDK码> --apply    # 确认没扣款后真的收口并退回
//   node v1/scripts/verify-and-return-cdk.mjs --order <查询码> [--apply]
//
// 为什么以 CDK 为入口：客户来找你时手上只有卡密，不会有订单查询码（2026-09-13 Lemon 定）。
// CDK 在库里是不可逆哈希，所以查订单复用后台搜索那一套（与 find-order-by-cdk.mjs 同源），
// 不自己拼哈希。
//
// 安全边界（每一条都会拦住 --apply）：
//   · 卡台查到一笔匹配扣款 → 拒绝（钱动了，退 CDK 会让客户重兑、造成重复扣款）
//   · 卡台查到多笔可疑     → 拒绝（歧义必须人看）
//   · 查不到是哪张卡       → 拒绝（「没查对」不等于「没扣钱」）
//   · 读卡台失败           → 拒绝（读不到不等于没有）
//   · 订单不在可收口状态   → 拒绝并说明当前状态
// 退回本身走后台同一个 RESOLVE_UNKNOWN_PAYMENT / NOT_CHARGED 路径，资金账本的硬闸门照旧生效；
// 本脚本不自己写 cdks 表。
//
// 需要 DATABASE_URL, SESSION_ENCRYPTION_KEY_BASE64, CDK_HASH_KEY_V1_BASE64,
// CARD_INTAKE_PAN_HMAC_KEY_BASE64（主机上 source /etc/pojia/runtime.env）。
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { createAdminReadService } from '../src/services/admin-read-service.js';
import { createBrowserAdminService } from '../src/services/browser-admin-service.js';
import { createHighvccAccessTokenReader } from '../src/services/highvcc-card-service.js';
import { createHighvccCardProvider } from '../src/providers/highvcc-card.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const orderFlag = args.indexOf('--order');
const explicitOrder = orderFlag >= 0 ? args[orderFlag + 1] : null;
const cdkCode = explicitOrder ? null : args.find((a) => !a.startsWith('--'));
const windowMin = (() => { const i = args.indexOf('--window-min'); return i >= 0 ? Number(args[i + 1]) || 30 : 30; })();
const actorId = (() => { const i = args.indexOf('--actor'); return i >= 0 ? String(args[i + 1]) : 'verify-and-return-cdk'; })();
if (!cdkCode && !explicitOrder) {
  console.error('usage: verify-and-return-cdk.mjs <CDK码> [--apply] | --order <查询码> [--apply]');
  process.exit(2);
}
for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY_BASE64', 'CDK_HASH_KEY_V1_BASE64', 'CARD_INTAKE_PAN_HMAC_KEY_BASE64']) {
  if (!process.env[name]) { console.error(`${name} is required (source /etc/pojia/runtime.env first)`); process.exit(2); }
}

// timezone:'Z'：库里 DATETIME 存 UTC，mysql2 默认按本机时区解析会整整偏 8 小时（2026-09-13 踩过）
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3, timezone: 'Z' });
const out = (o) => console.log(JSON.stringify(o, null, 2));
try {
  // 1) 定位订单
  let publicNo = explicitOrder;
  if (!publicNo) {
    const read = createAdminReadService({
      pool,
      sessionEncryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
      cdkHashKey: Buffer.from(process.env.CDK_HASH_KEY_V1_BASE64, 'base64'),
      panHmacKey: Buffer.from(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64, 'base64'),
    });
    const found = await read.listOrders({ search: cdkCode, limit: 5 });
    const rows = found?.orders || found?.rows || found?.items || [];
    if (rows.length === 0) { out({ ok: false, reason: 'CDK_NOT_MATCHED', hint: '这串卡密没有匹配到任何订单——核对是不是卡密（不是订单查询码）' }); process.exit(1); }
    if (rows.length > 1) { out({ ok: false, reason: 'CDK_MATCHED_MULTIPLE', count: rows.length, hint: '匹配到多个订单，请用 --order 指定' }); process.exit(1); }
    publicNo = rows[0].publicNo || rows[0].public_no;
  }

  const [[order]] = await pool.query(
    `SELECT o.id, o.public_no, o.status, o.failure_code, o.assigned_card_id, c.last4
       FROM orders o LEFT JOIN cards c ON c.id = o.assigned_card_id
      WHERE o.public_no = ? LIMIT 1`, [publicNo]);
  if (!order) { out({ ok: false, reason: 'ORDER_NOT_FOUND', publicNo }); process.exit(1); }
  if (!order.last4) {
    const [[h]] = await pool.query(
      `SELECT c.last4 FROM card_assignment_history h INNER JOIN cards c ON c.id = h.card_id
        WHERE h.order_id = ? ORDER BY h.assigned_at DESC LIMIT 1`, [order.id]);
    if (h?.last4) order.last4 = h.last4;
  }

  // 2) 查付款意图时刻
  const [[submit]] = await pool.query(
    `SELECT MIN(bo.prepared_at) AS at FROM browser_operations bo
       INNER JOIN browser_runs br ON br.id = bo.browser_run_id
       INNER JOIN recharge_attempts ra ON ra.id = br.recharge_attempt_id
      WHERE ra.order_id = ? AND bo.operation_type = 'PAYMENT_SUBMIT'`, [order.id]);
  const submitAt = submit?.at ? new Date(submit.at).getTime() : null;

  // 3) 卡台核实
  let charges = null; let readError = null;
  if (order.last4 && submitAt != null) {
    try {
      const provider = createHighvccCardProvider({
        getAccessToken: createHighvccAccessTokenReader({
          pool, encryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
        }),
      });
      const rows = await provider.allTransactions({ pageSize: 50 });
      const w = windowMin * 60_000;
      // 卡台状态枚举（2026-09-13 实测）：刚授权是 PENDING，结算后才 COMPLETE。
      // 只认 COMPLETE 会把「刚扣完的钱」判成「没扣钱」——最危险的假阴性（真发生过：
      // PJV1-KLZokl 那单订单已 RECHARGE_SUCCESS、卡已 DEPLETED，工具却判 NO_CHARGE_FOUND）。
      // 因此改成保守口径：**窗口内出现任何交易都不自动退**，状态原样交人判断。
      // 两种错误代价不对等——漏判一个状态会重复扣款，多判只是多麻烦人一次。
      // 等积累了足够的失败状态样本（DECLINED/REVERSED 之类）再考虑放宽，现在不猜。
      charges = rows.filter((t) => String(t.lastFour || '') === String(order.last4)
        && Number(t.tradeTimeEpochMs) >= submitAt - w && Number(t.tradeTimeEpochMs) <= submitAt + w);
    } catch (e) { readError = String(e?.code || e?.message || e).slice(0, 120); }
  }

  // 3.5) 账号侧证据：库里最后一次 account-readonly-probe。
  // **它是付款之前的快照**，不等于「现在」的状态——账号有可能不花钱也变成 Plus
  // （2026-09-12 撞到过 ChatGPT 给新号「首月免费」的 offer）。所以它只能用来**否决**，
  // 不能用来**批准**：快照已是 Plus 就一定不能退；快照是 free 也只是必要条件之一。
  const [[probe]] = await pool.query(
    `SELECT bre.created_at,
            JSON_UNQUOTE(JSON_EXTRACT(bre.summary_json,'$.subscriptionStatus')) AS sub,
            JSON_EXTRACT(bre.summary_json,'$.alreadyPlus') AS already_plus
       FROM browser_run_events bre
       -- browser_run_events.browser_run_id 的 collation 与 browser_runs.id 不同（0900_ai_ci vs unicode_ci），
       -- 必须显式对齐，否则 ER_CANT_AGGREGATE_2COLLATIONS
       INNER JOIN browser_runs br2 ON br2.id = bre.browser_run_id COLLATE utf8mb4_unicode_ci
       INNER JOIN recharge_attempts ra2 ON ra2.id = br2.recharge_attempt_id
      WHERE ra2.order_id = ? AND bre.action = 'account-readonly-probe'
      ORDER BY bre.created_at DESC LIMIT 1`, [order.id]);
  const accountSnapshot = probe ? {
    at: new Date(probe.created_at).toISOString(),
    subscriptionStatus: probe.sub || null,
    alreadyPlus: String(probe.already_plus) === 'true',
    beforePayment: submitAt != null && new Date(probe.created_at).getTime() <= submitAt,
  } : null;

  const verdict = accountSnapshot?.alreadyPlus ? 'ACCOUNT_ALREADY_PLUS_DO_NOT_RETURN'
    : !order.last4 ? 'CARD_UNKNOWN_CANNOT_VERIFY'
    : submitAt == null ? 'NO_PAYMENT_SUBMIT_RECORDED'
      : readError ? 'CARD_PLATFORM_READ_FAILED'
        : charges.length === 0 ? 'NO_CHARGE_FOUND'
          : charges.length === 1 ? 'CHARGED_ONCE' : 'AMBIGUOUS_MULTIPLE_CHARGES';

  // 4) 找这单的 run（收口要对着 run 做）
  const [[run]] = await pool.query(
    `SELECT br.id, br.status, br.payment_state FROM browser_runs br
       INNER JOIN recharge_attempts ra ON ra.id = br.recharge_attempt_id
      WHERE ra.order_id = ? ORDER BY br.created_at DESC LIMIT 1`, [order.id]);

  const safeToReturn = verdict === 'NO_CHARGE_FOUND' || verdict === 'NO_PAYMENT_SUBMIT_RECORDED';
  const base = {
    order: order.public_no, orderStatus: order.status, cardLast4: order.last4 || null,
    paymentSubmitAt: submitAt ? new Date(submitAt).toISOString() : null,
    verdict, chargesFound: charges ? charges.length : null, readError,
    chargeDetails: charges ? charges.map((t) => ({ amountCents: t.amount, status: t.status,
      at: new Date(Number(t.tradeTimeEpochMs)).toISOString() })) : null,
    accountSnapshot,
    // 这一条必须显示出来：卡台证据是客观的，账号证据只是付款前的快照。
    // 「卡没扣款」推不出「账号没开通」——免费 offer 就能让账号不花钱变 Plus。
    accountCaveat: accountSnapshot?.beforePayment
      ? '账号状态是付款前的快照，执行前请确认该账号现在仍不是 Plus（若已是 Plus，不要退卡密）'
      : '库里没有付款前后的账号探测记录，无法从数据判断账号现状，请人工确认',
    run: run ? { id: run.id, status: run.status, paymentState: run.payment_state } : null,
    safeToReturn,
  };

  if (!apply) { out({ ...base, mode: 'dry-run', next: safeToReturn ? '加 --apply 才会真的收口并退回 CDK' : '当前判定不允许退回，先人工核实' }); process.exit(0); }
  if (!safeToReturn) { out({ ...base, applied: false, refused: `判定为 ${verdict}，拒绝退回` }); process.exit(1); }
  if (!run) { out({ ...base, applied: false, refused: '找不到可收口的 run' }); process.exit(1); }

  const admin = createBrowserAdminService({ pool });
  const result = await admin.controlRun(run.id, {
    action: 'RESOLVE_UNKNOWN_PAYMENT',
    verifiedOutcome: 'NOT_CHARGED',
    confirmation: `确认核实结果 ${run.id}`,
    operationId: `verify-return-cdk:${run.id}:${randomUUID().slice(0, 8)}`,
    actorId,
    evidenceNote: `卡台核实：付款窗口 ±${windowMin} 分钟内该卡零笔成功扣款（自动核实）`,
  });
  const [[cdkAfter]] = await pool.query(`SELECT status FROM cdks WHERE order_id = ? LIMIT 1`, [order.id]);
  const [[orderAfter]] = await pool.query(`SELECT status, failure_code FROM orders WHERE id = ? LIMIT 1`, [order.id]);
  out({ ...base, applied: true, runStatusAfter: result?.status || null, orderAfter, cdkStillBound: cdkAfter?.status || '(已解绑)' });
} catch (error) {
  console.error(String(error?.code || error?.message || error).slice(0, 300));
  process.exitCode = 1;
} finally {
  await pool.end();
}
