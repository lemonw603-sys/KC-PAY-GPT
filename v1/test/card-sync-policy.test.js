import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CardSyncTier,
  cardSyncPriority,
  initialSyncTier,
  nextCardSyncAt,
  normalizeCardSyncTier
} from '../src/domain/card-sync-policy.js';

test('prioritizes money-result reconciliation ahead of historical card sync', () => {
  assert.ok(cardSyncPriority(CardSyncTier.RECHARGE_PROCESSING)
    < cardSyncPriority(CardSyncTier.REFUND_WATCH));
  assert.ok(cardSyncPriority(CardSyncTier.MANUAL)
    < cardSyncPriority(CardSyncTier.RECHARGE_PROCESSING));
});

test('uses bounded exponential backoff with jitter and honors Retry-After', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');
  assert.equal(nextCardSyncAt({
    tier: CardSyncTier.ASSIGNED, now, consecutiveFailures: 3, random: () => 0
  }).toISOString(), '2026-08-20T00:05:00.000Z');
  assert.equal(nextCardSyncAt({
    tier: CardSyncTier.ASSIGNED, now, consecutiveFailures: 4,
    retryAfterMs: 20 * 60_000, random: () => 0.5
  }).toISOString(), '2026-08-20T00:22:00.000Z');
  assert.equal(nextCardSyncAt({
    tier: CardSyncTier.ARCHIVED, now, consecutiveFailures: 12, random: () => 1
  }).toISOString(), '2026-08-21T04:48:00.000Z');
});

test('maps operational card states into stable sync tiers', () => {
  assert.equal(initialSyncTier({ inventoryStatus: 'AVAILABLE' }), CardSyncTier.AVAILABLE);
  assert.equal(initialSyncTier({ inventoryStatus: 'ASSIGNED', orderStatus: 'RECHARGE_PROCESSING' }),
    CardSyncTier.RECHARGE_PROCESSING);
  assert.equal(initialSyncTier({ inventoryStatus: 'PROVISIONING' }), CardSyncTier.PROVISIONING);
  assert.equal(initialSyncTier({ inventoryStatus: 'DEPLETED' }), CardSyncTier.REFUND_WATCH);
  assert.throws(() => normalizeCardSyncTier('unknown'), /Unknown card sync tier/);
});

