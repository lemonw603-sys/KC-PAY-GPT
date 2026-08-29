import { PublicApiError } from '../domain/public-api-error.js';

export const CARD_STOCK_RISK_CONFIRM_THRESHOLD = 10;
export const CARD_PROVIDER_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 1000;
// The read-only catalog timer runs every five minutes. This wider window is
// for informational admin display only; all write runners still require the
// strict two-minute default and refresh immediately before any write.
export const CARD_PROVIDER_STATUS_MAX_AGE_MS = 6 * 60 * 1000;

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid card provider ${name}`);
  return number;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizeCardType(item) {
  return {
    id: String(item.id),
    name: String(item.cardType),
    country: String(item.cardCountry),
    binPrefix: String(item.binPrefix),
    effectiveCardFee: String(item.effectiveCardFeeUsdt),
    effectiveFeeRate: String(item.effectiveFeeRate),
    minimumAmount: String(item.minAmount),
    maximumAmount: String(item.maxAmount),
    minimumAccountBalance: String(item.minBalanceUsdt),
    requireMinimumAccountBalance: Number(item.requireMinBalance) === 1,
    consumeRate: String(item.consumeRate),
    chargebackFee: String(item.chargebackFee)
  };
}

export function normalizeProviderSnapshot({ cardTypes, accountBalance, checkedAt = new Date() }) {
  return {
    provider: 'hnskj',
    syncedAt: checkedAt instanceof Date ? checkedAt.toISOString() : String(checkedAt),
    purchaseEnabled: Boolean(cardTypes.data.purchaseEnabled),
    accountBalance: String(accountBalance.data.balance),
    currency: String(accountBalance.data.currency || 'USD'),
    exchangeRate: String(accountBalance.data.exchangeRate || cardTypes.data.exchangeRate || '1'),
    cardLimit: {
      current: Number(cardTypes.data.cardLimit.currentCount),
      maximum: Number(cardTypes.data.cardLimit.maxLimit),
      remaining: Number(cardTypes.data.cardLimit.remaining)
    },
    cardTypes: cardTypes.data.cardTypes.map(normalizeCardType)
  };
}

export function providerSupportedCardTypeIds(snapshot, fallbackCardTypeId = null) {
  const advertised = (snapshot?.cardTypes || [])
    .map((item) => String(item?.id ?? '').trim())
    .filter(Boolean);
  if (advertised.length) return [...new Set(advertised)];
  const fallback = String(fallbackCardTypeId ?? '').trim();
  return fallback ? [fallback] : [];
}

export function evaluateCardStockRequest(snapshot, {
  cardTypeId,
  amount,
  count,
  expectedCardTypeName = null
}) {
  if (!snapshot?.purchaseEnabled) {
    throw new PublicApiError('Card purchasing is disabled by provider', {
      code: 'CARD_STOCK_PURCHASE_DISABLED', status: 409
    });
  }
  const selected = snapshot.cardTypes?.find((item) => String(item.id) === String(cardTypeId));
  if (!selected || (expectedCardTypeName && selected.name !== expectedCardTypeName)) {
    throw new PublicApiError('Configured card type is unavailable or changed', {
      code: 'CARD_STOCK_CARD_TYPE_UNAVAILABLE', status: 409
    });
  }
  const numericAmount = Number(amount);
  const numericCount = Number(count);
  const minimum = finite(selected.minimumAmount, 'minimum amount');
  const maximum = finite(selected.maximumAmount, 'maximum amount');
  if (!Number.isInteger(numericAmount) || numericAmount < minimum || numericAmount > maximum) {
    throw new PublicApiError(`Card amount must be between ${minimum} and ${maximum}`, {
      code: 'CARD_STOCK_AMOUNT_OUT_OF_RANGE', status: 400
    });
  }
  if (!Number.isSafeInteger(numericCount) || numericCount < 1) {
    throw new PublicApiError('Card stock count must be a positive integer', {
      code: 'CARD_STOCK_COUNT_OUT_OF_RANGE', status: 400
    });
  }
  const remaining = Number(snapshot.cardLimit?.remaining);
  if (!Number.isInteger(remaining) || remaining < numericCount) {
    throw new PublicApiError('Provider card limit is insufficient', {
      code: 'CARD_STOCK_LIMIT_INSUFFICIENT', status: 409
    });
  }
  const cardFee = finite(selected.effectiveCardFee, 'card fee');
  const feeRate = finite(selected.effectiveFeeRate, 'fee rate');
  const rateFeePerCard = roundMoney(numericAmount * feeRate);
  const totalPerCard = roundMoney(numericAmount + cardFee + rateFeePerCard);
  const balance = finite(snapshot.accountBalance, 'account balance');
  const minimumAccountBalance = selected.requireMinimumAccountBalance
    ? finite(selected.minimumAccountBalance, 'minimum account balance') : 0;
  let projectedBalance = balance;
  let affordableCount = 0;
  while (
    affordableCount < remaining
    && projectedBalance >= totalPerCard
    && projectedBalance >= minimumAccountBalance
  ) {
    affordableCount += 1;
    projectedBalance = roundMoney(projectedBalance - totalPerCard);
  }
  if (numericCount > affordableCount) {
    throw new PublicApiError('Provider account balance cannot safely fund this batch', {
      code: 'CARD_STOCK_BALANCE_INSUFFICIENT', status: 409
    });
  }
  const requestedProjectedBalance = roundMoney(balance - totalPerCard * numericCount);
  return {
    cardType: selected,
    count: numericCount,
    amount: numericAmount,
    cardFeePerCard: String(cardFee),
    rateFeePerCard: String(rateFeePerCard),
    totalPerCard: String(totalPerCard),
    estimatedPrincipal: String(roundMoney(numericAmount * numericCount)),
    estimatedTotal: String(roundMoney(totalPerCard * numericCount)),
    accountBalance: String(balance),
    projectedBalance: String(requestedProjectedBalance),
    affordableCount
  };
}

export async function readProviderSnapshot(pool) {
  const [rows] = await pool.query(
    `SELECT payload_json, synced_at FROM card_provider_snapshots
     WHERE provider = 'hnskj' LIMIT 1`
  );
  if (!rows.length) return null;
  const payload = typeof rows[0].payload_json === 'string'
    ? JSON.parse(rows[0].payload_json) : rows[0].payload_json;
  return { ...payload, syncedAt: new Date(rows[0].synced_at).toISOString() };
}

export function snapshotIsFresh(snapshot, {
  now = Date.now(), maxAgeMs = CARD_PROVIDER_SNAPSHOT_MAX_AGE_MS
} = {}) {
  const syncedAt = Date.parse(snapshot?.syncedAt || '');
  return Number.isFinite(syncedAt) && syncedAt <= now && now - syncedAt <= maxAgeMs;
}

export async function refreshProviderSnapshot(pool, provider, {
  checkedAt = new Date(),
  balanceSnapshotService = null,
  providerAccountId = '00000000-0000-4000-8000-000000000101'
} = {}) {
  const [cardTypes, accountBalance] = await Promise.all([
    provider.cardTypes(), provider.accountBalance()
  ]);
  const snapshot = normalizeProviderSnapshot({ cardTypes, accountBalance, checkedAt });
  if (balanceSnapshotService) {
    await balanceSnapshotService.recordSnapshot({
      providerAccountId,
      currency: snapshot.currency,
      availableBalance: snapshot.accountBalance,
      pendingBalance: accountBalance?.data?.pendingBalance == null
        ? null : String(accountBalance.data.pendingBalance),
      rawPayload: accountBalance,
      observedAt: checkedAt
    });
  }
  await pool.query(
    `INSERT INTO card_provider_snapshots (provider, payload_json, synced_at)
     VALUES ('hnskj', ?, ?)
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json),
       synced_at = VALUES(synced_at), updated_at = CURRENT_TIMESTAMP(3)`,
    [JSON.stringify(snapshot), checkedAt]
  );
  // Reuse the existing Bark outbox. Notify only on an observed balance change;
  // the dedupe key prevents repeated syncs from generating repeated notices.
  // The current snapshot has just been replaced, so read the preceding
  // immutable observation from the history table (if one exists).
  const [previousRows] = await pool.query(
    `SELECT available_balance, currency FROM provider_balance_snapshots
     WHERE provider_account_id = ? AND currency = ? AND observed_at < ?
     ORDER BY observed_at DESC LIMIT 1`, [providerAccountId, snapshot.currency, checkedAt]
  );
  const previousBalance = previousRows[0]?.available_balance == null
    ? null : String(previousRows[0].available_balance);
  if (previousBalance != null && previousBalance !== snapshot.accountBalance) {
    const providerCode = String(snapshot.provider || 'hnskj');
    const providerLabel = providerCode === 'hnskj' ? '当前卡台' : providerCode;
    const dedupeKey = `provider-balance-change:${providerCode}:${previousBalance}:${snapshot.accountBalance}`;
    await pool.query(
      `INSERT INTO operator_alerts
       (id, alert_type, dedupe_key, severity, title, message, status)
       VALUES (UUID(), 'PROVIDER_BALANCE_CHANGED', ?, 'info', '卡台余额发生变化', ?, 'OPEN')
       ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
         message = VALUES(message),
         status = IF(status = 'RESOLVED', 'OPEN', status),
         acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
      [dedupeKey, `${providerLabel}余额由 ${previousBalance} ${snapshot.currency} 变为 ${snapshot.accountBalance} ${snapshot.currency}。`]
    );
  }
  return snapshot;
}
