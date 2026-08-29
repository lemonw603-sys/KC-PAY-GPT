import { accessSync, constants } from 'node:fs';

import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } from './chatgpt-checkout-navigator.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT } from './checkout-observer.js';

export const PRODUCTION_READONLY_CONFIRMATION = 'RUN BROWSER PRODUCTION READONLY WORKER';

export class ProductionReadonlyConfigError extends Error {
  constructor(message, code = 'INVALID_BROWSER_WORKER_CONFIG') {
    super(message);
    this.name = 'ProductionReadonlyConfigError';
    this.code = code;
  }
}

function required(env, name) {
  const value = String(env[name] ?? '').trim();
  if (!value) throw new ProductionReadonlyConfigError(`${name} is required`);
  return value;
}

function integer(env, name, { min, max, fallback }) {
  const raw = String(env[name] ?? fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProductionReadonlyConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function key32(env, name) {
  const raw = required(env, name);
  const value = Buffer.from(raw, 'base64');
  if (value.length !== 32 || value.toString('base64') !== raw) {
    throw new ProductionReadonlyConfigError(`${name} must be a canonical base64-encoded 32-byte key`);
  }
  return value;
}

export function loadProductionReadonlyBrowserConfig(env = process.env) {
  if (required(env, 'BROWSER_WORKER_MODE') !== 'PRODUCTION_READONLY') {
    throw new ProductionReadonlyConfigError('BROWSER_WORKER_MODE must be PRODUCTION_READONLY');
  }
  if (required(env, 'BROWSER_WORKER_CONFIRMATION') !== PRODUCTION_READONLY_CONFIRMATION) {
    throw new ProductionReadonlyConfigError('exact BROWSER_WORKER_CONFIRMATION is required');
  }
  for (const name of [
    'BROWSER_PAYMENT_WRITES_ENABLED',
    'PROVIDER_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED',
    'PROVIDER_RECHARGE_WRITES_ENABLED',
    'CARD_FUNDING_WRITES_ENABLED',
  ]) {
    if (env[name] !== 'false') throw new ProductionReadonlyConfigError(`${name} must be exactly false`);
  }
  if (env.BROWSER_PAYMENT_EXECUTOR_ENABLED !== 'false') {
    throw new ProductionReadonlyConfigError('BROWSER_PAYMENT_EXECUTOR_ENABLED must be exactly false');
  }
  if (env.BROWSER_PAYMENT_EXECUTOR_MODE !== 'MOCK') {
    throw new ProductionReadonlyConfigError('BROWSER_PAYMENT_EXECUTOR_MODE must be exactly MOCK');
  }
  for (const name of [
    'CHATGPT_SESSION_COOKIE', 'CHATGPT_TOKEN', 'SESSION_JSON',
    'CARD_NUMBER', 'CARD_EXPIRY', 'CARD_CVC',
    'HNSKJ_API_KEY', 'ZZSHU_API_KEY',
  ]) {
    if (String(env[name] ?? '').trim()) {
      throw new ProductionReadonlyConfigError(`${name} must be absent from the readonly Browser Worker environment`);
    }
  }

  const sharedMaterialsMode = String(env.BROWSER_SHARED_MATERIALS_MODE || 'DISABLED').trim();
  if (!['DISABLED', 'SHARED_ENCRYPTED_NONPAYMENT'].includes(sharedMaterialsMode)) {
    throw new ProductionReadonlyConfigError(
      'BROWSER_SHARED_MATERIALS_MODE must be DISABLED or SHARED_ENCRYPTED_NONPAYMENT',
    );
  }
  const readonlyHarness = String(env.BROWSER_READONLY_HARNESS || 'PAGE_ONLY').trim();
  if (!['PAGE_ONLY', 'CHATGPT_ACCOUNT_CHECKOUT'].includes(readonlyHarness)) {
    throw new ProductionReadonlyConfigError(
      'BROWSER_READONLY_HARNESS must be PAGE_ONLY or CHATGPT_ACCOUNT_CHECKOUT',
    );
  }
  const target = required(env, 'BROWSER_WORKER_TARGET');
  const urlPrefix = required(env, 'BROWSER_OBSERVE_URL_PREFIX');
  if (target === 'LOCAL_FIXTURE') {
    if (!urlPrefix.startsWith('data:text/html,')) {
      throw new ProductionReadonlyConfigError('LOCAL_FIXTURE requires a data:text/html URL');
    }
  } else if (target === 'EXTERNAL_READONLY') {
    let url;
    try {
      url = new URL(urlPrefix);
    } catch {
      throw new ProductionReadonlyConfigError('EXTERNAL_READONLY requires a valid https URL');
    }
    if (url.protocol !== 'https:') {
      throw new ProductionReadonlyConfigError('EXTERNAL_READONLY requires an https URL');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new ProductionReadonlyConfigError('external readonly URL must not contain credentials, query, or fragment');
    }
    const requiredExternalConfirmation = sharedMaterialsMode === 'SHARED_ENCRYPTED_NONPAYMENT'
      ? 'I-CONFIRM-EXTERNAL-READONLY-SHARED-MATERIALS-NO-PAYMENT'
      : 'I-CONFIRM-EXTERNAL-READONLY-NO-SESSION';
    if (env.BROWSER_EXTERNAL_READONLY_CONFIRM !== requiredExternalConfirmation) {
      throw new ProductionReadonlyConfigError('external readonly target requires its exact confirmation');
    }
  } else {
    throw new ProductionReadonlyConfigError('BROWSER_WORKER_TARGET must be LOCAL_FIXTURE or EXTERNAL_READONLY');
  }
  if (readonlyHarness === 'CHATGPT_ACCOUNT_CHECKOUT') {
    if (target !== 'EXTERNAL_READONLY'
      || sharedMaterialsMode !== 'SHARED_ENCRYPTED_NONPAYMENT'
      || urlPrefix !== 'https://chatgpt.com/') {
      throw new ProductionReadonlyConfigError(
        'CHATGPT_ACCOUNT_CHECKOUT requires EXTERNAL_READONLY, shared encrypted Session, and https://chatgpt.com/',
      );
    }
  }

  const executablePath = required(env, 'BROWSER_CHROME_EXECUTABLE_PATH');
  try {
    accessSync(executablePath, constants.X_OK);
  } catch {
    throw new ProductionReadonlyConfigError('BROWSER_CHROME_EXECUTABLE_PATH is not executable');
  }

  const runtimeHmacKey = key32(env, 'BROWSER_RUNTIME_HMAC_KEY_BASE64');
  const artifactKey = key32(env, 'BROWSER_ARTIFACT_KEY_BASE64');
  const resourceHmacKey = key32(env, 'BROWSER_RESOURCE_HMAC_KEY_BASE64');
  if (new Set([runtimeHmacKey.toString('hex'), artifactKey.toString('hex'), resourceHmacKey.toString('hex')]).size !== 3) {
    throw new ProductionReadonlyConfigError('Browser runtime, artifact, and resource keys must be distinct');
  }
  const sharedMaterialEncryptionKey = sharedMaterialsMode === 'SHARED_ENCRYPTED_NONPAYMENT'
    ? key32(env, 'SESSION_ENCRYPTION_KEY_BASE64')
    : null;

  const observation = {
    pageContract: {
      urlPrefix,
      title: required(env, 'BROWSER_OBSERVE_TITLE'),
      requiredSelector: required(env, 'BROWSER_OBSERVE_REQUIRED_SELECTOR'),
      // The authenticated ChatGPT harness already proves identity through
      // /api/auth/session and the account endpoint. A localized homepage text
      // fragment adds fragility without adding another trust boundary.
      markerText: readonlyHarness === 'CHATGPT_ACCOUNT_CHECKOUT'
        ? String(env.BROWSER_OBSERVE_MARKER_TEXT || '').trim()
        : required(env, 'BROWSER_OBSERVE_MARKER_TEXT'),
    },
    ...(readonlyHarness === 'CHATGPT_ACCOUNT_CHECKOUT' ? {
      accountProbeContract: {
        path: '/api/auth/session',
        accountCheckPath: '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0',
      },
      checkoutNavigationContract: CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
      checkoutContract: CHATGPT_PLUS_CHECKOUT_CONTRACT,
    } : {}),
  };
  const sharedSessionEnabled = sharedMaterialsMode === 'SHARED_ENCRYPTED_NONPAYMENT';
  const sharedCardPreflightEnabled = sharedSessionEnabled && readonlyHarness === 'PAGE_ONLY';

  return Object.freeze({
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseTls: env.DATABASE_TLS === 'true',
    workerId: required(env, 'BROWSER_WORKER_ID'),
    executorProfileId: required(env, 'BROWSER_EXECUTOR_PROFILE_ID'),
    profilesRoot: required(env, 'BROWSER_PROFILES_ROOT'),
    walPath: required(env, 'BROWSER_WAL_PATH'),
    executablePath,
    headless: env.BROWSER_CHROME_HEADLESS !== 'false',
    runtimeHmacKey,
    artifactKey,
    resourceHmacKey,
    sharedMaterialsMode,
    sharedMaterialEncryptionKey,
    readonlyHarness,
    materialPolicy: Object.freeze({
      sharedSessionEnabled,
      sharedCardPreflightEnabled,
    }),
    pollIntervalMs: integer(env, 'BROWSER_WORKER_POLL_INTERVAL_MS', { min: 100, max: 60_000, fallback: 1000 }),
    leaseSeconds: integer(env, 'BROWSER_WORKER_LEASE_SECONDS', { min: 10, max: 3600, fallback: 60 }),
    executionTimeoutMs: integer(env, 'BROWSER_EXECUTION_TIMEOUT_MS', { min: 500, max: 300_000, fallback: 30_000 }),
    observation,
  });
}
