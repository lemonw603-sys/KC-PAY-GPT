import {
  ChargeKind, absoluteAmountCents, classifyCharge, isChargeback, isChargebackFee
} from '../domain/card-transaction-audit.js';
import { fromCents } from '../domain/card-issue-fee.js';
import { createCardRetirementService } from './card-retirement-service.js';

/**
 * 第⑤步（面四③，D-249）：**每日一次对账，次数与金额分开**。
 * 第⑤b 块收窄（D-275，2026-09-18，Lemon 认，起因 Codex 审查 F-47～F-55）：
 *
 *   ① 金额对账降级（F-49/F-53）：`funded_amount` 对多数卡不是「卡里实际到账的钱」，而是**下单金额**
 *      （D-274：1657/3159 差的正是开卡费）。建在不可靠起点上的自动金额判断＝「给观察补原因」。
 *      所以除非这张卡有**可验证的期初入卡金额**（Lemon 核实过的基准），金额一律 `UNVERIFIABLE`，
 *      既不判异常也不判一致。当前没有任何来源提供这个基准 → 所有卡都 `UNVERIFIABLE`，只对次数。
 *      余额改**有符号**解析：负余额含义未知，明确标 `NEGATIVE_BALANCE`，不再取绝对值算成正数。
 *   ② 未知扣款分开（F-48）：卡台扣得比账本多时，只有**已登记手动用卡**的卡（RETIRED override，
 *      reason 带 `manual-used` 标识，如 3336）算 `PENDING_MANUAL_REGISTRATION`（待补登记、不算差异）；
 *      其余一律 `UNEXPLAINED_CHARGE`（无主扣款）——**是差异、进报告、不隐藏**，但先不升级 critical。
 *   ③ 「连续两次」只由**正式批次**推进（F-50）：只读 GET / dry-run 沿用上一个正式批次已算好的
 *      persistent 结论，绝不因为多读一次就把当次差异当成「第二次出现」；同日重跑正式批次幂等。
 *
 * **只读**：这个服务一行都不写业务表（唯一的写是把本次报告指纹存进 app_settings）。
 * 差异前期只进看板 + 每日一条汇总推；**够格升级的差异连续两次仍在**才升 critical（D-249）。
 *
 * 判据在 `domain/card-transaction-audit.js`，那里写明了每个取值来自哪次生产实查。
 */

export const LAST_REPORT_SETTING = 'daily_reconciliation_last_report';

/**
 * 手动用卡登记的机器标识（D-275 ②⑦）：运营手动拿卡付款后，按 RUNBOOK 用
 * `POST /api/v1/admin/card-retirement/confirm` 把卡标 RETIRED，reason 里带 `manual-used`
 * 标识——3336 就是这么标的（`retire-legacy-cards:highvcc-manual-used ... paid ... manually`）。
 * 判据只认这个英文标识，**不认自然语言「手动」**：否则既漏 3336（英文 reason），又会误伤早期
 * 「手动测试卡」（0237/0601 的 reason 解码后含「手动」但不是手动用卡付款）。2026-09-18 只读实查：
 * 全部 23 张 RETIRED override 里这条 REGEXP 只命中 3336。
 */
export const MANUAL_USE_REASON_REGEXP = 'manual-used|manual used|manually';

export const CountFinding = Object.freeze({
  MATCHED: 'MATCHED',
  PENDING_MANUAL_REGISTRATION: 'PENDING_MANUAL_REGISTRATION', // 已确认手动用卡、待补登记——不算差异（D-275 ②）
  UNEXPLAINED_CHARGE: 'UNEXPLAINED_CHARGE',                   // 无主扣款——是差异、进报告、不隐藏、先不升级（D-275 ②）
  LEDGER_AHEAD: 'LEDGER_AHEAD',
  AWAITING_RESOLUTION: 'AWAITING_RESOLUTION',
  UNKNOWN_STATUS: 'UNKNOWN_STATUS'
});

export const AmountFinding = Object.freeze({
  UNVERIFIABLE: 'UNVERIFIABLE', // 没有可验证的期初入卡金额 → 不判异常也不判一致（D-275 ①，D-274）
  MATCHED: 'MATCHED',           // 仅当这张卡有 Lemon 核实过的期初基准且对得上
  AMOUNT_DIFF: 'AMOUNT_DIFF'    // 仅当有可验证基准且对不上
});

/** 为什么这张卡的金额「无法核对」——给报告解释，不替它下结论。 */
export const UnverifiableReason = Object.freeze({
  NO_VERIFIABLE_BASELINE: 'NO_VERIFIABLE_BASELINE', // funded_amount 是下单额不是入卡额（D-274），无独立入金凭证
  UNREADABLE_BALANCE: 'UNREADABLE_BALANCE',         // 余额读不出
  NEGATIVE_BALANCE: 'NEGATIVE_BALANCE'              // 余额为负、含义未知——明确标未知，不取绝对值（F-53）
});

// 进「需要看」的差异。已确认手动（PENDING_MANUAL_REGISTRATION）与无法核对（UNVERIFIABLE）不在其列。
const REAL_DISCREPANCIES = new Set([
  CountFinding.LEDGER_AHEAD, CountFinding.UNKNOWN_STATUS,
  CountFinding.UNEXPLAINED_CHARGE, AmountFinding.AMOUNT_DIFF
]);

// 够格把「连续两天还在」升成 critical 的差异。无主扣款先不升级（D-275 ②：保留差异属性、先不升级推送）。
const CRITICAL_ELIGIBLE_FINDINGS = new Set([
  CountFinding.LEDGER_AHEAD, CountFinding.UNKNOWN_STATUS, AmountFinding.AMOUNT_DIFF
]);

export function isRealDiscrepancy(finding) {
  return REAL_DISCREPANCIES.has(finding);
}

export function isCriticalEligibleFinding(finding) {
  return CRITICAL_ELIGIBLE_FINDINGS.has(finding);
}

/**
 * 卡余额的**有符号**整数分。读不出返回 null；负数保留符号（F-53：余额不取绝对值——
 * 流水判据 `absoluteAmountCents` 归一化的是消费方向，不能推广到余额；负债/透支变正余额会
 * 把「真实少了 20 块」算成「正好对上」）。
 */
export function signedAmountCents(amount) {
  const text = String(amount ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * 一张卡的两种对账。纯函数，方便对着真实行做单测。
 *
 * `transactions` 是这张卡的全部流水行（原始库行形状）；`ledgerConsumed` 是账本里确认消费的条数，
 * `ledgerReconciliation` 是「付款未知、资金锁着」的占位条数。
 * `manualUseRegistered` 为 true 表示这张卡已登记为运营手动用卡（RETIRED override + manual-used）。
 * `verifiableBaselineCents` 是这张卡经核实的期初入卡金额（整数分）；给了才做金额核对，否则一律无法核对。
 */
export function reconcileCard({
  card, transactions = [], ledgerConsumed = 0, ledgerReconciliation = 0,
  manualUseRegistered = false, verifiableBaselineCents = null
}) {
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
  // （生产 2 行，都在 hnskj 的 1013/4643 上）。确认消费只数 CONSUMED，占位单列 AWAITING_RESOLUTION。
  const ledgerUsed = ledgerConsumed + ledgerReconciliation;
  let countFinding = CountFinding.MATCHED;
  if (unknownStatus > 0) {
    countFinding = CountFinding.UNKNOWN_STATUS;
  } else if (providerCharges > ledgerUsed) {
    // 卡台扣得比账本多：已登记手动用卡 → 待登记（不算差异）；否则无主扣款（是差异，D-275 ②）。
    countFinding = manualUseRegistered
      ? CountFinding.PENDING_MANUAL_REGISTRATION
      : CountFinding.UNEXPLAINED_CHARGE;
  } else if (ledgerConsumed > providerCharges) {
    countFinding = CountFinding.LEDGER_AHEAD;
  } else if (ledgerReconciliation > 0 && ledgerUsed > providerCharges) {
    countFinding = CountFinding.AWAITING_RESOLUTION;
  }

  // 金额：默认无法核对（D-275 ①）。只有拿到可验证期初基准、余额可读且非负，才真去比。
  const fundedCents = signedAmountCents(card.funded_amount);   // 仅作观察值展示，有符号，不参与判断
  const balanceCents = signedAmountCents(card.current_balance); // 有符号（F-53）
  const spentCents = chargeCents + chargebackCents;
  let amountFinding = AmountFinding.UNVERIFIABLE;
  let unverifiableReason = UnverifiableReason.NO_VERIFIABLE_BASELINE;
  let expectedCents = null;
  let deltaCents = null;
  if (balanceCents === null) {
    unverifiableReason = UnverifiableReason.UNREADABLE_BALANCE;
  } else if (balanceCents < 0) {
    unverifiableReason = UnverifiableReason.NEGATIVE_BALANCE;
  } else if (verifiableBaselineCents != null) {
    expectedCents = verifiableBaselineCents - spentCents;
    deltaCents = balanceCents - expectedCents;
    amountFinding = deltaCents === 0 ? AmountFinding.MATCHED : AmountFinding.AMOUNT_DIFF;
    unverifiableReason = null;
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
      unverifiableReason,
      funded: fundedCents === null ? null : fromCents(fundedCents),
      charged: fromCents(chargeCents),
      chargebacks: fromCents(chargebackCents),
      balance: balanceCents === null ? null : fromCents(balanceCents),
      expected: expectedCents === null ? null : fromCents(expectedCents),
      delta: deltaCents === null ? null : fromCents(deltaCents),
      negativeRows,
      manualUseRegistered
    }
  };
}

/** 差异指纹：卡 + 两个结论。用它判断「同一个差异是不是连续两天都在」。 */
export function fingerprintOf(card) {
  return `${card.cardId}:${card.count.finding}:${card.amount.finding}`;
}

/** 报告的 UTC 日期（周期标识），「同日重跑正式批次幂等」靠它。 */
export function utcDateOf(date) {
  return date.toISOString().slice(0, 10);
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
                WHERE l.card_id = c.id AND l.status = 'RECONCILIATION') AS ledger_reconciliation,
              EXISTS (SELECT 1 FROM card_operational_overrides o
                WHERE o.provider_account_id = c.provider_account_id
                  AND BINARY o.external_card_id = BINARY c.external_card_id
                  AND o.allocation_policy = 'RETIRED'
                  AND LOWER(o.reason) REGEXP '${MANUAL_USE_REASON_REGEXP}') AS manual_use_registered
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
   * 跑一次日对账。`persist` 为 false（只读 GET / dry-run）时不写指纹，且**不推进**「连续两次」——
   * 直接沿用上一个正式批次已经算好的 persistent 结论。只有 `persist:true` 的正式批次推进连续性，
   * 同日重跑幂等（D-275 ③，F-50）。
   */
  async function run({ persist = true } = {}) {
    const now = clock();
    const [cards, transactionsByCard, previous] = await Promise.all([
      loadCards(), loadTransactions(), readLastReport()
    ]);

    const results = cards.map((card) => reconcileCard({
      card,
      transactions: transactionsByCard.get(card.id) || [],
      ledgerConsumed: Number(card.ledger_consumed) || 0,
      ledgerReconciliation: Number(card.ledger_reconciliation) || 0,
      manualUseRegistered: Number(card.manual_use_registered) === 1
    }));

    const realDiscrepancies = results.filter(
      (card) => isRealDiscrepancy(card.count.finding) || isRealDiscrepancy(card.amount.finding)
    );

    // 「连续两次」的连续性只由正式批次推进；只读沿用上一个正式批次的结论（D-275 ③）。
    const today = utcDateOf(now);
    let persistentFingerprints;
    if (persist) {
      if (previous?.date === today) {
        // 同日重跑正式批次：幂等，不把当天的差异错当成「连续两天」。
        persistentFingerprints = new Set(previous.persistentFingerprints || []);
      } else {
        const prevDiscrepancies = new Set(previous?.discrepancyFingerprints || []);
        persistentFingerprints = new Set(
          realDiscrepancies.map(fingerprintOf).filter((fp) => prevDiscrepancies.has(fp))
        );
      }
    } else {
      persistentFingerprints = new Set(previous?.persistentFingerprints || []);
    }

    const discrepancies = realDiscrepancies.map((card) => {
      const fingerprint = fingerprintOf(card);
      return { ...card, fingerprint, persistent: persistentFingerprints.has(fingerprint) };
    });
    const pendingRegistration = results.filter(
      (card) => card.count.finding === CountFinding.PENDING_MANUAL_REGISTRATION
    );
    const unexplainedCharges = results.filter(
      (card) => card.count.finding === CountFinding.UNEXPLAINED_CHARGE
    );
    const unverifiableAmount = results.filter(
      (card) => card.amount.finding === AmountFinding.UNVERIFIABLE
    );

    // 只有「够格升级」的差异连续两天在，才升 critical。无主扣款连续也不升（D-275 ②）。
    const persistentCriticalCount = discrepancies.filter(
      (card) => card.persistent
        && (isCriticalEligibleFinding(card.count.finding) || isCriticalEligibleFinding(card.amount.finding))
    ).length;

    const retirementList = await retirement.list();
    const report = {
      readOnly: true,
      generatedAt: now.toISOString(),
      reconciliationDate: today,
      cardCount: results.length,
      discrepancyCount: discrepancies.length,
      persistentCount: persistentCriticalCount,
      pendingRegistrationCount: pendingRegistration.length,
      unexplainedChargeCount: unexplainedCharges.length,
      unverifiableAmountCount: unverifiableAmount.length,
      retirementDueCount: retirementList.due.length,
      discrepancies,
      pendingRegistration,
      unexplainedCharges,
      cards: results
    };

    if (persist) {
      await writeLastReport({
        date: today,
        generatedAt: report.generatedAt,
        discrepancyFingerprints: discrepancies.map((card) => card.fingerprint),
        persistentFingerprints: [...persistentFingerprints]
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
  const persistentNote = report.persistentCount
    ? `（其中 ${report.persistentCount} 张连续两天还在，要处理）` : '';
  lines.push(`对账 ${report.cardCount} 张卡：差异 ${report.discrepancyCount} 张${persistentNote}。`);
  if (report.unexplainedChargeCount) {
    lines.push(`无主扣款 ${report.unexplainedChargeCount} 张：卡台扣了、账本没记、也没登记手动用卡，进报告待核。`);
  }
  if (report.pendingRegistrationCount) {
    lines.push(`已登记手动用卡的 ${report.pendingRegistrationCount} 张：待补进账本（第⑥块）。`);
  }
  if (report.unverifiableAmountCount) {
    lines.push(`金额无法核对 ${report.unverifiableAmountCount} 张：没有可信的期初入卡金额，本轮只对次数。`);
  }
  lines.push(`待销到期 ${report.retirementDueCount} 张${report.retirementDueCount ? '，到存活期可以去卡台删了。' : '。'}`);
  return lines.join('');
}

/** 固定的对账汇总 dedupe_key：一条「当前对账状态」，有差异就更新、没差异就 RESOLVE，不按天堆积（F-54）。 */
export const RECON_ALERT_KEY = 'daily-reconciliation';

/**
 * 每日汇总告警要做的动作（F-54）。收窄前按 UTC 日期换 dedupe_key，导致「昨天 OPEN、今天正常」时
 * 昨天那条一直挂着（resolve 传的是今天的新 key，关不掉昨天）。改成**固定 key**：今天没差异就
 * RESOLVE 掉这一条（把昨天的收掉），有差异就 upsert 覆盖同一行。日期留档进标题/文案，不进 key。
 */
export function reconciliationAlertPlan(report) {
  const hasSomething = report.discrepancyCount > 0
    || report.pendingRegistrationCount > 0
    || report.unexplainedChargeCount > 0
    || report.retirementDueCount > 0;
  if (!hasSomething) return { action: 'resolve', key: RECON_ALERT_KEY };
  return {
    action: 'upsert',
    key: RECON_ALERT_KEY,
    severity: report.persistentCount > 0 ? 'critical' : 'info',
    title: report.persistentCount > 0
      ? `对账差异连续两天还在（${report.reconciliationDate}）`
      : `今日对账汇总（${report.reconciliationDate}）`,
    message: summaryMessage(report)
  };
}
