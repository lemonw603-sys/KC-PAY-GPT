import { commitCardTransactionsForCard } from '../db/repositories/card-transaction-repository.js';
import { mapStockCard } from './card-stock-service.js';

export async function reconcileNextCardFundingAttempt({
  pool,
  repository,
  provider,
  stock,
  providerAccountId,
  commitTransactions = commitCardTransactionsForCard
}) {
  const attempt = await repository.nextPending({ providerAccountId });
  if (!attempt) return { handled: false };

  // Balance detail is the cheapest authoritative first check. Do not fetch a
  // transaction page on every pending poll; fetch it once the balance proves
  // that the top-up has landed.
  const cardEnvelope = await provider.card(attempt.provider_card_id);
  const [[minimumRow]] = await pool.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key='default_minimum_required_card_balance' LIMIT 1`
  );
  const minimum = Number(minimumRow?.setting_value);
  if (!Number.isFinite(minimum) || minimum <= 0) {
    throw new Error('Minimum card balance is not configured');
  }
  const snapshot = mapStockCard(cardEnvelope, {
    providerCardId: attempt.provider_card_id,
    cardTypeId: attempt.card_type_id,
    fundedAmount: attempt.funded_amount,
    minimumRequiredBalance: minimum
  });
  if (snapshot.currentBalance == null) {
    throw new Error('Provider card balance is missing during reconciliation');
  }
  const settled = Number(snapshot.currentBalance) >= minimum;
  const transactionEnvelope = settled
    ? await provider.transactions(attempt.provider_card_id)
    : null;
  const transactions = transactionEnvelope?.data?.transactions || [];

  await commitTransactions(pool, {
    cardId: attempt.card_id,
    orderId: attempt.order_id || null,
    transactions,
    cardSnapshot: { currentBalance: snapshot.currentBalance, currency: snapshot.currency }
  });
  // The ACTIVE funding fence remains in place while stock.register() changes
  // the inventory classification, so another order cannot observe a funded
  // card before the funding ledger reaches SETTLED.
  await stock.register(snapshot);
  const result = await repository.reconcile({
    attemptId: attempt.id,
    currentBalance: snapshot.currentBalance,
    currency: snapshot.currency,
    responseSummary: { transactionCount: transactions.length }
  });
  return { handled: true, result };
}
