import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ChatGptPostPaymentVerifier, POST_PAYMENT_VERIFICATION_MAX_MS } from '../src/chatgpt-post-payment-verifier.js';
import { loadProductionLiveBrowserConfig, PRODUCTION_LIVE_CONFIRMATION_PREFIX } from '../src/production-live-config.js';
import { loadProductionLivePoolConfig, POOL_CONFIRMATION_PREFIX } from '../src/production-live-pool-worker.js';

// D-386 P0 / D-389：池的运行环境给核实窗口填了 1800000，池配置允许到 3600000，核实器只收 300000。
// 各自的单元测试都是绿的，而每张真付款单都会在填卡前报错。这里把「值从哪来」和「谁来用它」
// 放在一起验：生产上会出现的每个来源，都必须既能过池配置、又能让核实器构造成功。

const key = (byte) => Buffer.alloc(32, byte).toString('base64');
const profile = (byte) => byte.toString(16).repeat(32).slice(0, 32);
const poolEnv = (overrides = {}) => ({
  BROWSER_WORKER_MODE: 'PRODUCTION_LIVE_POOL',
  BROWSER_POOL_CONFIRMATION: `${POOL_CONFIRMATION_PREFIX}PAY`,
  BROWSER_POOL_LANES: `lane-3=${profile(0xa)}`,
  BROWSER_PAYMENT_WRITES_ENABLED: 'true', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true', BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE',
  PROVIDER_WRITES_ENABLED: 'false', PROVIDER_CARD_WRITES_ENABLED: 'false', PROVIDER_RECHARGE_WRITES_ENABLED: 'false', CARD_FUNDING_WRITES_ENABLED: 'false',
  PROVIDER_READS_ENABLED: 'false',
  DATABASE_URL: 'mysql://fixture', DATABASE_TLS: 'false',
  BROWSER_EXECUTOR_PROFILE_ID: 'profile-1', BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345',
  BROWSER_BILLING_ADDRESS_NAME: 'Browser Billing', BROWSER_POOL_STATE_DIR: '/tmp/browser-pool-fixture',
  BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1), BROWSER_ARTIFACT_KEY_BASE64: key(2), BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3), SESSION_ENCRYPTION_KEY_BASE64: key(4),
  ...overrides,
});

const constructVerifier = (timeoutMs) => new ChatGptPostPaymentVerifier({
  page: { evaluate: async () => undefined },
  expectedIdentity: { email: 'fixture@example.test' },
  transactionReader: { read: async () => [], reconcile: async () => ({ matched: false }) },
  timeoutMs,
  pollIntervalMs: 5_000,
});

async function productionSources() {
  const script = await readFile(new URL('../scripts/run-live-pool.sh', import.meta.url), 'utf8');
  const plist = await readFile(new URL('../../deploy/local/com.pojia.browser-pool.plist', import.meta.url), 'utf8');
  const scriptDefault = script.match(/BROWSER_PAYMENT_VERIFICATION_WINDOW_MS="\$\{BROWSER_PAYMENT_VERIFICATION_WINDOW_MS:-(\d+)\}"/);
  const plistValue = plist.match(/<key>BROWSER_PAYMENT_VERIFICATION_WINDOW_MS<\/key>\s*<string>(\d+)<\/string>/);
  assert.ok(scriptDefault, 'run-live-pool.sh must still set a default for the window');
  assert.ok(plistValue, 'the LaunchAgent must still pin the window');
  return {
    'run-live-pool.sh default': scriptDefault[1],
    'LaunchAgent plist': plistValue[1],
    'pool config fallback (unset)': undefined,
  };
}

test('every production source of the verification window is accepted by the pool AND by the verifier it feeds', async () => {
  for (const [source, value] of Object.entries(await productionSources())) {
    const env = value === undefined ? poolEnv() : poolEnv({ BROWSER_PAYMENT_VERIFICATION_WINDOW_MS: value });
    const config = loadProductionLivePoolConfig(env);
    assert.doesNotThrow(() => constructVerifier(config.verificationWindowMs), `${source} = ${value}`);
  }
});

test('a window the verifier cannot take stops the pool at startup, not every payment before the card is filled', () => {
  const config = loadProductionLivePoolConfig(poolEnv({ BROWSER_PAYMENT_VERIFICATION_WINDOW_MS: String(POST_PAYMENT_VERIFICATION_MAX_MS) }));
  assert.doesNotThrow(() => constructVerifier(config.verificationWindowMs), 'the largest value the pool accepts is one the verifier accepts');
  for (const bad of [POST_PAYMENT_VERIFICATION_MAX_MS + 1, 1_800_000, 3_600_000]) {
    assert.throws(() => loadProductionLivePoolConfig(poolEnv({ BROWSER_PAYMENT_VERIFICATION_WINDOW_MS: String(bad) })),
      /BROWSER_PAYMENT_VERIFICATION_WINDOW_MS must be an integer between 30000 and 300000/);
    assert.throws(() => constructVerifier(bad), /timeoutMs/);
  }
});

test('the single-order LIVE config shares the same bound', () => {
  const orderId = 'order-live-1';
  const env = (window) => ({
    BROWSER_WORKER_MODE: 'PRODUCTION_LIVE', BROWSER_WORKER_CHECK_ONLY: 'false', BROWSER_LIVE_ORDER_ID: orderId,
    BROWSER_LIVE_OPERATION_CONFIRMATION: `${PRODUCTION_LIVE_CONFIRMATION_PREFIX}${orderId}`,
    BROWSER_PAYMENT_WRITES_ENABLED: 'true', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true', BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE',
    PROVIDER_WRITES_ENABLED: 'false', PROVIDER_CARD_WRITES_ENABLED: 'false', PROVIDER_RECHARGE_WRITES_ENABLED: 'false', CARD_FUNDING_WRITES_ENABLED: 'false',
    DATABASE_URL: 'mysql://fixture', DATABASE_TLS: 'false', BROWSER_WORKER_ID: 'live-worker-1', BROWSER_EXECUTOR_PROFILE_ID: 'profile-1',
    BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345', BITBROWSER_PROFILE_ID: 'bit-profile-1', PROVIDER_READS_ENABLED: 'false',
    BROWSER_BILLING_ADDRESS_NAME: 'Browser Billing', BROWSER_BILLING_ADDRESS_STATE: 'DE', BROWSER_CHROME_EXECUTABLE_PATH: process.execPath,
    BROWSER_WAL_PATH: '/tmp/browser-live.wal', BROWSER_CARD_LEASE_PATH: '/tmp/browser-live-card-leases.json',
    BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1), BROWSER_ARTIFACT_KEY_BASE64: key(2), BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3), SESSION_ENCRYPTION_KEY_BASE64: key(4),
    ...(window === undefined ? {} : { BROWSER_PAYMENT_VERIFICATION_WINDOW_MS: String(window) }),
  });
  assert.doesNotThrow(() => constructVerifier(loadProductionLiveBrowserConfig(env()).verificationWindowMs));
  assert.doesNotThrow(() => constructVerifier(loadProductionLiveBrowserConfig(env(POST_PAYMENT_VERIFICATION_MAX_MS)).verificationWindowMs));
  assert.throws(() => loadProductionLiveBrowserConfig(env(POST_PAYMENT_VERIFICATION_MAX_MS + 1)), /between 30000 and 300000/);
});

test('the pool polls for new orders every second by default', async () => {
  const script = await readFile(new URL('../scripts/run-live-pool.sh', import.meta.url), 'utf8');
  const poll = script.match(/BROWSER_POOL_POLL_INTERVAL_MS="\$\{BROWSER_POOL_POLL_INTERVAL_MS:-(\d+)\}"/);
  assert.ok(poll, 'run-live-pool.sh sets the poll interval');
  assert.equal(loadProductionLivePoolConfig(poolEnv({ BROWSER_POOL_POLL_INTERVAL_MS: poll[1] })).pollIntervalMs, 1_000);
});
