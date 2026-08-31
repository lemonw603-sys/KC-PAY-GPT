import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminReadinessSummary } from '../src/services/admin-readiness-summary.js';

const fresh = new Date().toISOString();
const base = {
  providerHealth: { rechargeMethod: 'API', syncedAt: fresh, purchaseEnabled: true, browserRechargeReady: false },
  runtimeHealth: { workerHealthy: true },
  cardStock: { available: 1, needsFunding: 0, autoReplenishmentEnabled: true }
};

test('API readiness ignores an inactive Browser executor when API and inventory are ready', () => {
  const result = buildAdminReadinessSummary(base, { defaultCardTypeReady: true });
  assert.equal(result.status, 'READY');
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks.map((item) => item.checkId), ['EXECUTION_ROUTE', 'CARD_SUPPLY']);
});

test('Browser is a blocker only when it is the selected default route', () => {
  const result = buildAdminReadinessSummary({ ...base, providerHealth: { ...base.providerHealth, rechargeMethod: 'BROWSER' } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.checks[0].actionId, 'OPEN_BROWSER_STATUS');
});

test('no card can auto-heal only when opening rules and default card type are ready', () => {
  const overview = { ...base, cardStock: { available: 0, needsFunding: 0, autoReplenishmentEnabled: true } };
  assert.equal(buildAdminReadinessSummary(overview, { defaultCardTypeReady: true }).status, 'AUTO_HEAL');
  const blocked = buildAdminReadinessSummary(overview, { defaultCardTypeReady: false });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.checks[1].actionId, 'REFRESH_PROVIDER_RULES');
});

test('underfunded inventory remains blocked while production funding is disabled', () => {
  const result = buildAdminReadinessSummary({ ...base, cardStock: { available: 0, needsFunding: 2, autoReplenishmentEnabled: true } }, { defaultCardTypeReady: true });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.checks[1].actionId, 'OPEN_CARD_FUNDING');
});

test('underfunded inventory is auto-healable after order-driven production funding is enabled', () => {
  const result = buildAdminReadinessSummary({
    ...base,
    cardStock: {
      available: 0,
      needsFunding: 2,
      autoReplenishmentEnabled: true,
      balanceFundingEnabled: true
    }
  }, { defaultCardTypeReady: true });
  assert.equal(result.status, 'AUTO_HEAL');
  assert.equal(result.ready, true);
  assert.equal(result.checks[1].actionId, null);
});
