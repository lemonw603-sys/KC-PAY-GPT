import { readAllCardTransactions } from '../../v1/src/services/card-transaction-reader.js';
import { createHighvccSnapshotSyncService } from '../../v1/src/services/highvcc-snapshot-sync-service.js';

/**
 * 第④步（D-268 ①，Lemon 2026-09-18 批）：MANUAL_IMPORT（备用卡台 A / highvcc）卡的「卡台侧扣款」证据源。
 * listPurchases 读 v1 `card_transactions`（T1 每小时随快照入库）；refresh 在窗口内无候选时用 token
 * 再拉一次（时段外的突发例外），token 失效抛 `HIGHVCC_TOKEN_EXPIRED`，由 reader 记进证据、不谎报匹配。
 */
export function createCardLedgerSource({ pool, refresh = null } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool.query is required');
  if (refresh != null && typeof refresh !== 'function') throw new TypeError('refresh must be a function');
  return {
    async listPurchases({ cardId, since = null, until = null } = {}) {
      if (!cardId) throw new TypeError('cardId is required');
      const clauses = ['card_id = ?'];
      const params = [String(cardId)];
      if (since) { clauses.push('(occurred_at >= ? OR occurred_at IS NULL)'); params.push(new Date(since)); }
      if (until) { clauses.push('(occurred_at <= ? OR occurred_at IS NULL)'); params.push(new Date(until)); }
      const [rows] = await pool.query(
        `SELECT provider_transaction_id, transaction_type, status, amount, currency, original_amount, original_currency,
                merchant_name, settlement_status, trade_time_raw, occurred_at, first_seen_at, raw_hash
           FROM card_transactions WHERE ${clauses.join(' AND ')} ORDER BY first_seen_at ASC, id ASC LIMIT 200`, params,
      );
      return rows;
    },
    ...(refresh ? { refresh } : {}),
  };
}

/** highvcc 流水再拉一次并归卡入库（与每日时段那趟同一段实现）。 */
export function createHighvccLedgerRefresh({ pool, encryptionKey, panHmacKey }) {
  let service = null;
  return async () => {
    service ||= createHighvccSnapshotSyncService({ pool, encryptionKey, panHmacKey });
    const result = await service.syncTransactions();
    return { written: result.written, fetched: result.fetched, unmatchedCount: result.unmatchedCount };
  };
}

function decimal(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const micros = (BigInt(match[2]) * 1_000_000n) + BigInt((match[3] || '').padEnd(6, '0'));
  return match[1] ? -micros : micros;
}

function successful(value) {
  return ['SUCCESS', 'SUCCEEDED', 'SETTLED', 'COMPLETED', 'COMPLETE']
    .includes(String(value || '').trim().toUpperCase());
}

function plausiblePlusAmount(transaction) {
  const currency = String(transaction?.originalCurrency || transaction?.currency || '').trim().toUpperCase();
  const amount = decimal(transaction?.originalAmount ?? transaction?.amount);
  if (amount == null) return false;
  const absolute = amount < 0n ? -amount : amount;
  if (currency === 'USD') return absolute >= 14_000_000n && absolute <= 22_000_000n;
  if (currency === 'PHP') return absolute >= 900_000_000n && absolute <= 1_200_000_000n;
  return false;
}

function plausibleMerchant(transaction) {
  const merchant = String(transaction?.merchantName || '').trim();
  const type = String(transaction?.type || '').trim().toUpperCase();
  if (merchant) return /openai|chatgpt/i.test(merchant);
  return ['PURCHASE', 'PAYMENT', 'CONSUMPTION', 'DEBIT'].includes(type);
}

function withinIntentWindow(transaction, intentAt, matchWindowMs) {
  if (!intentAt) return true;
  const observed = Date.parse(String(transaction?.tradeTime || ''));
  return Number.isFinite(observed)
    && observed >= intentAt.getTime() - 5 * 60_000
    && observed <= intentAt.getTime() + matchWindowMs + 5 * 60_000;
}

/**
 * Route-aware transaction evidence used only after Browser/Plus confirmation.
 *
 * 第④步（面三③ 表二，D-248）：MANUAL_IMPORT（备用卡台 A / highvcc）的卡也要有真正的
 * 「卡台侧扣款」证据。以前这一路是个假 marker（read() 自己造一条 MANUAL_CARD_BROWSER_CONFIRMED，
 * reconcile 恒匹配）——等于卡台那一路永远说「对」，D-248 说的「谎报」就来自这里。
 * 现在：必须注入 `ledgerSource`（读 v1 `card_transactions`，T1 已入库；可选 `refresh()` 在窗口内
 * 无候选时用 token 再拉一次——时段外的「突发例外」，token 失效就把 tokenExpired 带回证据），
 * 按与 hnskj 同一套规则（成功状态 + OpenAI 商户 + Plus 金额 + 提交时间窗）判。假 marker 已删
 * （D-268 ① Lemon 2026-09-18 批工厂注入后删）。
 */
export class BrowserCardTransactionReader {
  constructor({ sourceKind, provider = null, providerCardId = null, runId,
    submitIntentAt = null, matchWindowMs = 3_600_000, ledgerSource = null, cardId = null } = {}) {
    this.sourceKind = String(sourceKind || '').trim().toUpperCase();
    this.provider = provider;
    this.providerCardId = providerCardId == null ? null : String(providerCardId).trim();
    this.cardId = cardId == null ? null : String(cardId).trim();
    this.ledgerSource = ledgerSource;
    this.runId = String(runId || '').trim();
    this.submitIntentAt = submitIntentAt == null ? null : new Date(submitIntentAt);
    if (!Number.isInteger(matchWindowMs) || matchWindowMs < 30_000 || matchWindowMs > 3_600_000) {
      throw new TypeError('matchWindowMs must be between 30000 and 3600000');
    }
    this.matchWindowMs = matchWindowMs;
    if (!this.runId) throw new TypeError('runId is required');
    if (this.submitIntentAt && !Number.isFinite(this.submitIntentAt.getTime())) throw new TypeError('submitIntentAt is invalid');
    if (this.sourceKind === 'HNSKJ') {
      if (!provider || typeof provider.transactions !== 'function' || !this.providerCardId || !this.submitIntentAt) {
        throw new TypeError('HNSKJ provider, providerCardId and submitIntentAt are required');
      }
    } else if (this.sourceKind !== 'MANUAL_IMPORT') {
      throw new TypeError('sourceKind must be HNSKJ or MANUAL_IMPORT');
    } else if (!ledgerSource || typeof ledgerSource.listPurchases !== 'function' || !this.cardId || !this.submitIntentAt) {
      throw new TypeError('MANUAL_IMPORT evidence requires ledgerSource.listPurchases, cardId and submitIntentAt');
    }
  }

  #ledgerWindow() {
    const since = this.submitIntentAt ? new Date(this.submitIntentAt.getTime() - 5 * 60_000) : null;
    const until = this.submitIntentAt ? new Date(this.submitIntentAt.getTime() + this.matchWindowMs + 5 * 60_000) : null;
    return { cardId: this.cardId, since, until };
  }

  #fromLedgerRow(row) {
    return {
      kind: 'LEDGER_TRANSACTION',
      id: row.provider_transaction_id ?? row.providerTransactionId ?? null,
      type: row.transaction_type ?? row.type ?? 'PURCHASE',
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      originalAmount: row.original_amount ?? row.originalAmount ?? null,
      originalCurrency: row.original_currency ?? row.originalCurrency ?? null,
      merchantName: row.merchant_name ?? row.merchantName ?? null,
      settlementStatus: row.settlement_status ?? row.settlementStatus ?? null,
      tradeTime: row.occurred_at ?? row.occurredAt ?? row.trade_time_raw ?? row.tradeTime ?? null,
      rawHash: row.raw_hash ?? row.rawHash ?? null,
    };
  }

  async read() {
    if (this.sourceKind === 'MANUAL_IMPORT') {
      const window = this.#ledgerWindow();
      let rows = await this.ledgerSource.listPurchases(window);
      let refreshed = null;
      const hasCandidate = (list) => list.some((row) => this.#isPlusPurchase(this.#fromLedgerRow(row)));
      if (!hasCandidate(rows) && typeof this.ledgerSource.refresh === 'function') {
        try {
          refreshed = { ok: true, ...(await this.ledgerSource.refresh(window) || {}) };
          rows = await this.ledgerSource.listPurchases(window);
        } catch (error) {
          refreshed = { ok: false, code: error?.code || error?.kind || 'LEDGER_REFRESH_FAILED',
            tokenExpired: ['HIGHVCC_TOKEN_EXPIRED', 'HIGHVCC_TOKEN_MISSING'].includes(error?.code) };
        }
      }
      const transactions = rows.map((row) => this.#fromLedgerRow(row));
      if (refreshed) transactions.refreshed = refreshed;
      return transactions;
    }
    return readAllCardTransactions({
      fetchPage: (page, pageSize) => this.provider.transactions(this.providerCardId, { page, pageSize }),
    });
  }

  #isPlusPurchase(item) {
    return successful(item.status) && plausibleMerchant(item) && plausiblePlusAmount(item)
      && withinIntentWindow(item, this.submitIntentAt, this.matchWindowMs);
  }

  async reconcile({ transactions }) {
    if (!Array.isArray(transactions)) return { matched: false, reasonCode: 'TRANSACTION_EVIDENCE_INVALID' };
    if (this.sourceKind === 'MANUAL_IMPORT') {
      const candidates = transactions.filter((item) => item?.kind === 'LEDGER_TRANSACTION' && this.#isPlusPurchase(item));
      const refreshed = transactions.refreshed || null;
      return {
        matched: candidates.length === 1,
        evidenceKind: 'CARD_LEDGER_TRANSACTION',
        candidateCount: candidates.length,
        transactionHash: candidates.length === 1 ? candidates[0].rawHash : null,
        evidence: {
          source: 'card_transactions', candidates: candidates.map((c) => ({ id: c.id, amount: c.amount,
            currency: c.currency, originalAmount: c.originalAmount, originalCurrency: c.originalCurrency,
            merchantName: c.merchantName, at: c.tradeTime })),
          refreshed, tokenExpired: Boolean(refreshed?.tokenExpired),
        },
      };
    }
    const candidates = transactions.filter((item) => successful(item.status)
      && plausibleMerchant(item) && plausiblePlusAmount(item)
      && withinIntentWindow(item, this.submitIntentAt, this.matchWindowMs));
    return {
      matched: candidates.length === 1,
      evidenceKind: 'HNSKJ_TRANSACTION',
      candidateCount: candidates.length,
      transactionHash: candidates.length === 1 ? candidates[0].rawHash : null,
    };
  }
}

export class BillingAddressEnrichedCardMaterialSource {
  constructor({ cardSource, billingAddressSource, resolveBillingAddressRef = async (ref) => ref } = {}) {
    if (!cardSource || typeof cardSource.load !== 'function') throw new TypeError('cardSource.load is required');
    if (!billingAddressSource || typeof billingAddressSource.load !== 'function') throw new TypeError('billingAddressSource.load is required');
    if (typeof resolveBillingAddressRef !== 'function') throw new TypeError('resolveBillingAddressRef is required');
    this.cardSource = cardSource;
    this.billingAddressSource = billingAddressSource;
    this.resolveBillingAddressRef = resolveBillingAddressRef;
  }

  async load(cardRef) {
    const material = await this.cardSource.load(cardRef);
    if (material?.billingAddress) return material;
    return { ...material, billingAddress: await this.billingAddressSource.load(
      await this.resolveBillingAddressRef(cardRef),
    ) };
  }
}
