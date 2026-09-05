import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadProductionReadonlyBrowserConfig,
  PRODUCTION_READONLY_CONFIRMATION,
} from '../src/production-readonly-config.js';
import {
  checkProductionReadonlyDatabase,
  parseProductionReadonlyArgs,
} from '../src/production-readonly-worker.js';

const key = Buffer.alloc(32, 7).toString('base64');
const profileId = '10f0dc7b534844c083165796447d5893';

function validEnv(overrides = {}) {
  return {
    BROWSER_WORKER_MODE: 'PRODUCTION_READONLY',
    BROWSER_WORKER_CONFIRMATION: PRODUCTION_READONLY_CONFIRMATION,
    BROWSER_WORKER_TARGET: 'LOCAL_FIXTURE',
    DATABASE_URL: 'mysql://root:root@127.0.0.1:3306/fixture',
    BROWSER_WORKER_ID: 'browser-worker-test',
    BROWSER_EXECUTOR_PROFILE_ID: '00000000-0000-4000-8000-000000000001',
    BROWSER_PROFILES_ROOT: '/tmp/browser-worker-profiles',
    BROWSER_WAL_PATH: '/tmp/browser-worker/evidence.wal.jsonl',
    BROWSER_CHROME_EXECUTABLE_PATH: process.env.AGENT_BROWSER_EXECUTABLE_PATH
      || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    BROWSER_OBSERVE_URL_PREFIX: 'data:text/html,<title>fixture</title><main>ok</main>',
    BROWSER_OBSERVE_TITLE: 'fixture',
    BROWSER_OBSERVE_REQUIRED_SELECTOR: 'main',
    BROWSER_OBSERVE_MARKER_TEXT: 'ok',
    BROWSER_RUNTIME_HMAC_KEY_BASE64: key,
    BROWSER_ARTIFACT_KEY_BASE64: Buffer.alloc(32, 8).toString('base64'),
    BROWSER_RESOURCE_HMAC_KEY_BASE64: Buffer.alloc(32, 9).toString('base64'),
    BROWSER_PAYMENT_WRITES_ENABLED: 'false',
    PROVIDER_WRITES_ENABLED: 'false',
    PROVIDER_CARD_WRITES_ENABLED: 'false',
    PROVIDER_RECHARGE_WRITES_ENABLED: 'false',
    CARD_FUNDING_WRITES_ENABLED: 'false',
    BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false',
    BROWSER_PAYMENT_EXECUTOR_MODE: 'MOCK',
    ...overrides,
  };
}

test('production readonly config accepts an explicit local fixture and no write authority', () => {
  const config = loadProductionReadonlyBrowserConfig(validEnv());
  assert.equal(config.workerId, 'browser-worker-test');
  assert.equal(config.observation.pageContract.title, 'fixture');
  assert.equal(config.runtimeHmacKey.length, 32);
});

test('production readonly config rejects every write switch and raw credential material', () => {
  for (const name of [
    'BROWSER_PAYMENT_WRITES_ENABLED', 'PROVIDER_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED', 'PROVIDER_RECHARGE_WRITES_ENABLED',
    'CARD_FUNDING_WRITES_ENABLED',
  ]) {
    assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({ [name]: 'true' })), /must be exactly false/);
  }
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true',
  })), /BROWSER_PAYMENT_EXECUTOR_ENABLED must be exactly false/);
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE',
  })), /BROWSER_PAYMENT_EXECUTOR_MODE must be exactly MOCK/);
  for (const name of ['CHATGPT_TOKEN', 'SESSION_JSON', 'CARD_NUMBER', 'CARD_CVC', 'HNSKJ_API_KEY']) {
    assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({ [name]: 'forbidden' })), /must be absent/);
  }
});

test('external readonly mode requires https and a separate confirmation', () => {
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_OBSERVE_URL_PREFIX: 'https://example.invalid/',
  })), /external readonly target requires/);
  const config = loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_EXTERNAL_READONLY_CONFIRM: 'I-CONFIRM-EXTERNAL-READONLY-NO-SESSION',
    BROWSER_OBSERVE_URL_PREFIX: 'https://example.invalid/',
  }));
  assert.equal(config.observation.pageContract.urlPrefix, 'https://example.invalid/');
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_EXTERNAL_READONLY_CONFIRM: 'I-CONFIRM-EXTERNAL-READONLY-NO-SESSION',
    BROWSER_OBSERVE_URL_PREFIX: 'https://example.invalid/?token=must-not-be-logged',
  })), /must not contain credentials, query, or fragment/);
});

test('BitBrowser readonly mode requires a local API URL and preserves the no-write contract', () => {
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'BITBROWSER_READONLY',
    BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345',
    BITBROWSER_READONLY_CONFIRM: 'I-CONFIRM-BITBROWSER-READONLY-NO-SESSION',
    BROWSER_OBSERVE_URL_PREFIX: 'https://chatgpt.com/',
  })), /BITBROWSER_PROFILE_ID is required/);
  const config = loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'BITBROWSER_READONLY',
    BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345',
    BITBROWSER_PROFILE_ID: profileId,
    BITBROWSER_READONLY_CONFIRM: 'I-CONFIRM-BITBROWSER-READONLY-NO-SESSION',
    BROWSER_OBSERVE_URL_PREFIX: 'https://chatgpt.com/',
    BROWSER_OBSERVE_TITLE: 'ChatGPT',
    BROWSER_OBSERVE_REQUIRED_SELECTOR: 'main',
  }));
  assert.equal(config.target, 'BITBROWSER_READONLY');
  assert.equal(config.bitbrowserApiBaseUrl, 'http://127.0.0.1:54345');
  assert.equal(config.bitbrowserProfileId, profileId);
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'BITBROWSER_READONLY',
    BITBROWSER_API_BASE_URL: 'http://user:pass@127.0.0.1:54345',
    BITBROWSER_PROFILE_ID: profileId,
    BITBROWSER_READONLY_CONFIRM: 'I-CONFIRM-BITBROWSER-READONLY-NO-SESSION',
    BROWSER_OBSERVE_URL_PREFIX: 'https://chatgpt.com/',
  })), /must not contain credentials/);
});

test('ChatGPT account checkout harness accepts a BitBrowser readonly target with shared Session material', () => {
  const config = loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'BITBROWSER_READONLY',
    BITBROWSER_API_BASE_URL: 'http://127.0.0.1:54345',
    BITBROWSER_PROFILE_ID: profileId,
    BITBROWSER_READONLY_CONFIRM: 'I-CONFIRM-BITBROWSER-READONLY-SHARED-MATERIALS-NO-PAYMENT',
    BROWSER_READONLY_HARNESS: 'CHATGPT_ACCOUNT_CHECKOUT',
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
    SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 10).toString('base64'),
    BROWSER_OBSERVE_URL_PREFIX: 'https://chatgpt.com/',
    BROWSER_OBSERVE_TITLE: 'ChatGPT',
    BROWSER_OBSERVE_REQUIRED_SELECTOR: 'main',
  }));
  assert.equal(config.target, 'BITBROWSER_READONLY');
  assert.equal(config.readonlyHarness, 'CHATGPT_ACCOUNT_CHECKOUT');
});

test('ChatGPT account/Checkout harness is explicit, exact-origin and Session-only', () => {
  const chatGptEnv = validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_READONLY_HARNESS: 'CHATGPT_ACCOUNT_CHECKOUT',
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
    SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 10).toString('base64'),
    BROWSER_EXTERNAL_READONLY_CONFIRM: 'I-CONFIRM-EXTERNAL-READONLY-SHARED-MATERIALS-NO-PAYMENT',
    BROWSER_OBSERVE_URL_PREFIX: 'https://chatgpt.com/',
    BROWSER_OBSERVE_TITLE: 'ChatGPT',
    BROWSER_OBSERVE_REQUIRED_SELECTOR: 'main',
  });
  delete chatGptEnv.BROWSER_OBSERVE_MARKER_TEXT;
  const config = loadProductionReadonlyBrowserConfig(chatGptEnv);
  assert.equal(config.readonlyHarness, 'CHATGPT_ACCOUNT_CHECKOUT');
  assert.equal(config.observation.accountProbeContract.path, '/api/auth/session');
  assert.equal(config.observation.checkoutNavigationContract.homeUrlPrefix, 'https://chatgpt.com/');
  assert.equal(config.observation.checkoutContract.urlPrefix, 'https://chatgpt.com/checkout/');
  assert.deepEqual(config.materialPolicy, {
    sharedSessionEnabled: true,
    sharedCardPreflightEnabled: false,
  });
  assert.equal(config.observation.pageContract.markerText, '');
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_READONLY_HARNESS: 'CHATGPT_ACCOUNT_CHECKOUT',
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
    SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 10).toString('base64'),
    BROWSER_EXTERNAL_READONLY_CONFIRM: 'I-CONFIRM-EXTERNAL-READONLY-SHARED-MATERIALS-NO-PAYMENT',
    BROWSER_OBSERVE_URL_PREFIX: 'https://example.invalid/',
  })), /requires EXTERNAL_READONLY.*https:\/\/chatgpt\.com\//);
});

test('production readonly config requires three distinct canonical keys', () => {
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_ARTIFACT_KEY_BASE64: key,
  })), /keys must be distinct/);
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_RUNTIME_HMAC_KEY_BASE64: key.replace(/=$/, ''),
  })), /canonical base64/);
});

test('shared encrypted material mode is explicit and reuses the v1 secret-box key', () => {
  const disabled = loadProductionReadonlyBrowserConfig(validEnv());
  assert.equal(disabled.sharedMaterialsMode, 'DISABLED');
  assert.equal(disabled.sharedMaterialEncryptionKey, null);
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
  })), /SESSION_ENCRYPTION_KEY_BASE64 is required/);
  const enabled = loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
    SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 33).toString('base64'),
  }));
  assert.equal(enabled.sharedMaterialsMode, 'SHARED_ENCRYPTED_NONPAYMENT');
  assert.equal(enabled.sharedMaterialEncryptionKey.length, 32);
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_OBSERVE_URL_PREFIX: 'https://example.invalid/',
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
    SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 33).toString('base64'),
    BROWSER_EXTERNAL_READONLY_CONFIRM: 'I-CONFIRM-EXTERNAL-READONLY-NO-SESSION',
  })), /external readonly target requires/);
  assert.doesNotThrow(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_WORKER_TARGET: 'EXTERNAL_READONLY',
    BROWSER_OBSERVE_URL_PREFIX: 'https://example.invalid/',
    BROWSER_SHARED_MATERIALS_MODE: 'SHARED_ENCRYPTED_NONPAYMENT',
    SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 33).toString('base64'),
    BROWSER_EXTERNAL_READONLY_CONFIRM: 'I-CONFIRM-EXTERNAL-READONLY-SHARED-MATERIALS-NO-PAYMENT',
  })));
  assert.throws(() => loadProductionReadonlyBrowserConfig(validEnv({
    BROWSER_SHARED_MATERIALS_MODE: 'LIVE',
  })), /must be DISABLED or SHARED_ENCRYPTED_NONPAYMENT/);
});

test('production readonly CLI rejects unknown or ambiguous process modes', () => {
  assert.deepEqual(parseProductionReadonlyArgs([]), { checkOnly: false, once: false });
  assert.deepEqual(parseProductionReadonlyArgs(['--once']), { checkOnly: false, once: true });
  assert.deepEqual(parseProductionReadonlyArgs(['--check']), { checkOnly: true, once: true });
  assert.throws(() => parseProductionReadonlyArgs(['--payment']), /unsupported/);
  assert.throws(() => parseProductionReadonlyArgs(['--check', '--once']), /mutually exclusive/);
});

test('database readiness refuses Browser payment writes even when environment flags are false', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('schema_migrations')) return [[{ present: 3 }], []];
      if (sql.includes('browser_payment_writes_enabled')) return [[{ setting_value: 'true' }], []];
      throw new Error('dispatch query must not run');
    },
  };
  await assert.rejects(() => checkProductionReadonlyDatabase(pool, {
    executorProfileId: '00000000-0000-4000-8000-000000000001',
  }), /must be false/);
});

test('database readiness requires an active read-only Browser executor profile', async () => {
  const query = async (sql) => {
    if (sql.includes('schema_migrations')) return [[{ present: 3 }], []];
    if (sql.includes('browser_payment_writes_enabled')) return [[{ setting_value: 'false' }], []];
    if (sql.includes('FROM executor_profiles')) {
      return [[{
        id: '00000000-0000-4000-8000-000000000001',
        executor_kind: 'BROWSER',
        status: 'ACTIVE',
        production_writes_enabled: 'false',
      }], []];
    }
    if (sql.includes('browser_dispatch_jobs')) return [[], []];
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const ready = await checkProductionReadonlyDatabase({ query }, {
    executorProfileId: '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.migrations, [
    '039_card_consumption_attempt_link',
    '040_card_operational_overrides',
    '041_browser_worker_heartbeat',
  ]);

  await assert.rejects(() => checkProductionReadonlyDatabase({
    async query(sql) {
      if (sql.includes('schema_migrations')) return [[{ present: 1 }], []];
      throw new Error('readiness must stop at the migration check');
    },
  }, {
    executorProfileId: '00000000-0000-4000-8000-000000000001',
  }), /required Browser migrations 039, 040 and 041/);

  const disabledPool = {
    async query(sql) {
      if (sql.includes('schema_migrations')) return [[{ present: 3 }], []];
      if (sql.includes('browser_payment_writes_enabled')) return [[{ setting_value: 'false' }], []];
      if (sql.includes('FROM executor_profiles')) {
        return [[{ executor_kind: 'BROWSER', status: 'DISABLED', production_writes_enabled: 'false' }], []];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  await assert.rejects(() => checkProductionReadonlyDatabase(disabledPool, {
    executorProfileId: '00000000-0000-4000-8000-000000000001',
  }), /must exist and be ACTIVE/);
});
