import crypto from 'node:crypto';
import { commitCardTransactionsForCard } from '../db/repositories/card-transaction-repository.js';
import { recordProviderCall } from '../providers/provider-call-recorder.js';
import { createCardStockService, mapStockCard } from './card-stock-service.js';
import { readAllCardTransactions } from './card-transaction-reader.js';

/**
 * 只读同步一张 hnskj 卡：卡详情 1 次 + 交易流水 ≥1 页（新卡通常 1 页），写
 * card_transactions / cards（余额、last_transaction_synced_at），再 register 回库存。
 *
 * 这是定时 runner（card-read-sync-runner）和分卡时「当场同步这一张」（面二⑨，
 * D-266）共用的同一段实现：以前 runner 自己内联了一份，分卡那边只会「排一条 job
 * 等 runner 领」；现在两处调同一个函数，请求数、记账方式、落库路径完全一致。
 *
 * 每次外部读都经 recordProviderCall 记账（provider_calls），requestKey 由调用方给出且
 * 对同一 attempt 唯一。
 */
export async function syncHnskjCardReadOnly({
  pool, provider, stock, card, orderId = null, requestKeyPrefix, attemptNo = 1,
  recordCall = recordProviderCall
}) {
  if (!pool) throw new TypeError('pool is required');
  if (!provider || typeof provider.card !== 'function' || typeof provider.transactions !== 'function') {
    throw new TypeError('hnskj read provider is required');
  }
  if (!stock || typeof stock.register !== 'function') throw new TypeError('stock service is required');
  const prefix = String(requestKeyPrefix || '').trim();
  if (!prefix) throw new TypeError('requestKeyPrefix is required');
  const providerCardId = String(card?.providerCardId || '').trim();
  if (!card?.id || !providerCardId) throw new TypeError('card.id and card.providerCardId are required');

  const detail = await recordCall({
    pool, orderId, provider: 'hnskj',
    operation: 'card_reconciliation_detail', requestKey: `${prefix}:detail`, attemptNo,
    action: () => provider.card(providerCardId),
    summarize: (value) => {
      const data = value?.data?.card ?? value?.data ?? {};
      return { providerCardId, status: data.status || null,
        currentBalance: data.cardBalance ?? data.currentBalance ?? null, currency: data.currency || null };
    }
  });
  const mapped = mapStockCard(detail, { providerCardId,
    cardTypeId: card.cardTypeId ?? null, fundedAmount: card.fundedAmount ?? null,
    minimumRequiredBalance: card.minimumRequiredBalance ?? null });
  let pages = 0;
  const transactions = await readAllCardTransactions({
    fetchPage: (page, pageSize) => {
      pages += 1;
      return recordCall({
        pool, orderId, provider: 'hnskj',
        operation: 'card_reconciliation_transactions',
        requestKey: `${prefix}:transactions:${page}`, attemptNo,
        action: () => provider.transactions(providerCardId, { page, pageSize }),
        summarize: (value) => ({ providerCardId, page: value.data.page,
          count: value.data.transactions.length, total: value.data.total,
          types: [...new Set(value.data.transactions.map((item) => item.type))],
          statuses: [...new Set(value.data.transactions.map((item) => item.status))] })
      });
    }
  });
  await commitCardTransactionsForCard(pool, { cardId: card.id, orderId, transactions, cardSnapshot: mapped });
  await stock.register(mapped);
  return { transactionCount: transactions.length, requestCount: 1 + pages, mapped };
}

/**
 * 分卡时用的「当场同步这一张」入口。返回一个函数：(candidate, { orderId, attemptNo }) → 同步结果。
 * candidate 来自 workflow.findStaleInventoryCandidate（只挑 supports_api_sync 的账户、
 * 非 MANUAL_IMPORT、流水过期 15 分钟以上、连续失败 < 5 的卡）。
 *
 * 成功：cards.sync_consecutive_failures 归零；失败：+1（连续 5 次后候选查询不再挑它，
 * 直到下一次定时同步成功把计数清零），错误原样抛给 handler——handler 只延后重试，
 * 不重开卡、不换卡台。
 */
export function createOnDemandCardSync({ pool, provider, sessionEncryptionKey, panHmacKey = null,
  recordCall = recordProviderCall, idFactory = () => crypto.randomUUID(),
  stockFactory = (providerAccountId) => createCardStockService({ pool, sessionEncryptionKey, panHmacKey, providerAccountId }) }) {
  if (!pool) throw new TypeError('pool is required');
  const stocks = new Map();
  function stockFor(providerAccountId) {
    const key = String(providerAccountId);
    if (!stocks.has(key)) stocks.set(key, stockFactory(key));
    return stocks.get(key);
  }
  return async function syncCardOnDemand(candidate, { orderId = null, attemptNo = 1 } = {}) {
    if (!candidate?.id || !candidate?.providerCardId || !candidate?.providerAccountId) {
      throw new TypeError('candidate.id, providerCardId and providerAccountId are required');
    }
    if (!provider) {
      const error = new Error('hnskj read provider is not configured for on-demand card sync');
      error.code = 'CARD_SYNC_UNAVAILABLE';
      throw error;
    }
    const prefix = `order-demand-sync:${orderId || 'no-order'}:${candidate.id}:${idFactory()}`;
    try {
      const result = await syncHnskjCardReadOnly({
        pool, provider, stock: stockFor(candidate.providerAccountId), card: candidate,
        orderId, requestKeyPrefix: prefix, attemptNo, recordCall
      });
      await pool.query(
        `UPDATE cards SET sync_consecutive_failures = 0, last_successful_sync_at = CURRENT_TIMESTAMP(3),
           updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`, [candidate.id]
      );
      return { ...result, cardId: candidate.id, providerCardId: candidate.providerCardId };
    } catch (error) {
      await pool.query(
        `UPDATE cards SET sync_consecutive_failures = sync_consecutive_failures + 1,
           updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`, [candidate.id]
      ).catch(() => undefined);
      throw error;
    }
  };
}
