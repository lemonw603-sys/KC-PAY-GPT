import { PublicApiError } from '../domain/public-api-error.js';

export const CARD_STOCK_MAX_BATCH = 10;
export const CARD_PROVIDER_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 1000;

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
  if (!Number.isInteger(numericCount) || numericCount < 1 || numericCount > CARD_STOCK_MAX_BATCH) {
    throw new PublicApiError(`Card stock batch must contain 1-${CARD_STOCK_MAX_BATCH} cards`, {
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
    affordableCount < Math.min(remaining, CARD_STOCK_MAX_BATCH)
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

export async function refreshProviderSnapshot(pool, provider, { checkedAt = new Date() } = {}) {
  const [cardTypes, accountBalance] = await Promise.all([
    provider.cardTypes(), provider.accountBalance()
  ]);
  const snapshot = normalizeProviderSnapshot({ cardTypes, accountBalance, checkedAt });
  await pool.query(
    `INSERT INTO card_provider_snapshots (provider, payload_json, synced_at)
     VALUES ('hnskj', ?, ?)
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json),
       synced_at = VALUES(synced_at), updated_at = CURRENT_TIMESTAMP(3)`,
    [JSON.stringify(snapshot), checkedAt]
  );
  return snapshot;
}
