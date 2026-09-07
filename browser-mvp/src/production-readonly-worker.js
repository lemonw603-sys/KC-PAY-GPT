import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { loadRuntimeDatabaseConfig } from '../../v1/src/config.js';
import { createDatabasePool } from '../../v1/src/db/pool.js';
import { createBitBrowserControlManifest, createChromeControlManifest } from './fixtures.js';
import { GoogleChromeControlRuntimeAdapter } from './chrome-control-runtime.js';
import { BitBrowserControlRuntimeAdapter } from './bitbrowser-control-runtime.js';
import { createBrowserOrderPreflightWorker } from './browser-order-preflight.js';
import { AppendOnlyWal, WalEvidenceSink } from './wal.js';
import { CompositeEvidenceSink, MysqlEvidenceSink } from './mysql-evidence-sink.js';
import { createSharedNonPaymentDryRun, SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION } from './shared-dry-run-composition.js';
import { loadProductionReadonlyBrowserConfig } from './production-readonly-config.js';
import { CookieSessionBootstrapAdapter } from './session-bootstrap.js';
import { InMemoryCardMaterialLeaseProvider } from './card-material-lease.js';
import {
  browserRunMaterialRef,
  SharedEncryptedCardMaterialSource,
  SharedEncryptedSessionSource,
} from './shared-encrypted-materials.js';

export const REQUIRED_PRODUCTION_READONLY_MIGRATIONS = Object.freeze([
  '039_card_consumption_attempt_link',
  '040_card_operational_overrides',
  '041_browser_worker_heartbeat',
]);

function delay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function checkProductionReadonlyDatabase(pool, { executorProfileId } = {}) {
  if (!executorProfileId) throw new Error('executorProfileId is required for database readiness');
  const [[migration]] = await pool.query(
    `SELECT COUNT(DISTINCT version) AS present FROM schema_migrations
     WHERE version IN (?, ?, ?)`,
    REQUIRED_PRODUCTION_READONLY_MIGRATIONS,
  );
  if (Number(migration?.present) !== REQUIRED_PRODUCTION_READONLY_MIGRATIONS.length) {
    throw new Error('required Browser migrations 039, 040 and 041 are not applied');
  }
  const [[setting]] = await pool.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key = 'browser_payment_writes_enabled' LIMIT 1`,
  );
  if (String(setting?.setting_value).trim().toLowerCase() !== 'false') {
    throw new Error('browser_payment_writes_enabled must be false');
  }
  const [[profile]] = await pool.query(
    `SELECT id, executor_kind, status,
            JSON_UNQUOTE(JSON_EXTRACT(config_public_json, '$.productionWritesEnabled')) AS production_writes_enabled
     FROM executor_profiles WHERE id = ? LIMIT 1`,
    [executorProfileId],
  );
  if (!profile || profile.executor_kind !== 'BROWSER' || profile.status !== 'ACTIVE') {
    throw new Error('configured Browser executor profile must exist and be ACTIVE');
  }
  if (String(profile.production_writes_enabled).trim().toLowerCase() !== 'false') {
    throw new Error('configured Browser executor profile must declare productionWritesEnabled=false');
  }
  await pool.query('SELECT id FROM browser_dispatch_jobs LIMIT 0');
  return {
    ready: true,
    browserPaymentWritesEnabled: false,
    executorProfileId,
    migrations: [...REQUIRED_PRODUCTION_READONLY_MIGRATIONS],
  };
}

export async function checkProductionReadonlyFilesystem(config) {
  await mkdir(config.profilesRoot, { recursive: true, mode: 0o700 });
  await mkdir(dirname(config.walPath), { recursive: true, mode: 0o700 });
  await Promise.all([
    access(config.profilesRoot, constants.R_OK | constants.W_OK | constants.X_OK),
    access(dirname(config.walPath), constants.R_OK | constants.W_OK | constants.X_OK),
  ]);
  return { ready: true };
}

async function resolveAccountKey(pool, { orderId }) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(chatgpt_account_id), ''),
                     NULLIF(LOWER(TRIM(customer_email)), '')) AS account_key
     FROM orders WHERE id = ? LIMIT 1`,
    [orderId],
  );
  if (!row?.account_key) throw new Error('order has no stable Browser account identity');
  return String(row.account_key);
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function resolveSessionIdentityDigests(pool, { orderId }) {
  const [[row]] = await pool.query(
    `SELECT NULLIF(TRIM(chatgpt_account_id), '') AS account_id,
            NULLIF(LOWER(TRIM(customer_email)), '') AS email
     FROM orders WHERE id = ? LIMIT 1`,
    [orderId],
  );
  const identity = {
    ...(row?.account_id ? { accountIdDigest: sha256(row.account_id) } : {}),
    ...(row?.email ? { emailDigest: sha256(row.email) } : {}),
  };
  if (Object.keys(identity).length === 0) {
    throw new Error('order has no Browser identity digest for readonly account verification');
  }
  return identity;
}

export async function runProductionReadonlyBrowserWorker({
  env = process.env,
  once = false,
  signal = null,
  browserType = chromium,
  onResult = (result) => console.log('browser readonly iteration', {
    status: result.status,
    reasonCode: result.reasonCode || null,
  }),
} = {}) {
  const config = loadProductionReadonlyBrowserConfig(env);
  const database = loadRuntimeDatabaseConfig({
    NODE_ENV: env.NODE_ENV || 'production',
    DATABASE_URL: config.databaseUrl,
    DATABASE_TLS: String(config.databaseTls),
    DATABASE_TLS_CA_BASE64: env.DATABASE_TLS_CA_BASE64,
  });
  const pool = createDatabasePool(database);
  let heartbeatStarted = false;
  const writeHeartbeat = async (value = new Date().toISOString()) => {
    await pool.query(
      `UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE setting_key = 'browser_worker_heartbeat_at'`,
      [value],
    );
  };
  try {
    await checkProductionReadonlyFilesystem(config);
    await checkProductionReadonlyDatabase(pool, { executorProfileId: config.executorProfileId });
    if (env.BROWSER_WORKER_CHECK_ONLY === 'true') return { status: 'READY' };
    await writeHeartbeat();
    heartbeatStarted = true;
    const wal = await new AppendOnlyWal({ filePath: config.walPath }).init();
    await wal.verify();
    const runtimeAdapter = config.target === 'BITBROWSER_READONLY'
      ? new BitBrowserControlRuntimeAdapter({
        browserType,
        apiBaseUrl: config.bitbrowserApiBaseUrl,
        bitbrowserProfileId: config.bitbrowserProfileId,
      })
      : new GoogleChromeControlRuntimeAdapter({
      browserType,
      profilesRoot: config.profilesRoot,
      executablePath: config.executablePath,
      launchOptions: { headless: config.headless },
    });
    const sharedMaterialsEnabled = config.materialPolicy.sharedSessionEnabled;
    const sharedCardPreflightEnabled = config.materialPolicy.sharedCardPreflightEnabled;
    const chatGptReadonlyHarness = config.readonlyHarness === 'CHATGPT_ACCOUNT_CHECKOUT';
    const sessionProvider = sharedMaterialsEnabled
      ? new CookieSessionBootstrapAdapter({
        source: new SharedEncryptedSessionSource({
          db: pool,
          encryptionKey: config.sharedMaterialEncryptionKey,
        }),
      })
      : null;
    // The real ChatGPT readonly harness has no reason to decrypt PAN/CVC.
    // Card material preflight remains available only to isolated PAGE_ONLY fixtures.
    const cardMaterialLeaseProvider = sharedCardPreflightEnabled
      ? new InMemoryCardMaterialLeaseProvider({
        source: new SharedEncryptedCardMaterialSource({
          db: pool,
          encryptionKey: config.sharedMaterialEncryptionKey,
        }),
      })
      : null;
    const worker = createSharedNonPaymentDryRun({
      pool,
      workerId: config.workerId,
      executorProfileId: config.executorProfileId,
      runtimeAdapter,
      manifest: config.target === 'BITBROWSER_READONLY'
        ? createBitBrowserControlManifest()
        : createChromeControlManifest(),
      observation: config.observation,
      resolveObservation: chatGptReadonlyHarness
        ? async ({ orderId, baseObservation }) => ({
          ...baseObservation,
          sessionIdentity: await resolveSessionIdentityDigests(pool, { orderId }),
        })
        : null,
      sessionProvider,
      resolveSessionRef: sharedMaterialsEnabled
        ? ({ runId }) => browserRunMaterialRef(runId)
        : async () => null,
      cardMaterialLeaseProvider,
      resolveCardMaterialRef: sharedCardPreflightEnabled
        ? ({ runId }) => browserRunMaterialRef(runId)
        : async () => null,
      validateCardMaterialOnly: sharedCardPreflightEnabled,
      resolveAccountKey: (input) => resolveAccountKey(pool, input),
      runtimeHmacKey: config.runtimeHmacKey,
      artifactKey: config.artifactKey,
      resourceHmacKey: config.resourceHmacKey,
      evidenceSink: new CompositeEvidenceSink([new WalEvidenceSink(wal), new MysqlEvidenceSink({ pool, workerId: config.workerId })]),
      leaseSeconds: config.leaseSeconds,
      executionTimeoutMs: config.executionTimeoutMs,
    });
    const preflightWorker = chatGptReadonlyHarness
      ? createBrowserOrderPreflightWorker({
        pool,
        workerId: config.workerId,
        executorProfileId: config.executorProfileId,
        runtimeAdapter,
        manifest: config.target === 'BITBROWSER_READONLY'
          ? createBitBrowserControlManifest()
          : createChromeControlManifest(),
        observation: config.observation,
        encryptionKey: config.sharedMaterialEncryptionKey,
        evidenceSink: new CompositeEvidenceSink([new WalEvidenceSink(wal), new MysqlEvidenceSink({ pool, workerId: config.workerId })]),
        leaseSeconds: config.leaseSeconds,
        executionTimeoutMs: config.executionTimeoutMs,
      })
      : null;

    do {
      await writeHeartbeat();
      if (preflightWorker) {
        const preflightResult = await preflightWorker.runOnce();
        if (preflightResult.status !== 'IDLE') {
          await onResult(preflightResult);
          if (once || signal?.aborted) return preflightResult;
          continue;
        }
      }
      const result = await worker.runOnce({ confirmation: SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION });
      await onResult(result);
      if (once || signal?.aborted) return result;
      if (result.status === 'IDLE') await delay(config.pollIntervalMs, signal);
    } while (!signal?.aborted);
    return { status: 'STOPPED' };
  } finally {
    if (heartbeatStarted) await writeHeartbeat('').catch(() => {});
    await pool.end();
  }
}

export function parseProductionReadonlyArgs(argv = []) {
  const unsupported = argv.filter((arg) => !['--check', '--once'].includes(arg));
  if (unsupported.length) throw new Error('unsupported Browser Worker argument');
  if (argv.includes('--check') && argv.includes('--once')) {
    throw new Error('--check and --once are mutually exclusive');
  }
  return {
    checkOnly: argv.includes('--check'),
    once: argv.includes('--once') || argv.includes('--check'),
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseProductionReadonlyArgs(argv);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    const result = await runProductionReadonlyBrowserWorker({
      env: { ...env, BROWSER_WORKER_CHECK_ONLY: args.checkOnly ? 'true' : 'false' },
      once: args.once,
      signal: controller.signal,
    });
    console.log('browser production-readonly worker stopped', { status: result.status });
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error('browser production-readonly worker failed', {
      name: error?.name || 'Error',
      code: error?.code || 'BROWSER_WORKER_FAILED',
    });
    process.exitCode = 1;
  });
}
