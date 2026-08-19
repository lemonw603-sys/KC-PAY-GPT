import crypto from 'node:crypto';
import { classifyCardTransaction } from '../domain/card-transaction-classification.js';

export class CardTransactionReadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CardTransactionReadError';
    this.code = code;
    this.kind = code;
    this.retryable = false;
  }
}

export async function readAllCardTransactions({
  fetchPage,
  pageSize = 50,
  maxPages = 1000
}) {
  const transactions = [];
  let page = 1;
  let total = null;
  while (total == null || transactions.length < total) {
    const envelope = await fetchPage(page, pageSize);
    const hasPage = envelope.data.page != null || envelope.data.pageSize != null;
    if (!Number.isInteger(envelope.data.total) || envelope.data.total < 0 || (
      hasPage && (
        !Number.isInteger(envelope.data.page) || envelope.data.page !== page
        || !Number.isInteger(envelope.data.pageSize) || envelope.data.pageSize <= 0
      )
    )) {
      throw new CardTransactionReadError(
        'Invalid transaction pagination metadata',
        'TRANSACTION_PAGINATION_INVALID'
      );
    }
    total = envelope.data.total;
    transactions.push(...envelope.data.transactions.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      amount: String(item.amount),
      currency: item.currency,
      fee: item.fee == null ? null : String(item.fee),
      tradeTime: item.tradeTime || null,
      relatedTxnId: item.relatedTxnId || null,
      settlementStatus: item.settlementStatus || null,
      originalAmount: item.originalAmount == null ? null : String(item.originalAmount),
      originalCurrency: item.originalCurrency || null,
      merchantName: item.merchantName || null,
      merchantCountry: item.merchantCountry || null,
      merchantMcc: item.merchantMcc || null,
      classification: classifyCardTransaction(item),
      rawHash: crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex')
    })));
    if (envelope.data.transactions.length === 0 || transactions.length >= total) break;
    if (!hasPage) {
      throw new CardTransactionReadError(
        'Provider returned an incomplete transaction collection without pagination metadata',
        'TRANSACTION_PAGINATION_UNSUPPORTED'
      );
    }
    if (page >= maxPages) {
      throw new CardTransactionReadError(
        'Transaction pagination exceeded safety limit',
        'TRANSACTION_PAGINATION_LIMIT'
      );
    }
    page += 1;
  }
  return transactions;
}
