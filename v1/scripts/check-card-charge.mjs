// 只读核实：某一单的付款，卡上到底有没有对应的扣款。
//
//   node v1/scripts/check-card-charge.mjs <public-no> [--window-min 30]
//
// 用途：付款结果不明时，人工核实「钱动没动」的证据来源。在自动链路接上之前（ROADMAP 第二步），
// 这是手动版；接上之后同一份证据由验证 lane 自己读。
// 只读：不写库、不改订单、不碰卡台的任何写接口。输出不含完整卡号。
//
// 需要 DATABASE_URL 与 SESSION_ENCRYPTION_KEY_BASE64（主机上 source /etc/pojia/runtime.env）。
import mysql from 'mysql2/promise';
import { createHighvccAccessTokenReader } from '../src/services/highvcc-card-service.js';
import { createHighvccCardProvider } from '../src/providers/highvcc-card.js';

const [publicNo, ...rest] = process.argv.slice(2);
const windowMin = (() => { const i = rest.indexOf('--window-min'); return i >= 0 ? Number(rest[i + 1]) || 30 : 30; })();
if (!publicNo) { console.error('usage: check-card-charge.mjs <public-no> [--window-min 30]'); process.exit(2); }

const pool = mysql.createPool(process.env.DATABASE_URL);
try {
  const [[order]] = await pool.query(
    `SELECT o.id, o.public_no, o.status, o.assigned_card_id, c.last4, c.card_bin
       FROM orders o LEFT JOIN cards c ON c.id = o.assigned_card_id
      WHERE o.public_no = ? LIMIT 1`, [publicNo]);
  if (!order) { console.error('找不到这个订单'); process.exit(1); }
  // 订单收口时会清空 assigned_card_id，所以已关闭的单要回头从分配历史里找那张卡。
  // 这一步不能省：查不到卡就匹配不到任何交易，而「匹配到零笔」会被读成「没扣款」——
  // 那是把「没查对」当成「没扣钱」，最危险的一种误判。
  if (!order.last4) {
    const [[fromHistory]] = await pool.query(
      `SELECT c.last4, c.card_bin FROM card_assignment_history h
         INNER JOIN cards c ON c.id = h.card_id
        WHERE h.order_id = ? ORDER BY h.assigned_at DESC LIMIT 1`, [order.id]);
    if (fromHistory?.last4) { order.last4 = fromHistory.last4; order.card_bin = fromHistory.card_bin; }
  }

  // 付款意图时间：以 PAYMENT_SUBMIT 这一步为准，没有就退回订单创建时间
  const [[submit]] = await pool.query(
    `SELECT MIN(bo.prepared_at) AS at FROM browser_operations bo
       INNER JOIN browser_runs br ON br.id = bo.browser_run_id
       INNER JOIN recharge_attempts ra ON ra.id COLLATE utf8mb4_unicode_ci = br.recharge_attempt_id
      WHERE ra.order_id = ? AND bo.operation_type = 'PAYMENT_SUBMIT'`, [order.id]);
  const submitAt = submit?.at ? new Date(submit.at).getTime() : null;

  const getToken = createHighvccAccessTokenReader({
    pool, encryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
  });
  const provider = createHighvccCardProvider({ getAccessToken: getToken });
  const rows = await provider.allTransactions({ pageSize: 50 });

  const last4 = String(order.last4 || '');
  const windowMs = windowMin * 60_000;
  const mine = rows.filter((t) => String(t.lastFour || '') === last4);
  const inWindow = submitAt == null ? [] : mine.filter((t) => {
    const at = Number(t.tradeTimeEpochMs) || 0;
    return at >= submitAt - windowMs && at <= submitAt + windowMs;
  });
  const successful = inWindow.filter((t) => String(t.status || '').toUpperCase() === 'COMPLETE');

  console.log(JSON.stringify({
    order: order.public_no, orderStatus: order.status,
    cardLast4: last4, cardBin: order.card_bin,
    paymentSubmitAt: submitAt ? new Date(submitAt).toISOString() : null,
    windowMinutes: windowMin,
    cardTransactionsTotal: rows.length,
    onThisCard: mine.length,
    inWindow: inWindow.length,
    successfulInWindow: successful.length,
    // 判定只说事实，不替人下结论：零笔且已过窗口 = 没扣款；一笔 = 扣了；多笔 = 歧义要人看
    // 判定顺序有意如此：任何一个前提缺失都必须先说「查不了」，绝不退化成「没扣款」。
    verdict: !last4 ? 'CARD_UNKNOWN_CANNOT_VERIFY'
      : submitAt == null ? 'NO_PAYMENT_SUBMIT_RECORDED'
        : successful.length === 0 ? 'NO_CHARGE_FOUND'
          : successful.length === 1 ? 'CHARGED_ONCE' : 'AMBIGUOUS_MULTIPLE_CHARGES',
    charges: successful.map((t) => ({ amountCents: t.amount, unit: t.unit, at: new Date(Number(t.tradeTimeEpochMs)).toISOString(), status: t.status, merchantCountry: t.merchantCountry })),
    // 诊断用：这张卡上的全部交易，看时间到底落在哪——窗口设错会造成最危险的假阴性
    allOnThisCard: mine.map((t) => ({
      amountCents: t.amount, status: t.status,
      tradeTime: new Date(Number(t.tradeTimeEpochMs)).toISOString(),
      approveTime: t.approveTimeEpochMs ? new Date(Number(t.approveTimeEpochMs)).toISOString() : null,
      minutesFromSubmit: submitAt ? Math.round((Number(t.tradeTimeEpochMs) - submitAt) / 60000) : null,
    })),
  }, null, 2));
} catch (error) {
  console.error(String(error?.code || error?.message || error).slice(0, 200));
  process.exitCode = 1;
} finally {
  await pool.end();
}
