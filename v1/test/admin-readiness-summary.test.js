import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminReadinessSummary } from '../src/services/admin-readiness-summary.js';

const fresh = new Date().toISOString();
const base = {
  providerHealth: { rechargeMethod: 'API', syncedAt: fresh, purchaseEnabled: true, browserRechargeReady: false },
  runtimeHealth: { workerHealthy: true, rechargeWritesEnabled: true },
  cardStock: { available: 1, autoReplenishmentEnabled: true }
};

test('API readiness ignores an inactive Browser executor when API and inventory are ready', () => {
  const result = buildAdminReadinessSummary(base, { defaultCardTypeReady: true });
  assert.equal(result.status, 'READY');
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks.map((item) => item.checkId), ['EXECUTION_ROUTE', 'CARD_SUPPLY']);
});

test('API readiness blocks intake when the worker cannot submit real recharges', () => {
  const result = buildAdminReadinessSummary({
    ...base,
    runtimeHealth: { workerHealthy: true, rechargeWritesEnabled: false }
  }, { defaultCardTypeReady: true });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.ready, false);
  assert.match(result.checks[0].message, /真实充值执行权限尚未开启/);
});

test('missing default route is not guessed as API and links to route management', () => {
  const result = buildAdminReadinessSummary({
    ...base,
    providerHealth: { ...base.providerHealth, rechargeMethod: null }
  }, { defaultCardTypeReady: true });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.method, null);
  assert.equal(result.checks[0].actionId, 'OPEN_PROVIDER_ROUTES');
});

test('Browser is a blocker only when it is the selected default route', () => {
  const result = buildAdminReadinessSummary({ ...base, providerHealth: { ...base.providerHealth, rechargeMethod: 'BROWSER' } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.checks[0].actionId, 'OPEN_BROWSER_STATUS');
});

test('no card can auto-heal only when opening rules and default card type are ready', () => {
  const overview = { ...base, cardStock: { available: 0, autoReplenishmentEnabled: true } };
  assert.equal(buildAdminReadinessSummary(overview, { defaultCardTypeReady: true }).status, 'AUTO_HEAL');
  const blocked = buildAdminReadinessSummary(overview, { defaultCardTypeReady: false });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.checks[1].actionId, 'REFRESH_PROVIDER_RULES');
});

// 「有卡要补余额」一支随补余额整条线删除（D-367）：余额不够的卡不再单列，缺卡与无卡同样交给自动开卡判断。
test('low-balance cards no longer produce a funding check (D-367)', () => {
  const withLegacyField = buildAdminReadinessSummary({ ...base, cardStock: { available: 0, needsFunding: 2, autoReplenishmentEnabled: true } }, { defaultCardTypeReady: true });
  const without = buildAdminReadinessSummary({ ...base, cardStock: { available: 0, autoReplenishmentEnabled: true } }, { defaultCardTypeReady: true });
  assert.deepEqual(withLegacyField, without);
  assert.equal(withLegacyField.checks.some((item) => item.actionId === 'OPEN_CARD_FUNDING' || /补余额|补足/.test(item.message)), false);
});
