import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminReadinessSummary } from '../src/services/admin-readiness-summary.js';

const fresh = new Date().toISOString();

test('readiness summary is presentation-only and ready when provider and stock are ready', () => {
  const result = buildAdminReadinessSummary({
    providerHealth: { syncedAt: fresh, purchaseEnabled: true, browserRechargeReady: false },
    cardStock: { available: 2 }
  });
  assert.equal(result.status, 'ACTION_REQUIRED');
  assert.equal(result.checks.find((item) => item.checkId === 'CARD_STOCK').status, 'READY');
  assert.equal(result.checks.find((item) => item.checkId === 'BROWSER_EXECUTOR').actionId, 'OPEN_BROWSER_STATUS');
});

test('missing stock is a blocker while browser not-ready remains informational action', () => {
  const result = buildAdminReadinessSummary({ providerHealth: {}, cardStock: { available: 0 } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.checks.find((item) => item.checkId === 'CARD_STOCK').actionId, 'OPEN_CARD_STOCK');
  assert.match(result.checks.find((item) => item.checkId === 'BROWSER_EXECUTOR').message, /API/);
});
