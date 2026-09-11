import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { loadRuntimeDatabaseConfig } from '../../v1/src/config.js';
import { createDatabasePool } from '../../v1/src/db/pool.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { HnskjCardProvider } from '../../v1/src/providers/hnskj-card.js';
import { createBrowserPaymentVerificationService } from '../../v1/src/services/browser-payment-verification-service.js';
import { BillingAddressEnrichedCardMaterialSource, BrowserCardTransactionReader } from './browser-card-transaction-reader.js';
import { BitBrowserControlRuntimeAdapter } from './bitbrowser-control-runtime.js';
import { BrowserOrderEncryptedSessionSource, createBrowserOrderPreflightWorker } from './browser-order-preflight.js';
import { DurableCardMaterialLeaseProvider } from './durable-card-material-lease.js';
import { createBitBrowserControlManifest } from './fixtures.js';
import { LivePostPaymentRecoveryVerifier } from './live-post-payment-recovery.js';
import { MockAddressBillingAddressSource, MysqlBillingAddressAssignmentStore } from './mockaddress-billing-address-source.js';
import {
  BROWSER_LIVE_STOP_BEFORE_SUBMIT, ProductionLiveConfigError, integer, key32, localApiUrl, required,
} from './production-live-config.js';
import {
  REQUIRED_PRODUCTION_LIVE_MIGRATIONS, checkProductionLiveBitBrowser, observation, preflightObservation,
  resolveAccountKey, resolveCardContext, resolveIdentity, resolveOrderPlan, withPoolLifecycle,
} from './production-live-worker.js';
import { ExtensionSessionBootstrapAdapter } from './extension-session-bootstrap.js';
import { CookieSessionBootstrapAdapter } from './session-bootstrap.js';
import {
  browserRunMaterialRef, SharedEncryptedCardMaterialSource, SharedEncryptedSessionSource, SharedPostPaymentSessionSource,
} from './shared-encrypted-materials.js';
import { createSharedLivePaymentWorker } from './shared-live-composition.js';
import { AppendOnlyWal, WalEvidenceSink } from './wal.js';
import { CompositeEvidenceSink, MysqlEvidenceSink } from './mysql-evidence-sink.js';

export const POOL_CONFIRMATION_PREFIX = 'I-CONFIRM-RESIDENT-BROWSER-POOL:';
export const POOL_MODES = Object.freeze({ PAY: 'PAY', REHEARSAL: 'REHEARSAL' });

/**
 * Resident identity pool: N BitBrowser profiles, each a lane. A lane loops
 * over (post-payment verification → order preflight → next queued Browser
 * job) and never closes its window. There is no per-order confirmation;
 * payment authority is the database flag + permit + unique PAYMENT_SUBMIT.
 * REHEARSAL lanes run the same path and stop before the click.
 */
export function parsePoolLanes(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new ProductionLiveConfigError('BROWSER_POOL_LANES is required (laneId=bitbrowserProfileId,...)');
  const lanes = text.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [laneId, profileId, ...rest] = item.split('=').map((part) => part.trim());
    if (!laneId || !profileId || rest.length || !/^[a-z0-9][a-z0-9-]{0,31}$/i.test(laneId) || !/^[a-f0-9]{32}$/i.test(profileId)) {
      throw new ProductionLiveConfigError(`BROWSER_POOL_LANES entry is invalid: ${item.slice(0, 40)}`);
    }
    return { laneId, bitbrowserProfileId: profileId.toLowerCase() };
  });
  if (lanes.length < 1 || lanes.length > 6) throw new ProductionLiveConfigError('BROWSER_POOL_LANES must list 1 to 6 lanes');
  const ids = new Set(lanes.map((lane) => lane.laneId)); const profiles = new Set(lanes.map((lane) => lane.bitbrowserProfileId));
  if (ids.size !== lanes.length || profiles.size !== lanes.length) throw new ProductionLiveConfigError('BROWSER_POOL_LANES lane ids and profile ids must be unique');
  return Object.freeze(lanes);
}

export function loadProductionLivePoolConfig(env = process.env) {
  if (required(env, 'BROWSER_WORKER_MODE') !== 'PRODUCTION_LIVE_POOL') {
    throw new ProductionLiveConfigError('BROWSER_WORKER_MODE must be PRODUCTION_LIVE_POOL');
  }
  const checkOnly = env.BROWSER_WORKER_CHECK_ONLY === 'true';
  const confirmation = required(env, 'BROWSER_POOL_CONFIRMATION');
  if (!confirmation.startsWith(POOL_CONFIRMATION_PREFIX)) throw new ProductionLiveConfigError('BROWSER_POOL_CONFIRMATION must name the pool mode');
  const mode = confirmation.slice(POOL_CONFIRMATION_PREFIX.length);
  if (!Object.values(POOL_MODES).includes(mode)) throw new ProductionLiveConfigError('pool mode must be PAY or REHEARSAL');
  const stopBefore = String(env.BROWSER_LIVE_STOP_BEFORE ?? '').trim().toUpperCase();
  if (mode === POOL_MODES.REHEARSAL && stopBefore !== BROWSER_LIVE_STOP_BEFORE_SUBMIT) throw new ProductionLiveConfigError('REHEARSAL pool requires BROWSER_LIVE_STOP_BEFORE=SUBMIT');
  if (mode === POOL_MODES.PAY && stopBefore) throw new ProductionLiveConfigError('PAY pool must not set BROWSER_LIVE_STOP_BEFORE');
  const paying = mode === POOL_MODES.PAY && !checkOnly;
  for (const name of ['BROWSER_PAYMENT_WRITES_ENABLED', 'BROWSER_PAYMENT_EXECUTOR_ENABLED']) {
    const expected = paying ? 'true' : 'false';
    if (env[name] !== expected) throw new ProductionLiveConfigError(`${name} must be exactly ${expected} for this pool mode`);
  }
  if (env.BROWSER_PAYMENT_EXECUTOR_MODE !== 'LIVE') throw new ProductionLiveConfigError('BROWSER_PAYMENT_EXECUTOR_MODE must be exactly LIVE');
  for (const name of ['PROVIDER_WRITES_ENABLED', 'PROVIDER_CARD_WRITES_ENABLED', 'PROVIDER_RECHARGE_WRITES_ENABLED', 'CARD_FUNDING_WRITES_ENABLED']) {
    if (env[name] !== 'false') throw new ProductionLiveConfigError(`${name} must be exactly false`);
  }
  for (const name of ['CHATGPT_SESSION_COOKIE', 'CHATGPT_TOKEN', 'SESSION_JSON', 'CARD_NUMBER', 'CARD_EXPIRY', 'CARD_CVC', 'ZZSHU_API_KEY']) {
    if (String(env[name] ?? '').trim()) throw new ProductionLiveConfigError(`${name} must be absent from the pool Worker environment`);
  }
  if (env.PROVIDER_READS_ENABLED !== 'true' && String(env.HNSKJ_API_KEY ?? '').trim()) throw new ProductionLiveConfigError('HNSKJ_API_KEY requires PROVIDER_READS_ENABLED=true');
  // Stage 2 of Pro orders. STOP_BEFORE_PAY (default): open the upgrade dialog and
  // hand off before Pay now. PAY is not implemented yet and is refused.
  const upgradeStage = String(env.BROWSER_UPGRADE_STAGE || 'STOP_BEFORE_PAY').trim().toUpperCase();
  if (upgradeStage !== 'STOP_BEFORE_PAY') throw new ProductionLiveConfigError('BROWSER_UPGRADE_STAGE must be STOP_BEFORE_PAY (PAY is not implemented)');
  // A/B lane, not a promoted default: CookieSessionBootstrapAdapter writes the
  // session cookie directly; EXTENSION drives the already-installed 上号器
  // popup instead (see extension-session-bootstrap.js for why). Comparison is
  // ongoing (docs/HANDOFF_LOG.md 2026-09-10/11) — default stays COOKIE.
  const sessionProviderMode = String(env.BROWSER_SESSION_PROVIDER || 'COOKIE').trim().toUpperCase();
  if (sessionProviderMode !== 'COOKIE' && sessionProviderMode !== 'EXTENSION') {
    throw new ProductionLiveConfigError('BROWSER_SESSION_PROVIDER must be COOKIE or EXTENSION');
  }
  const lanes = parsePoolLanes(env.BROWSER_POOL_LANES);
  const runtimeHmacKey = key32(env, 'BROWSER_RUNTIME_HMAC_KEY_BASE64');
  const artifactKey = key32(env, 'BROWSER_ARTIFACT_KEY_BASE64');
  const resourceHmacKey = key32(env, 'BROWSER_RESOURCE_HMAC_KEY_BASE64');
  const materialEncryptionKey = key32(env, 'SESSION_ENCRYPTION_KEY_BASE64');
  if (new Set([runtimeHmacKey, artifactKey, resourceHmacKey, materialEncryptionKey].map((value) => value.toString('hex'))).size !== 4) {
    throw new ProductionLiveConfigError('pool runtime, artifact, resource and material keys must be distinct');
  }
  return Object.freeze({
    checkOnly, mode, paying, stopBeforeSubmit: mode === POOL_MODES.REHEARSAL, lanes, upgradeStage, sessionProviderMode,
    databaseUrl: required(env, 'DATABASE_URL'), databaseTls: env.DATABASE_TLS === 'true',
    workerIdPrefix: String(env.BROWSER_WORKER_ID || 'pool').trim() || 'pool',
    executorProfileId: required(env, 'BROWSER_EXECUTOR_PROFILE_ID'),
    bitbrowserApiBaseUrl: localApiUrl(required(env, 'BITBROWSER_API_BASE_URL')),
    providerReadsEnabled: env.PROVIDER_READS_ENABLED === 'true',
    hnskjApiBaseUrl: String(env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1').trim(),
    hnskjApiKey: env.PROVIDER_READS_ENABLED === 'true' ? String(env.HNSKJ_API_KEY || '').trim() || null : null,
    billingAddressState: String(env.BROWSER_BILLING_ADDRESS_STATE || 'DE').trim().toUpperCase(),
    billingAddressName: required(env, 'BROWSER_BILLING_ADDRESS_NAME'),
    stateDir: required(env, 'BROWSER_POOL_STATE_DIR'),
    runtimeHmacKey, artifactKey, resourceHmacKey, materialEncryptionKey,
    pollIntervalMs: integer(env, 'BROWSER_POOL_POLL_INTERVAL_MS', { min: 500, max: 60_000, fallback: 3_000 }),
    leaseSeconds: integer(env, 'BROWSER_WORKER_LEASE_SECONDS', { min: 10, max: 3600, fallback: 120 }),
    executionTimeoutMs: integer(env, 'BROWSER_EXECUTION_TIMEOUT_MS', { min: 1_000, max: 300_000, fallback: 120_000 }),
    verificationWindowMs: integer(env, 'BROWSER_PAYMENT_VERIFICATION_WINDOW_MS', { min: 30_000, max: 3_600_000, fallback: 300_000 }),
    verificationIntervalMs: integer(env, 'BROWSER_PAYMENT_VERIFICATION_INTERVAL_MS', { min: 1_000, max: 60_000, fallback: 5_000 }),
    // D-154: seconds a clicked checkout is held while a PERSON satisfies a human
    // verification challenge. 0 (default) only detects and reports it.
    humanVerificationWaitMs: integer(env, 'BROWSER_HUMAN_VERIFICATION_WAIT_MS', { min: 0, max: 900_000, fallback: 0 }),
  });
}

export async function checkProductionLivePoolDatabase(pool, config) {
  const placeholders = REQUIRED_PRODUCTION_LIVE_MIGRATIONS.map(() => '?').join(',');
  const [[migration]] = await pool.query(`SELECT COUNT(DISTINCT version) AS present FROM schema_migrations WHERE version IN (${placeholders})`, REQUIRED_PRODUCTION_LIVE_MIGRATIONS);
  if (Number(migration?.present) !== REQUIRED_PRODUCTION_LIVE_MIGRATIONS.length) throw new Error('required Browser LIVE migrations are not applied');
  const [settings] = await pool.query(`SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('browser_dispatch_enabled','browser_payment_writes_enabled')`);
  const values = new Map(settings.map((row) => [row.setting_key, String(row.setting_value).toLowerCase()]));
  const expectedPayment = config.paying ? 'true' : 'false';
  if (values.get('browser_payment_writes_enabled') !== expectedPayment) throw new Error(`database browser_payment_writes_enabled must be ${expectedPayment} for a ${config.mode} pool`);
  if (values.get('browser_dispatch_enabled') !== 'true') throw new Error('database browser_dispatch_enabled must be true');
  const [[profile]] = await pool.query(
    `SELECT executor_kind, status, JSON_UNQUOTE(JSON_EXTRACT(config_public_json, '$.productionWritesEnabled')) AS production_writes_enabled FROM executor_profiles WHERE id=? LIMIT 1`, [config.executorProfileId],
  );
  if (!profile || profile.executor_kind !== 'BROWSER' || profile.status !== 'ACTIVE') throw new Error('configured Browser executor profile must exist and be ACTIVE');
  if (String(profile.production_writes_enabled).toLowerCase() !== expectedPayment) throw new Error(`Browser profile productionWritesEnabled must be ${expectedPayment}`);
  return { ready: true, mode: config.mode, lanes: config.lanes.length };
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener('abort', done); clearTimeout(timer); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

/**
 * One lane's loop, pure over its three step functions so it can be tested
 * without a browser: each tick runs verification, then preflight, then the
 * next queued job; a non-IDLE result is reported and the tick restarts at
 * once, an IDLE tick sleeps. Errors are reported and backed off, never fatal
 * for the lane: the run/resources they left behind are recovered by lease
 * expiry, and the resident window stays open.
 */
export async function runLaneLoop({ laneId, steps, onResult, onError = async () => undefined, heartbeat = async () => undefined, pollIntervalMs, signal, sleepImpl = sleep }) {
  if (!laneId || !Array.isArray(steps) || steps.some((step) => typeof step.run !== 'function')) throw new TypeError('laneId and steps are required');
  const summary = { laneId, ticks: 0, results: 0, errors: 0 };
  while (!signal?.aborted) {
    summary.ticks += 1;
    let busy = false;
    try {
      await heartbeat();
      for (const step of steps) {
        if (signal?.aborted) break;
        const result = await step.run();
        if (result && result.status !== 'IDLE') {
          summary.results += 1;
          await onResult({ laneId, step: step.name, result });
          busy = true;
          break;
        }
      }
    } catch (error) {
      summary.errors += 1;
      await onError({ laneId, error });
      await sleepImpl(Math.min(pollIntervalMs * 5, 30_000), signal);
      continue;
    }
    if (!busy) await sleepImpl(pollIntervalMs, signal);
  }
  return summary;
}

function laneLogger(laneId) {
  return (event, data) => console.log(`[pool:${laneId}] ${event}`, data);
}

export async function createLaneWorker({ lane, config, pool, browserType, shared }) {
  const workerId = `${config.workerIdPrefix}:${lane.laneId}`;
  const walPath = `${config.stateDir}/${lane.laneId}.wal`;
  const cardLeasePath = `${config.stateDir}/${lane.laneId}-card-leases.json`;
  const wal = await new AppendOnlyWal({ filePath: walPath }).init();
  await wal.verify();
  // Integrity stays in the lane's WAL; the operator timeline lands in the database.
  const evidenceSink = new CompositeEvidenceSink([new WalEvidenceSink(wal), new MysqlEvidenceSink({ pool, workerId })]);
  const runtimeAdapter = new BitBrowserControlRuntimeAdapter({
    browserType, apiBaseUrl: config.bitbrowserApiBaseUrl, bitbrowserProfileId: lane.bitbrowserProfileId, residentProfile: true,
  });
  const manifest = createBitBrowserControlManifest();
  const cardMaterialLeaseProvider = await new DurableCardMaterialLeaseProvider({ source: shared.enrichedCardSource, filePath: cardLeasePath }).init();
  const transactionReaderFactory = async ({ runId }) => {
    const card = await resolveCardContext(pool, runId);
    const sourceKind = card.sync_tier === 'MANUAL_IMPORT' || card.provider_code === 'manual_excel' ? 'MANUAL_IMPORT' : 'HNSKJ';
    if (sourceKind === 'HNSKJ' && (!config.providerReadsEnabled || !shared.provider)) throw new Error('HNSKJ transaction verification requires explicit Provider read credentials');
    return new BrowserCardTransactionReader({ sourceKind, provider: shared.provider, providerCardId: card.provider_card_id, runId, submitIntentAt: card.submit_intent_at, matchWindowMs: config.verificationWindowMs });
  };
  // Plus orders finish by cancelling auto-renew; Pro orders stop on the upgrade dialog (D-133).
  const postPlusActionForPlan = (plan) => (String(plan || 'plus') === 'plus' ? 'CANCEL_RENEWAL' : 'UPGRADE_DIALOG_STOP');
  const recoveryVerifier = new LivePostPaymentRecoveryVerifier({
    runtimeAdapter, manifest, sessionProvider: shared.postPaymentSessionProvider,
    resolveSessionIdentity: ({ orderId }) => resolveIdentity(pool, { orderId }), transactionReaderFactory,
    navigationTimeoutMs: config.executionTimeoutMs, verificationWindowMs: config.verificationWindowMs,
    verificationIntervalMs: config.verificationIntervalMs, postPlusAction: postPlusActionForPlan,
  });
  const verification = createBrowserPaymentVerificationService({
    repository: createBrowserExecutionRepository(pool), verifier: recoveryVerifier, maxBatch: 1,
    postPlusAction: (row) => postPlusActionForPlan(row.plan),
    verificationIntervalMs: config.verificationIntervalMs,
  });
  const PreflightSessionAdapter = config.sessionProviderMode === 'EXTENSION'
    ? ExtensionSessionBootstrapAdapter : CookieSessionBootstrapAdapter;
  const preflight = createBrowserOrderPreflightWorker({
    pool, workerId, executorProfileId: config.executorProfileId, runtimeAdapter, manifest, observation: preflightObservation(),
    encryptionKey: config.materialEncryptionKey, evidenceSink, leaseSeconds: config.leaseSeconds,
    executionTimeoutMs: config.executionTimeoutMs,
    sessionProvider: new PreflightSessionAdapter({
      source: new BrowserOrderEncryptedSessionSource({ db: pool, encryptionKey: config.materialEncryptionKey }),
    }),
  });
  const live = createSharedLivePaymentWorker({
    pool, workerId, executorProfileId: config.executorProfileId, approvedOrderId: null, runtimeAdapter, manifest,
    observation: observation(), sessionProvider: shared.sessionProvider, cardMaterialLeaseProvider,
    resolveAccountKey: (input) => resolveAccountKey(pool, input), resolveSessionIdentity: (input) => resolveIdentity(pool, input), resolvePlan: (input) => resolveOrderPlan(pool, input),
    resolveSessionRef: ({ runId }) => browserRunMaterialRef(runId), resolveCardMaterialRef: ({ runId }) => browserRunMaterialRef(runId),
    transactionReaderFactory, runtimeHmacKey: config.runtimeHmacKey, artifactKey: config.artifactKey, resourceHmacKey: config.resourceHmacKey,
    evidenceSink, leaseSeconds: config.leaseSeconds, executionTimeoutMs: config.executionTimeoutMs,
    verificationWindowMs: config.verificationWindowMs, verificationIntervalMs: config.verificationIntervalMs,
    humanVerificationWaitMs: config.humanVerificationWaitMs,
    postPlusAction: postPlusActionForPlan, stopBeforeSubmit: config.stopBeforeSubmit, releaseSessionOnComplete: true, safeAbortOnFailure: true,
  });
  return Object.freeze({
    laneId: lane.laneId, workerId,
    steps: Object.freeze([
      { name: 'post-payment-verification', run: () => verification.runOnce() },
      { name: 'order-preflight', run: () => preflight.runOnce() },
      { name: 'live', run: () => live.runOnce() },
    ]),
  });
}

export async function runProductionLivePoolWorker({ env = process.env, browserType = chromium, signal = null } = {}) {
  const config = loadProductionLivePoolConfig(env);
  const database = loadRuntimeDatabaseConfig({
    NODE_ENV: env.NODE_ENV || 'production', DATABASE_URL: config.databaseUrl,
    DATABASE_TLS: String(config.databaseTls), DATABASE_TLS_CA_BASE64: env.DATABASE_TLS_CA_BASE64,
  });
  const pool = createDatabasePool(database);
  return withPoolLifecycle(pool, async () => {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    const dbCheck = await checkProductionLivePoolDatabase(pool, config);
    const laneChecks = [];
    for (const lane of config.lanes) laneChecks.push(await checkProductionLiveBitBrowser({ bitbrowserApiBaseUrl: config.bitbrowserApiBaseUrl, bitbrowserProfileId: lane.bitbrowserProfileId }));
    if (config.checkOnly) return { status: 'READY', mode: config.mode, lanes: laneChecks.map((item) => item.bitbrowserProfileId), database: dbCheck };
    const addressSource = new MockAddressBillingAddressSource({ state: config.billingAddressState, name: config.billingAddressName, assignmentStore: new MysqlBillingAddressAssignmentStore({ pool }) });
    const rawCardSource = new SharedEncryptedCardMaterialSource({ db: pool, encryptionKey: config.materialEncryptionKey });
    const SessionProviderAdapter = config.sessionProviderMode === 'EXTENSION' ? ExtensionSessionBootstrapAdapter : CookieSessionBootstrapAdapter;
    const shared = {
      enrichedCardSource: new BillingAddressEnrichedCardMaterialSource({
        cardSource: rawCardSource, billingAddressSource: addressSource,
        resolveBillingAddressRef: async (runRef) => `card:${(await resolveCardContext(pool, String(runRef).replace(/^browser-run:/, ''))).card_id}`,
      }),
      sessionProvider: new SessionProviderAdapter({ source: new SharedEncryptedSessionSource({ db: pool, encryptionKey: config.materialEncryptionKey }) }),
      postPaymentSessionProvider: new SessionProviderAdapter({ source: new SharedPostPaymentSessionSource({ db: pool, encryptionKey: config.materialEncryptionKey }) }),
      provider: config.hnskjApiKey ? new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey }) : null,
    };
    let lastHeartbeat = 0;
    const heartbeat = async () => {
      if (Date.now() - lastHeartbeat < 5_000) return;
      lastHeartbeat = Date.now();
      await pool.query(`UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE setting_key = 'browser_worker_heartbeat_at'`, [new Date().toISOString()]);
    };
    const lanes = [];
    for (const lane of config.lanes) lanes.push(await createLaneWorker({ lane, config, pool, browserType, shared }));
    console.log('browser pool worker started', { mode: config.mode, lanes: lanes.map((lane) => lane.workerId) });
    const summaries = await Promise.all(lanes.map((lane) => runLaneLoop({
      laneId: lane.laneId, steps: lane.steps, pollIntervalMs: config.pollIntervalMs, signal, heartbeat,
      onResult: async ({ laneId, step, result }) => laneLogger(laneId)(step, { status: result.status, reasonCode: result.reasonCode || null, orderId: result.orderId || null, ...(result.diagnosticMessage ? { diagnosticMessage: result.diagnosticMessage } : {}), ...(result.quote ? { quote: result.quote } : {}) }),
      onError: async ({ laneId, error }) => laneLogger(laneId)('error', { code: error?.code || 'LANE_FAILURE', message: String(error?.message || '').slice(0, 200) }),
    })));
    return { status: 'STOPPED', mode: config.mode, lanes: summaries };
  });
}

export function parseProductionLivePoolArgs(argv = []) {
  const unsupported = argv.filter((arg) => !['--check', '--run'].includes(arg));
  if (unsupported.length || argv.includes('--check') === argv.includes('--run')) throw new Error('pool Worker requires exactly one of --check or --run');
  return { checkOnly: argv.includes('--check') };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { checkOnly } = parseProductionLivePoolArgs(argv);
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { console.log(`browser pool worker stopping on ${sig}`); controller.abort(); });
  const result = await runProductionLivePoolWorker({ env: { ...env, BROWSER_WORKER_CHECK_ONLY: checkOnly ? 'true' : 'false' }, signal: controller.signal });
  console.log('browser pool worker stopped', result);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error('browser pool worker failed', { name: error?.name || 'Error', code: error?.code || 'BROWSER_POOL_WORKER_FAILED', message: String(error?.message || '').slice(0, 300) });
    process.exitCode = 1;
  });
}
