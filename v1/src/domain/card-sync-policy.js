export const CardSyncTier = Object.freeze({
  PROVISIONING: 'PROVISIONING',
  RECHARGE_PROCESSING: 'RECHARGE_PROCESSING',
  ASSIGNED: 'ASSIGNED',
  RECENT_TERMINAL: 'RECENT_TERMINAL',
  REFUND_WATCH: 'REFUND_WATCH',
  AVAILABLE: 'AVAILABLE',
  ARCHIVED: 'ARCHIVED',
  MANUAL: 'MANUAL'
});

const POLICY = Object.freeze({
  [CardSyncTier.RECHARGE_PROCESSING]: { priority: 10, intervalMs: 60_000 },
  [CardSyncTier.PROVISIONING]: { priority: 20, intervalMs: 60_000 },
  [CardSyncTier.ASSIGNED]: { priority: 30, intervalMs: 5 * 60_000 },
  [CardSyncTier.RECENT_TERMINAL]: { priority: 40, intervalMs: 60 * 60_000 },
  [CardSyncTier.AVAILABLE]: { priority: 50, intervalMs: 6 * 60 * 60_000 },
  [CardSyncTier.REFUND_WATCH]: { priority: 60, intervalMs: 24 * 60 * 60_000 },
  [CardSyncTier.ARCHIVED]: { priority: 70, intervalMs: 7 * 24 * 60 * 60_000 },
  [CardSyncTier.MANUAL]: { priority: 5, intervalMs: 0 }
});

export function normalizeCardSyncTier(value) {
  const tier = String(value || '').trim().toUpperCase();
  if (!Object.hasOwn(POLICY, tier)) throw new TypeError(`Unknown card sync tier: ${value}`);
  return tier;
}

export function cardSyncPriority(tier) {
  return POLICY[normalizeCardSyncTier(tier)].priority;
}

export function nextCardSyncAt({
  tier,
  now = new Date(),
  consecutiveFailures = 0,
  retryAfterMs = null,
  random = Math.random
}) {
  const normalized = normalizeCardSyncTier(tier);
  const base = POLICY[normalized].intervalMs;
  const failures = Math.max(0, Math.min(12, Math.trunc(Number(consecutiveFailures) || 0)));
  const exponential = failures === 0 ? base : Math.max(base, 60_000 * (2 ** (failures - 1)));
  const boundedBackoff = Math.min(exponential, 24 * 60 * 60_000);
  const providerDelay = retryAfterMs == null ? 0 : Math.max(0, Math.min(
    24 * 60 * 60_000,
    Math.trunc(Number(retryAfterMs) || 0)
  ));
  const delay = Math.max(boundedBackoff, providerDelay);
  const jitter = failures === 0 || delay === 0
    ? 0
    : Math.floor(delay * 0.2 * Math.max(0, Math.min(1, Number(random()) || 0)));
  return new Date(new Date(now).getTime() + delay + jitter);
}

export function initialSyncTier({ inventoryStatus, orderStatus = null }) {
  const inventory = String(inventoryStatus || '').toUpperCase();
  const order = String(orderStatus || '').toUpperCase();
  if (['SUBMITTING', 'RECHARGE_PROCESSING'].includes(order)) return CardSyncTier.RECHARGE_PROCESSING;
  if (inventory === 'PROVISIONING') return CardSyncTier.PROVISIONING;
  if (inventory === 'AVAILABLE') return CardSyncTier.AVAILABLE;
  if (inventory === 'ASSIGNED' || order) return CardSyncTier.ASSIGNED;
  if (['DEPLETED', 'FAILED'].includes(inventory)) return CardSyncTier.REFUND_WATCH;
  return CardSyncTier.ARCHIVED;
}

