// 消费账本历史补记（D-249 面四② T3）。
//
// 补的是什么：订单最终 RECHARGE_SUCCESS、卡确实被刷了，但 `card_consumption_ledger`
// 没有把这次消费记成 CONSUMED 的历史单。生产实查 2026-09-17：20 个成功单里
// 12 CONSUMED / 7 RELEASED / 1 无行。
//
// 这 8 单为什么会这样（读 release_reason 与 order_events 得到，不是猜的）：
//   · 5 单（pom5/NnL3/BUGA/G3Ni/zdpr）走了 Browser 付款前中止 → 中止把卡和账本都释放了，
//     随后运营在系统外用同一张卡人工付款、再用 close-manually-fulfilled-order.mjs 关单。
//     那个脚本对 RECHARGE_FAILED 单**明确拒绝** --card-used（见其第 42-44 行），所以
//     账本停在 RELEASED。这是已知的设计缺口，不是某条分支忘了写。
//   · 2 单（VHl_/Dqcn）同一个脚本关的，但当时按「卡没用」关。
//   · 1 单（FqFn）是 API 全自动成功单，只是它早于账本机制上线（账本最早一行
//     2026-08-29 05:50:22，该单 08-27 07:52 就结束了），所以根本没有账本行。
//
// 为什么要补：分卡上限「一卡最多 N 单」只数 RESERVED/CONSUMED/RECONCILIATION，
// 不数 RELEASED（card-inventory-eligibility.js）。漏记的单不占额度，卡会被超额分出去。
//
// 证据规则（本脚本的核心，不许放宽）：只补能在 `card_transactions` 里找到对应扣款流水的单。
// 找不到流水的单**不补**、只报告，因为「订单成功」不等于「用的是这张卡」。
//
//   node v1/scripts/backfill-consumption-ledger-d249.mjs --dry-run   # 只看，不写（默认）
//   node v1/scripts/backfill-consumption-ledger-d249.mjs --apply     # 真写
//
// 需要 DATABASE_URL（生产主机上 source /etc/pojia/runtime.env，或从 Mac 指向 13306 隧道）。
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { reserveCardConsumptionInTransaction, transitionCardConsumptionInTransaction } =
  await import(join(HERE, '../src/services/card-consumption-ledger-service.js'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

// D-249 里 Lemon 确认要补的那批单。写死一份名单而不是用条件扫全库：这是一次性的历史
// 修补，名单是 Lemon 逐条看过的，脚本不该自己决定补谁。
const TARGET_PUBLIC_NOS = [
  'PJV1-FqFnMiSKBtLGN14GyP7W',
  'PJV1-VHl_hgWctg78JwDajOVR',
  'PJV1-DqcnqHF0tPlxDhygTtAA',
  'PJV1-pom5NfWiskFl9u4Aspdm',
  'PJV1-NnL3DWl9sCCHWsT2krMy',
  'PJV1-BUGAhkA9dYVdLiD6WQac',
  'PJV1-G3Ni4WrwJERVUOg5tl3x',
  'PJV1-zdprG5vkLzo7UKs8XEe1',
];

const AUDIT_REASON = 'ledger backfill D-249';

/**
 * 两个卡台的 trade_time_raw 格式不同，这里不做统一，只如实解释：
 *   · highvcc：ISO UTC 字符串（本仓库写入时就归一成 ISO，provider 的 epoch 毫秒直读 UTC）。
 *   · hnskj：卡台给的 'YYYY-MM-DD HH:MM:SS' 本地串，实测是 UTC+8——两个独立样本：
 *       开卡流水 '2026-09-17 09:34:34' vs cards.created_at 2026-09-17 01:34:35 UTC；
 *       购买流水 '2026-08-27 15:51:03' vs 该单 07:51 UTC 付款成功。
 *     **这是两点推断，不是卡台文档确认的**，所以 hnskj 的匹配一律不自动断言，
 *     只把候选和原始字符串打出来交人判断（见下面的 needsHumanCheck）。
 */
function parseTradeTime(raw, providerCode) {
  const text = String(raw || '').trim();
  if (!text) return { at: null, assumed: null };
  if (/T.*Z$/.test(text)) {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? { at: null, assumed: null } : { at, assumed: 'ISO_UTC' };
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) {
    const offsetHours = providerCode === 'hnskj' ? 8 : 0;
    const at = new Date(`${text.replace(' ', 'T')}Z`);
    if (Number.isNaN(at.getTime())) return { at: null, assumed: null };
    return {
      at: new Date(at.getTime() - offsetHours * 3600_000),
      assumed: offsetHours ? `LOCAL_UTC_PLUS_${offsetHours}` : 'NAIVE_AS_UTC',
    };
  }
  return { at: null, assumed: null };
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const report = [];
let applied = 0;

try {
  for (const publicNo of TARGET_PUBLIC_NOS) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [[order]] = await connection.query(
        `SELECT o.id, o.public_no, o.status, o.product_id, o.created_at, o.finished_at,
                o.open_card_amount, o.minimum_required_card_balance,
                l.id AS ledger_id, l.status AS ledger_status, l.card_id AS ledger_card_id,
                l.amount AS ledger_amount, l.currency AS ledger_currency,
                l.recharge_attempt_id, l.reserved_at,
                COALESCE(l.card_id, o.assigned_card_id) AS card_id
         FROM orders o
         LEFT JOIN card_consumption_ledger l ON l.order_id = o.id
         WHERE BINARY o.public_no = ? LIMIT 1 FOR UPDATE`,
        [publicNo]
      );
      if (!order) { report.push({ publicNo, decision: 'SKIP', why: 'order not found' }); await connection.rollback(); continue; }
      if (order.status !== 'RECHARGE_SUCCESS') {
        report.push({ publicNo, decision: 'SKIP', why: `order is ${order.status}, not RECHARGE_SUCCESS` });
        await connection.rollback(); continue;
      }
      if (order.ledger_status === 'CONSUMED') {
        report.push({ publicNo, decision: 'ALREADY_CONSUMED', why: 'nothing to do' });
        await connection.rollback(); continue;
      }
      if (!order.card_id) {
        report.push({ publicNo, decision: 'BLOCKED', why: 'no card on the ledger row or the order; cannot tell which card was used' });
        await connection.rollback(); continue;
      }

      const [[card]] = await connection.query(
        `SELECT c.id, c.last4, c.provider_card_id, c.external_card_id, pa.provider_code
         FROM cards c JOIN provider_accounts pa ON pa.id = c.provider_account_id
         WHERE c.id = ? LIMIT 1`, [order.card_id]
      );

      // 证据：这张卡上的全部消费类流水（不限时间窗，窗口判断在下面做，
      // 好让报告能显示「有流水但不在窗口内」和「一条流水都没有」的区别）。
      const [transactions] = await connection.query(
        `SELECT provider_transaction_id, transaction_type, status, amount, currency, trade_time_raw
         FROM card_transactions
         WHERE card_id = ? AND LOWER(transaction_type) = 'purchase'
         ORDER BY trade_time_raw`, [order.card_id]
      );

      // 窗口 = 账本建仓时刻（没有账本行就用订单创建时刻）到订单结束时刻。
      // 这批单的流水全部落在这个窗口内，不需要放宽；放宽会把相邻订单的扣款认成这一单的。
      const windowStart = order.reserved_at ? new Date(order.reserved_at) : new Date(order.created_at);
      const windowEnd = order.finished_at ? new Date(order.finished_at) : new Date();
      const candidates = transactions.map((row) => {
        const parsed = parseTradeTime(row.trade_time_raw, card?.provider_code);
        return {
          providerTransactionId: row.provider_transaction_id,
          status: row.status,
          amount: String(row.amount),
          currency: row.currency,
          tradeTimeRaw: row.trade_time_raw,
          tradeTimeUtc: iso(parsed.at),
          timeBasis: parsed.assumed,
          inWindow: Boolean(parsed.at && parsed.at >= windowStart && parsed.at <= windowEnd),
        };
      });
      const matched = candidates.filter((row) => row.inWindow);
      // hnskj 的时间基准是推断出来的（见 parseTradeTime 注释），匹配结果必须人看过才算数。
      const needsHumanCheck = matched.some((row) => row.timeBasis === 'LOCAL_UTC_PLUS_8');

      const base = {
        publicNo,
        cardLast4: card?.last4 ?? null,
        cardRef: card?.provider_card_id ?? null,
        provider: card?.provider_code ?? null,
        ledgerStatus: order.ledger_status ?? '(无行)',
        window: { from: iso(windowStart), to: iso(windowEnd) },
        transactionsOnCard: candidates.length,
        matched,
      };

      if (matched.length === 0) {
        report.push({
          ...base, decision: 'BLOCKED',
          why: candidates.length
            ? '这张卡上有流水，但没有一条落在本单的时间窗内——不能断言这单用了这张卡'
            : '这张卡上一条消费流水都没有（若 highvcc 流水尚未入库，先跑 T1 再来）',
          otherTransactions: candidates,
        });
        await connection.rollback(); continue;
      }
      if (matched.length > 1) {
        report.push({ ...base, decision: 'BLOCKED', why: '窗口内有多条流水，对不出是哪一条，交人判断' });
        await connection.rollback(); continue;
      }

      const evidence = matched[0];
      // 金额用账本既有口径（卡上占用的美元额度），不用 orders.actual_payment_amount——
      // 那一列存的是商户侧原币（实见 982.14 PHP），填进来就串了单位。
      const amount = order.ledger_amount != null
        ? String(order.ledger_amount)
        : String(order.open_card_amount ?? order.minimum_required_card_balance);
      const currency = order.ledger_currency || 'USD';
      const ledgerEvidence = {
        source: 'ledger_backfill_d249',
        providerTransactionId: evidence.providerTransactionId,
        tradeTimeUtc: evidence.tradeTimeUtc,
        tradeTimeBasis: evidence.timeBasis,
        platformAmount: `${evidence.amount} ${evidence.currency}`,
      };

      const plan = {
        ...base, decision: needsHumanCheck ? 'BACKFILL_NEEDS_HUMAN_CHECK' : 'BACKFILL',
        amount, currency, evidence: ledgerEvidence,
        action: order.ledger_id ? `${order.ledger_status} → CONSUMED` : 'INSERT RESERVED → CONSUMED',
      };

      if (!apply) { report.push({ ...plan, applied: false }); await connection.rollback(); continue; }

      // 走正式的账本函数，不自己拼 SQL。没有账本行的单先按正式路径建仓再消费，
      // 这样一卡多单的上限检查照样跑过一遍。
      if (!order.ledger_id) {
        await reserveCardConsumptionInTransaction(connection, {
          cardId: order.card_id, orderId: order.id,
          rechargeAttemptId: order.recharge_attempt_id || null,
          productId: order.product_id, amount, currency,
          maxPayments: 3, evidence: ledgerEvidence,
        });
      }
      const transition = await transitionCardConsumptionInTransaction(connection, {
        orderId: order.id, targetStatus: 'CONSUMED',
        allowedCurrentStatuses: ['RESERVED', 'RECONCILIATION', 'RELEASED'],
        requireActive: true,
        providerTransactionId: evidence.providerTransactionId,
        evidence: ledgerEvidence,
      });
      // 补记后这行是 CONSUMED，但 released_at/release_reason 还留着当初释放的痕迹。
      // 留着是对的：它说明这单曾被释放过，是这次补记的由来，清掉就抹掉了线索。
      await connection.query(
        `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, ?, ?, 'ADMIN', 'backfill-consumption-ledger-d249', ?, ?)`,
        [order.id, order.status, order.status, AUDIT_REASON,
          JSON.stringify({ ledgerBackfill: true, previousLedgerStatus: order.ledger_status ?? null,
            cardLast4: card?.last4 ?? null, amount, currency, evidence: ledgerEvidence, transition })]
      );
      await connection.commit();
      applied += 1;
      report.push({ ...plan, applied: true });
    } catch (error) {
      await connection.rollback().catch(() => {});
      report.push({ publicNo, decision: 'ERROR', why: error?.code || error?.message || String(error) });
    } finally {
      connection.release();
    }
  }

  const counts = report.reduce((acc, row) => { acc[row.decision] = (acc[row.decision] || 0) + 1; return acc; }, {});
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY-RUN', applied, counts, report }, null, 2));
  if (report.some((row) => row.decision === 'ERROR')) process.exitCode = 1;
} finally {
  await pool.end();
}
