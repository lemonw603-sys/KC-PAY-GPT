import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProductionLiveBrowserConfig, PRODUCTION_LIVE_CONFIRMATION_PREFIX } from '../src/production-live-config.js';

const key = (byte) => Buffer.alloc(32, byte).toString('base64');
function env(overrides = {}) {
  const orderId = 'order-live-1';
  return {
    BROWSER_WORKER_MODE: 'PRODUCTION_LIVE',
    BROWSER_WORKER_CHECK_ONLY: 'false',
    BROWSER_LIVE_ORDER_ID: orderId,
    BROWSER_LIVE_OPERATION_CONFIRMATION: `${PRODUCTION_LIVE_CONFIRMATION_PREFIX}${orderId}`,
    BROWSER_PAYMENT_WRITES_ENABLED: 'true',
    BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true',
    BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE',
    PROVIDER_WRITES_ENABLED: 'false', PROVIDER_CARD_WRITES_ENABLED: 'false',
    PROVIDER_RECHARGE_WRITES_ENABLED: 'false', CARD_FUNDING_WRITES_ENABLED: 'false',
    DATABASE_URL: 'mysql://fixture', DATABASE_TLS: 'false',
    BROWSER_WORKER_ID: 'live-worker-1', BROWSER_EXECUTOR_PROFILE_ID: 'profile-1',
    BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345', BITBROWSER_PROFILE_ID: 'bit-profile-1',
    PROVIDER_READS_ENABLED: 'false',
    BROWSER_BILLING_ADDRESS_NAME: 'Browser Billing', BROWSER_BILLING_ADDRESS_STATE: 'DE',
    BROWSER_CHROME_EXECUTABLE_PATH: process.execPath,
    BROWSER_WAL_PATH: '/tmp/browser-live.wal',
    BROWSER_CARD_LEASE_PATH: '/tmp/browser-live-card-leases.json',
    BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1), BROWSER_ARTIFACT_KEY_BASE64: key(2),
    BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3), SESSION_ENCRYPTION_KEY_BASE64: key(4),
    ...overrides,
  };
}

test('LIVE config requires explicit gates and binds consent to one order', () => {
  const config = loadProductionLiveBrowserConfig(env());
  assert.equal(config.approvedOrderId, 'order-live-1');
  assert.equal(config.bitbrowserApiBaseUrl, 'http://127.0.0.1:54345');
  assert.equal(config.postPlusAction, 'CANCEL_RENEWAL');
  for (const bad of [
    { BROWSER_PAYMENT_WRITES_ENABLED: 'false' },
    { BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false' },
    { BROWSER_PAYMENT_EXECUTOR_MODE: 'MOCK' },
    { BROWSER_LIVE_OPERATION_CONFIRMATION: `${PRODUCTION_LIVE_CONFIRMATION_PREFIX}another-order` },
  ]) assert.throws(() => loadProductionLiveBrowserConfig(env(bad)));
});

test('manual 20X handoff is explicit and only valid for a bound LIVE run', () => {
  assert.equal(loadProductionLiveBrowserConfig(env({
    BROWSER_POST_PLUS_ACTION: 'MANUAL_20X_HANDOFF',
  })).postPlusAction, 'MANUAL_20X_HANDOFF');
  assert.throws(() => loadProductionLiveBrowserConfig(env({
    BROWSER_POST_PLUS_ACTION: 'UNKNOWN_ACTION',
  })));
  assert.throws(() => loadProductionLiveBrowserConfig(env({
    BROWSER_WORKER_CHECK_ONLY: 'true',
    BROWSER_LIVE_ORDER_ID: '', BROWSER_LIVE_OPERATION_CONFIRMATION: '',
    BROWSER_PAYMENT_WRITES_ENABLED: 'false', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false',
    BROWSER_POST_PLUS_ACTION: 'MANUAL_20X_HANDOFF',
  })));
});

test('LIVE check mode is non-paying and does not require an order confirmation', () => {
  const config = loadProductionLiveBrowserConfig(env({
    BROWSER_WORKER_CHECK_ONLY: 'true',
    BROWSER_LIVE_ORDER_ID: '', BROWSER_LIVE_OPERATION_CONFIRMATION: '',
    BROWSER_PAYMENT_WRITES_ENABLED: 'false', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false',
  }));
  assert.equal(config.checkOnly, true);
  assert.equal(config.approvedOrderId, null);
});

test('HNSKJ credentials are allowed only for explicit Provider reads', () => {
  assert.equal(loadProductionLiveBrowserConfig(env({
    PROVIDER_READS_ENABLED: 'true', HNSKJ_API_KEY: 'read-only-key',
  })).hnskjApiKey, 'read-only-key');
  assert.throws(() => loadProductionLiveBrowserConfig(env({ HNSKJ_API_KEY: 'unused-key' })));
});

test('LIVE config rejects Provider writes, raw secrets and non-local BitBrowser APIs', () => {
  assert.throws(() => loadProductionLiveBrowserConfig(env({ PROVIDER_CARD_WRITES_ENABLED: 'true' })));
  assert.throws(() => loadProductionLiveBrowserConfig(env({ CARD_NUMBER: '4111111111111111' })));
  assert.throws(() => loadProductionLiveBrowserConfig(env({ BITBROWSER_API_BASE_URL: 'https://example.test/api' })));
});
