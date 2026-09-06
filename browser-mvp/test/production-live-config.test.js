import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProductionLiveBrowserConfig, PRODUCTION_LIVE_CONFIRMATION_PREFIX } from '../src/production-live-config.js';

const key = (byte) => Buffer.alloc(32, byte).toString('base64');
function env(overrides = {}) {
  const orderId = 'order-live-1';
  return {
    BROWSER_WORKER_MODE: 'PRODUCTION_LIVE',
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
    BROWSER_CHROME_EXECUTABLE_PATH: process.execPath,
    BROWSER_WAL_PATH: '/tmp/browser-live.wal',
    BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1), BROWSER_ARTIFACT_KEY_BASE64: key(2),
    BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3), SESSION_ENCRYPTION_KEY_BASE64: key(4),
    ...overrides,
  };
}

test('LIVE config requires explicit gates and binds consent to one order', () => {
  const config = loadProductionLiveBrowserConfig(env());
  assert.equal(config.approvedOrderId, 'order-live-1');
  assert.equal(config.bitbrowserApiBaseUrl, 'http://127.0.0.1:54345');
  for (const bad of [
    { BROWSER_PAYMENT_WRITES_ENABLED: 'false' },
    { BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false' },
    { BROWSER_PAYMENT_EXECUTOR_MODE: 'MOCK' },
    { BROWSER_LIVE_OPERATION_CONFIRMATION: `${PRODUCTION_LIVE_CONFIRMATION_PREFIX}another-order` },
  ]) assert.throws(() => loadProductionLiveBrowserConfig(env(bad)));
});

test('LIVE config rejects Provider writes, raw secrets and non-local BitBrowser APIs', () => {
  assert.throws(() => loadProductionLiveBrowserConfig(env({ PROVIDER_CARD_WRITES_ENABLED: 'true' })));
  assert.throws(() => loadProductionLiveBrowserConfig(env({ CARD_NUMBER: '4111111111111111' })));
  assert.throws(() => loadProductionLiveBrowserConfig(env({ BITBROWSER_API_BASE_URL: 'https://example.test/api' })));
});
