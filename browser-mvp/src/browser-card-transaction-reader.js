import { readAllCardTransactions } from '../../v1/src/services/card-transaction-reader.js';

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
 * Manual cards have no provider API, so their accepted evidence is explicitly
 * the Browser-confirmed marker plus the shared consumption ledger.
 */
export class BrowserCardTransactionReader {
  constructor({ sourceKind, provider = null, providerCardId = null, runId,
    submitIntentAt = null, matchWindowMs = 3_600_000 } = {}) {
    this.sourceKind = String(sourceKind || '').trim().toUpperCase();
    this.provider = provider;
    this.providerCardId = providerCardId == null ? null : String(providerCardId).trim();
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
    }
  }

  async read() {
    if (this.sourceKind === 'MANUAL_IMPORT') {
      return [{ kind: 'MANUAL_CARD_BROWSER_CONFIRMED', runId: this.runId }];
    }
    return readAllCardTransactions({
      fetchPage: (page, pageSize) => this.provider.transactions(this.providerCardId, { page, pageSize }),
    });
  }

  async reconcile({ transactions }) {
    if (!Array.isArray(transactions)) return { matched: false, reasonCode: 'TRANSACTION_EVIDENCE_INVALID' };
    if (this.sourceKind === 'MANUAL_IMPORT') {
      const markers = transactions.filter((item) => item?.kind === 'MANUAL_CARD_BROWSER_CONFIRMED'
        && item.runId === this.runId);
      return { matched: markers.length === 1, evidenceKind: 'BROWSER_PLUS_AND_LEDGER' };
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
