import { accessSync, constants } from 'node:fs';

export const PRODUCTION_LIVE_CONFIRMATION_PREFIX = 'I-CONFIRM-ONE-LIVE-BROWSER-PAYMENT:';

export class ProductionLiveConfigError extends Error {
  constructor(message, code = 'INVALID_BROWSER_LIVE_CONFIG') {
    super(message);
    this.name = 'ProductionLiveConfigError';
    this.code = code;
  }
}

function required(env, name) {
  const value = String(env[name] ?? '').trim();
  if (!value) throw new ProductionLiveConfigError(`${name} is required`);
  return value;
}

function integer(env, name, { min, max, fallback }) {
  const value = Number(String(env[name] ?? fallback));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProductionLiveConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function key32(env, name) {
  const raw = required(env, name);
  const value = Buffer.from(raw, 'base64');
  if (value.length !== 32 || value.toString('base64') !== raw) {
    throw new ProductionLiveConfigError(`${name} must be a canonical base64-encoded 32-byte key`);
  }
  return value;
}

function localApiUrl(raw) {
  let value;
  try { value = new URL(raw); } catch { throw new ProductionLiveConfigError('BITBROWSER_API_BASE_URL must be a valid URL'); }
  if (value.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(value.hostname)
    || value.username || value.password || value.search || value.hash) {
    throw new ProductionLiveConfigError('BitBrowser Local API must be credential-free localhost HTTP');
  }
  return value.toString().replace(/\/$/, '');
}

/** Fail-closed configuration for the separate one-order LIVE process. */
export function loadProductionLiveBrowserConfig(env = process.env) {
  if (required(env, 'BROWSER_WORKER_MODE') !== 'PRODUCTION_LIVE') {
    throw new ProductionLiveConfigError('BROWSER_WORKER_MODE must be PRODUCTION_LIVE');
  }
  const approvedOrderId = required(env, 'BROWSER_LIVE_ORDER_ID');
  if (required(env, 'BROWSER_LIVE_OPERATION_CONFIRMATION')
    !== `${PRODUCTION_LIVE_CONFIRMATION_PREFIX}${approvedOrderId}`) {
    throw new ProductionLiveConfigError('LIVE confirmation must be bound to the approved order ID');
  }
  for (const name of ['BROWSER_PAYMENT_WRITES_ENABLED', 'BROWSER_PAYMENT_EXECUTOR_ENABLED']) {
    if (env[name] !== 'true') throw new ProductionLiveConfigError(`${name} must be exactly true`);
  }
  if (env.BROWSER_PAYMENT_EXECUTOR_MODE !== 'LIVE') {
    throw new ProductionLiveConfigError('BROWSER_PAYMENT_EXECUTOR_MODE must be exactly LIVE');
  }
  for (const name of [
    'PROVIDER_WRITES_ENABLED', 'PROVIDER_CARD_WRITES_ENABLED',
    'PROVIDER_RECHARGE_WRITES_ENABLED', 'CARD_FUNDING_WRITES_ENABLED',
  ]) {
    if (env[name] !== 'false') throw new ProductionLiveConfigError(`${name} must be exactly false`);
  }
  for (const name of [
    'CHATGPT_SESSION_COOKIE', 'CHATGPT_TOKEN', 'SESSION_JSON',
    'CARD_NUMBER', 'CARD_EXPIRY', 'CARD_CVC', 'HNSKJ_API_KEY', 'ZZSHU_API_KEY',
  ]) {
    if (String(env[name] ?? '').trim()) {
      throw new ProductionLiveConfigError(`${name} must be absent from the LIVE Worker environment`);
    }
  }
  const executablePath = required(env, 'BROWSER_CHROME_EXECUTABLE_PATH');
  try { accessSync(executablePath, constants.X_OK); } catch {
    throw new ProductionLiveConfigError('BROWSER_CHROME_EXECUTABLE_PATH is not executable');
  }
  const runtimeHmacKey = key32(env, 'BROWSER_RUNTIME_HMAC_KEY_BASE64');
  const artifactKey = key32(env, 'BROWSER_ARTIFACT_KEY_BASE64');
  const resourceHmacKey = key32(env, 'BROWSER_RESOURCE_HMAC_KEY_BASE64');
  const materialEncryptionKey = key32(env, 'SESSION_ENCRYPTION_KEY_BASE64');
  if (new Set([runtimeHmacKey, artifactKey, resourceHmacKey, materialEncryptionKey]
    .map((value) => value.toString('hex'))).size !== 4) {
    throw new ProductionLiveConfigError('LIVE runtime, artifact, resource and material keys must be distinct');
  }
  return Object.freeze({
    approvedOrderId,
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseTls: env.DATABASE_TLS === 'true',
    workerId: required(env, 'BROWSER_WORKER_ID'),
    executorProfileId: required(env, 'BROWSER_EXECUTOR_PROFILE_ID'),
    bitbrowserApiBaseUrl: localApiUrl(required(env, 'BITBROWSER_API_BASE_URL')),
    bitbrowserProfileId: required(env, 'BITBROWSER_PROFILE_ID'),
    executablePath,
    walPath: required(env, 'BROWSER_WAL_PATH'),
    runtimeHmacKey, artifactKey, resourceHmacKey, materialEncryptionKey,
    leaseSeconds: integer(env, 'BROWSER_WORKER_LEASE_SECONDS', { min: 10, max: 3600, fallback: 60 }),
    executionTimeoutMs: integer(env, 'BROWSER_EXECUTION_TIMEOUT_MS', { min: 1_000, max: 300_000, fallback: 60_000 }),
    verificationWindowMs: integer(env, 'BROWSER_PAYMENT_VERIFICATION_WINDOW_MS', { min: 30_000, max: 3_600_000, fallback: 300_000 }),
    verificationIntervalMs: integer(env, 'BROWSER_PAYMENT_VERIFICATION_INTERVAL_MS', { min: 1_000, max: 60_000, fallback: 5_000 }),
  });
}
