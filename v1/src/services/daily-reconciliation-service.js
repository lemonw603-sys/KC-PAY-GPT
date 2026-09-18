import {
  ChargeKind, absoluteAmountCents, classifyCharge, isChargeback, isChargebackFee
} from '../domain/card-transaction-audit.js';
import { fromCents } from '../domain/card-issue-fee.js';
import { createCardRetirementService } from './card-retirement-service.js';

/**
 * 第⑤步（面四③，D-249）：**每日一次对账，次数与金额分开**。
 *
 * 为什么分开：它们坏掉的方式不一样。次数对不上说明「这张卡付过的单系统没记全」——影响每卡上限
 * 与待销判断；金额对不上说明「钱的去向对不上账」——影响的是资金本身。混成一个数，两边都看不清。
 *
 * **只读**：这个服务一行都不写业务表（唯一的写是把本次报告指纹存进 app_settings，用来判断
 * 「连续两次」）。差异前期只进看板 + 每日一条汇总推；**连续两次日对账仍在**才够格进「需要我处理」
 * （D-249：Lemon 担心误判和延迟造成的误推）。
 *
 * 判据在 `domain/card-transaction-audit.js`，那里写明了每个取值来自哪次生产实查。
 *
 * ## 三类「不算差异」的东西（列出来，但不猜原因）
 *
 * - `PENDING_MANUAL_REGISTRATION`：卡台扣款多于账本。运营手动拿卡付款系统不知道（3336 那笔
 *   142.54，D-270 发现 7）。登记入口归第⑥块；在它上线之前这类只列出、不算差异（Lemon 定）。
 * - `FUNDING_SOURCE_INCOMPLETE`：`funded_amount` 比卡台扣款合计还小，金额公式根本立不起来。
 *   2026-09-18 实跑：5501 funded 2.00 / 扣款 159.16，7402 funded 49 / 扣款 158.62，
 *   0601 funded 3.27 / 扣款 143.01。**原因未知**，本服务只如实列出。
 * - `NO_TRANSACTION_COVERAGE`：这张卡在 `card_transactions` 里一行都没有，没东西可对。
 * - `CARD_IN_TERMINAL_STATE`：卡已作废/用尽/已销，余额被清零或退回，金额公式不适用。
 * - `AWAITING_RESOLUTION`：差的那几笔正是账本里 RECONCILIATION 的占位行，等人收口，不是对账问题。
 */

export const LAST_REPORT_SETTING = 'daily_reconciliation_last_report';

export const CountFinding = Object.freeze({
  MATCHED: 'MATCHED',
  PENDING_MANUAL_REGISTRATION: 'PENDING_MANUAL_REGISTRATION',
  LEDGER_AHEAD: 'LEDGER_AHEAD',
  AWAITING_RESOLUTION: 'AWAITING_RESOLUTION',
  UNKNOWN_STATUS: 'UNKNOWN_STATUS'
});

export const AmountFinding = Object.freeze({
  MATCHED: 'MATCHED',
  AMOUNT_DIFF: 'AMOUNT_DIFF',
  FUNDING_SOURCE_INCOMPLETE: 'FUNDING_SOURCE_INCOMPLETE',
  NO_TRANSACTION_COVERAGE: 'NO_TRANSACTION_COVERAGE',
  CARD_IN_TERMINAL_STATE: 'CARD_IN_TERMINAL_STATE'
});

/**
 * 卡进了终态（卡台作废 / 余额用尽 / 已销）之后，余额被卡台清零或退回钱包，
 * 「开卡金额 − 扣款 = 余额」这条式子就不成立了 —— 2026-09-18 首次生产实跑，11 条差异里
 * 有 7 条是这么来的（1013/1284/1666/4643/5980/7705/9051，全是 hnskj 那 12 张作废旧卡）。
 * 对一张已经作废的卡算「余额少了 16 块」没有意义，所以不对它们做金额对账。
 */
const TERMINAL_INVENTORY_STATUSES = new Set(['RETIRED', 'DEPLETED', 'FAILED']);

const REAL_DISCREPANCIES = new Set([
  CountFinding.LEDGER_AHEAD, CountFinding.UNKNOWN_STATUS, AmountFinding.AMOUNT_DIFF
]);

export function isRealDiscrepancy(finding) {
  return REAL_DISCREPANCIES.has(finding);
}

/**
 * 一张卡的两种对账。纯函数，方便对着真实行做单测。
 *
 * `transactions` 是这张卡的全部流水行（原始库行形状）；`ledgerConsumed` 是账本里确认消费的条数，
 * `ledgerReconciliation` 是「付款未知、资金锁着」的占位条数——两者分开数，见下面的注释。
 */
export function reconcileCard({ card, transactions = [], ledgerConsumed = 0, ledgerReconciliation = 0 }) {
  let settled = 0;
  let pending = 0;
  let unknownStatus = 0;
  let zeroAuth = 0;
  let chargeCents = 0;
  let chargebackCents = 0;
  let negativeRows = 0;
  const merchants = new Map();

  for (const row of transactions) {
    const kind = classifyCharge(row);
    if (Number(row.amount) < 0) negativeRows += 1;
    if (kind === ChargeKind.SETTLED || kind === ChargeKind.PENDING) {
      const cents = absoluteAmountCents(row.amount) ?? 0;
      chargeCents += cents;
      if (kind === ChargeKind.SETTLED) settled += 1; else pending += 1;
      const name = String(row.merchant_name || '').trim().slice(0, 40) || '(无商户名)';
      merchants.set(name, (merchants.get(name) || 0) + 1);
    } else if (kind === ChargeKind.UNKNOWN_STATUS) {
      unknownStatus += 1;
    } else if (kind === ChargeKind.ZERO_AUTH) {
      zeroAuth += 1;
    }
    if (isChargeback(row) || isChargebackFee(row)) {
      chargebackCents += absoluteAmountCents(row.amount) ?? 0;
    }
  }

  const providerCharges = settled + pending;
  // 账本的 RECONCILIATION 行是「付款结果未知、资金锁着」的占位，**不是**已确认的一次消费
  // （生产 2 行，都在 hnskj 的 1013/4643 上）。拿它当消费会把这两张卡永远报成「账本多于卡台」。
  // 所以确认消费只数 CONSUMED，占位单独算一档 AWAITING_RESOLUTION —— 等人收口，不是差异。
  const ledgerUsed = ledgerConsumed + ledgerReconciliation;
  let countFinding = CountFinding.MATCHED;
  if (unknownStatus > 0) countFinding = CountFinding.UNKNOWN_STATUS;
  else if (providerCharges > ledgerUsed) countFinding = CountFinding.PENDING_MANUAL_REGISTRATION;
  else if (ledgerConsumed > providerCharges) countFinding = CountFinding.LEDGER_AHEAD;
  else if (ledgerReconciliation > 0 && ledgerUsed > providerCharges) countFinding = CountFinding.AWAITING_RESOLUTION;

  const fundedCents = absoluteAmountCents(card.funded_amount);
  const balanceCents = absoluteAmountCents(card.current_balance);
  const spentCents = chargeCents + chargebackCents;
  let amountFinding;
  let expectedCents = null;
  let deltaCents = null;
  if (TERMINAL_INVENTORY_STATUSES.has(String(card.inventory_status || '').toUpperCase())) {
    amountFinding = AmountFinding.CARD_IN_TERMINAL_STATE;
  } else if (!transactions.length) {
    amountFinding = AmountFinding.NO_TRANSACTION_COVERAGE;
  } else if (fundedCents === null || balanceCents === null) {
    amountFinding = AmountFinding.FUNDING_SOURCE_INCOMPLETE;
  } else if (fundedCents < spentCents) {
    // 开卡金额比已经扣掉的还少：入金记录不全，这个公式立不起来。不硬算出一个「差异」来吓人。
    amountFinding = AmountFinding.FUNDING_SOURCE_INCOMPLETE;
    expectedCents = fundedCents - spentCents;
    deltaCents = balanceCents - expectedCents;
  } else {
    expectedCents = fundedCents - spentCents;
    deltaCents = balanceCents - expectedCents;
    amountFinding = deltaCents === 0 ? AmountFinding.MATCHED : AmountFinding.AMOUNT_DIFF;
  }

  return {
    cardId: card.id,
    last4: card.last4,
    providerCardId: card.provider_card_id,
    providerAccountId: card.provider_account_id,
    inventoryStatus: card.inventory_status,
    lastSyncedAt: card.last_synced_at ?? null,
    count: {
      finding: countFinding,
      ledgerConsumed,
      ledgerReconciliation,
      ledgerUsed,
      providerCharges,
      settled,
      pending,
      unknownStatus,
      zeroAuth,
      merchants: [...merchants.entries()].map(([name, n]) => ({ merchant: name, charges: n }))
    },
    amount: {
      finding: amountFinding,
      funded: fundedCents === null ? null : fromCents(fundedCents),
      charged: fromCents(chargeCents),
      chargebacks: fromCents(chargebackCents),
      balance: balanceCents === null ? null : fromCents(balanceCents),
      expected: expectedCents === null ? null : fromCents(expectedCents),
      delta: deltaCents === null ? null : fromCents(deltaCents),
      negativeRows
    }
  };
}

/** 差异指纹：卡 + 两个结论。用它判断「同一个差异是不是连续两天都在」。 */
export function fingerprintOf(card) {
  return `${card.cardId}:${card.count.finding}:${card.amount.finding}`;
}

export function createDailyReconciliationService({ pool, clock = () => new Date() }) {
  const retirement = createCardRetirementService({ pool, clock });

  async function loadCards() {
    const [rows] = await pool.query(
      `SELECT c.id, c.last4, c.provider_card_id, c.provider_account_id, c.inventory_status,
              c.funded_amount, c.current_balance, c.currency, c.last_synced_at,
              (SELECT COUNT(*) FROM card_consumption_ledger l
                WHERE l.card_id = c.id AND l.status = 'CONSUMED') AS ledger_consumed,
              (SELECT COUNT(*) FROM card_consumption_ledger l
                WHERE l.card_id = c.id AND l.status = 'RECONCILIATION') AS ledger_reconciliation
         FROM cards c ORDER BY c.provider_account_id, c.last4`
    );
    return rows;
  }

  async function loadTransactions() {
    const [rows] = await pool.query(
      `SELECT card_id, provider_transaction_id, transaction_type, status, amount, currency,
              merchant_name, trade_time_raw
         FROM card_transactions ORDER BY card_id, id`
    );
    const byCard = new Map();
    for (const row of rows) {
      if (!byCard.has(row.card_id)) byCard.set(row.card_id, []);
      byCard.get(row.card_id).push(row);
    }
    return byCard;
  }

  async function readLastReport() {
    const [rows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [LAST_REPORT_SETTING]
    );
    if (!rows[0]?.setting_value) return null;
    try { return JSON.parse(rows[0].setting_value); } catch { return null; }
  }

  async function writeLastReport(report) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [LAST_REPORT_SETTING, JSON.stringify(report)]
    );
  }

  /**
   * 跑一次日对账。`persist` 为 false 时不写指纹（演练 / 只读复验用），
   * 「连续两次」的判断仍然照常基于上一次存下的指纹。
   */
  async function run({ persist = true } = {}) {
    const now = clock();
    const [cards, transactionsByCard, previous] = await Promise.all([
      loadCards(), loadTransactions(), readLastReport()
    ]);
    const previousFingerprints = new Set(previous?.discrepancyFingerprints || []);

    const results = cards.map((card) => reconcileCard({
      card,
      transactions: transactionsByCard.get(card.id) || [],
      ledgerConsumed: Number(card.ledger_consumed) || 0,
      ledgerReconciliation: Number(card.ledger_reconciliation) || 0
    }));

    const discrepancies = results.filter(
      (card) => isRealDiscrepancy(card.count.finding) || isRealDiscrepancy(card.amount.finding)
    ).map((card) => {
      const fingerprint = fingerprintOf(card);
      return { ...card, fingerprint, persistent: previousFingerprints.has(fingerprint) };
    });
    const pendingRegistration = results.filter(
      (card) => card.count.finding === CountFinding.PENDING_MANUAL_REGISTRATION
    );
    const fundingIncomplete = results.filter(
      (card) => card.amount.finding === AmountFinding.FUNDING_SOURCE_INCOMPLETE
    );

    const retirementList = await retirement.list();
    const report = {
      readOnly: true,
      generatedAt: now.toISOString(),
      cardCount: results.length,
      discrepancyCount: discrepancies.length,
      persistentCount: discrepancies.filter((card) => card.persistent).length,
      pendingRegistrationCount: pendingRegistration.length,
      fundingIncompleteCount: fundingIncomplete.length,
      retirementDueCount: retirementList.due.length,
      discrepancies,
      pendingRegistration,
      fundingIncomplete,
      cards: results
    };

    if (persist) {
      await writeLastReport({
        generatedAt: report.generatedAt,
        discrepancyFingerprints: discrepancies.map((card) => card.fingerprint)
      });
    }
    return report;
  }

  return { run, readLastReport };
}

/**
 * 每日一条汇总的文案。Lemon 定（2026-09-18）：**待销到期不单推，并进这一条**。
 * 一条推送只该回答一个问题——「今天要不要动手」——所以正常那天也要能一眼看完。
 */
export function summaryMessage(report) {
  const lines = [];
  lines.push(`对账 ${report.cardCount} 张卡：差异 ${report.discrepancyCount} 张`
    + `${report.persistentCount ? `（其中 ${report.persistentCount} 张连续两天还在，要处理）` : ''}。`);
  if (report.pendingRegistrationCount) {
    lines.push(`卡台扣了但系统没记的 ${report.pendingRegistrationCount} 张：多半是手动用卡，等登记入口（第⑥块）。`);
  }
  if (report.fundingIncompleteCount) {
    lines.push(`开卡金额对不上扣款合计的 ${report.fundingIncompleteCount} 张：金额公式立不起来，原因未查。`);
  }
  lines.push(`待销到期 ${report.retirementDueCount} 张${report.retirementDueCount ? '，到存活期可以去卡台删了。' : '。'}`);
  return lines.join('');
}
