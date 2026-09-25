import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { loadRuntimeDatabaseConfig } from '../../v1/src/config.js';
import { createDatabasePool } from '../../v1/src/db/pool.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { HnskjCardProvider } from '../../v1/src/providers/hnskj-card.js';
import { createBrowserPaymentVerificationService } from '../../v1/src/services/browser-payment-verification-service.js';
import { BillingAddressEnrichedCardMaterialSource, BrowserCardTransactionReader, createCardLedgerSource, createHighvccLedgerRefresh } from './browser-card-transaction-reader.js';
import { BitBrowserControlRuntimeAdapter } from './bitbrowser-control-runtime.js';
import { BrowserOrderEncryptedSessionSource, createBrowserOrderPreflightWorker } from './browser-order-preflight.js';
import { DurableCardMaterialLeaseProvider } from './durable-card-material-lease.js';
import { createBitBrowserControlManifest } from './fixtures.js';
import { LivePostPaymentRecoveryVerifier } from './live-post-payment-recovery.js';
import { ChatGptPostPaymentVerifier, POST_PAYMENT_VERIFICATION_MAX_MS } from './chatgpt-post-payment-verifier.js';
import { createPostClickTiming } from './post-click-timing.js';
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
import { createHighvccSnapshotSyncService } from '../../v1/src/services/highvcc-snapshot-sync-service.js';

export const POOL_CONFIRMATION_PREFIX = 'I-CONFIRM-RESIDENT-BROWSER-POOL:';
export const POOL_MODES = Object.freeze({ PAY: 'PAY', REHEARSAL: 'REHEARSAL' });

/**
 * Resident identity pool: N BitBrowser profiles, each a lane. A lane loops
 * over (post-payment verification → order preflight → next queued Browser
 * job) and never closes its window. There is no per-order confirmation;
 * payment authority is the database flag + permit + unique PAYMENT_SUBMIT.
 * REHEARSAL lanes run the same path and stop before the click.
 */
/**
 * 块 6（D-245/D-370）：Pro 与 Plus 同型——一次付款、确认、取消续费。旧「先 Plus 后升级」（D-133）退休，
 * 常驻池不再让任何套餐走进 UPGRADE_DIALOG_STOP；那段旧代码与 BROWSER_UPGRADE_STAGE 留到之后清理。
 */
export function postPlusActionForPlan() {
  return 'CANCEL_RENEWAL';
}

/** 这次 Browser 运行属于哪一单、买的什么套餐（套餐规则只在 resolveOrderPlan 一处）。 */
async function resolveRunPlan(pool, runId) {
  const [[row]] = await pool.query(
    `SELECT rat.order_id FROM browser_runs br INNER JOIN recharge_attempts rat ON rat.id=br.recharge_attempt_id WHERE br.id=? LIMIT 1`, [runId],
  );
  if (!row?.order_id) throw new Error('Browser run order is unavailable');
  return resolveOrderPlan(pool, { orderId: row.order_id });
}

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
  // 付款后立刻回填卡余额用（D-195），**可选**：没配就退回小时级 timer，执行器照常启动。
  // 付款比回填重要，绝不能因为少一把回填用的 key 就让整个池起不来。
  const cardIntakePanHmacKey = env.CARD_INTAKE_PAN_HMAC_KEY_BASE64
    ? key32(env, 'CARD_INTAKE_PAN_HMAC_KEY_BASE64') : null;
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
    runtimeHmacKey, artifactKey, resourceHmacKey, materialEncryptionKey, cardIntakePanHmacKey,
    pollIntervalMs: integer(env, 'BROWSER_POOL_POLL_INTERVAL_MS', { min: 500, max: 60_000, fallback: 3_000 }),
    leaseSeconds: integer(env, 'BROWSER_WORKER_LEASE_SECONDS', { min: 10, max: 3600, fallback: 120 }),
    executionTimeoutMs: integer(env, 'BROWSER_EXECUTION_TIMEOUT_MS', { min: 1_000, max: 300_000, fallback: 120_000 }),
    // 上限跟核实器同一份（D-389）：填超了池启动就报错，而不是每张真付款单在填卡前报错。
    verificationWindowMs: integer(env, 'BROWSER_PAYMENT_VERIFICATION_WINDOW_MS', { min: 30_000, max: POST_PAYMENT_VERIFICATION_MAX_MS, fallback: 300_000 }),
    verificationIntervalMs: integer(env, 'BROWSER_PAYMENT_VERIFICATION_INTERVAL_MS', { min: 1_000, max: 60_000, fallback: 5_000 }),
    // D-154: seconds a clicked checkout is held while a PERSON satisfies a human
    // verification challenge. 0 (default) only detects and reports it.
    humanVerificationWaitMs: integer(env, 'BROWSER_HUMAN_VERIFICATION_WAIT_MS', { min: 0, max: 900_000, fallback: 0 }),
    // D-210：现场保留后等运营接手的窗口。0 = 关掉这个行为，退回"当场判失败"。
    operatorTakeoverWindowMs: integer(env, 'BROWSER_OPERATOR_TAKEOVER_WINDOW_MS', { min: 0, max: 1_800_000, fallback: 90_000 }),
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

/**
 * Lane guard: which of this lane's own runs must keep the window to itself.
 *
 * RUNNING / RECONCILE_ONLY with a payment in flight means the lane's resident
 * window is still needed by that run — either the click happened moments ago and
 * the same window watches for the outcome, or the automatic verification
 * (step 1 of the tick) is re-injecting that account's session into this window.
 * Starting another order now would tear the page out from under it.
 *
 * HUMAN_REQUIRED is deliberately **not** in the list (D-352 块 3 ①). Before
 * 2026-09-23 it was, and one order whose payment result could not be settled
 * automatically parked the whole lane until a person clicked 「确认核实结果」
 * in the admin — with a single lane that meant every later customer waited on
 * one unresolved order. A HUMAN_REQUIRED run no longer uses the window: its
 * verification_next_check_at is NULL, the money is fenced by
 * recharge_attempts.funds_risk_state, and the account itself stays locked by
 * uq_browser_runs_active_account, so a second order for the *same* account still
 * cannot start (the dispatch claim skips it). Other accounts proceed.
 */
export const LANE_BLOCKING_RUNS_SQL = `SELECT COUNT(*) AS count FROM browser_runs WHERE worker_id=?
         AND status IN ('RUNNING','RECONCILE_ONLY')
         AND payment_state IN ('PAYMENT_SUBMITTING','PAYMENT_UNKNOWN','PAYMENT_CONFIRMED')`;

export function withLaneGuard({ query, workerId }) {
  if (typeof query !== 'function' || !workerId) throw new TypeError('query and workerId are required');
  return (step) => async () => {
    const [[pending]] = await query(LANE_BLOCKING_RUNS_SQL, [workerId]);
    if (Number(pending?.count) > 0) return { status: 'IDLE' };
    return step();
  };
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
  // 第④步（D-268 ①）：备用卡台 A 的卡走 card_transactions 真证据；无候选时用 token 再拉一次。
  const highvccLedgerRefresh = createHighvccLedgerRefresh({ pool, encryptionKey: config.materialEncryptionKey, panHmacKey: Buffer.from(String(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64 || ''), 'base64') });
  const transactionReaderFactory = async ({ runId }) => {
    const card = await resolveCardContext(pool, runId);
    // D-246 面一 C1：交易读取器按卡的来源层标记（sync_tier）判，不看卡台名字。
    const sourceKind = card.sync_tier === 'MANUAL_IMPORT' ? 'MANUAL_IMPORT' : 'HNSKJ';
    if (sourceKind === 'HNSKJ' && (!config.providerReadsEnabled || !shared.provider)) throw new Error('HNSKJ transaction verification requires explicit Provider read credentials');
    // 块 6（D-370）：交易金额按这一单的套餐认（5x 与 Plus 金额区间不同）；套餐只从订单读，同一条规则。
    const plan = await resolveRunPlan(pool, runId);
    return new BrowserCardTransactionReader({ sourceKind, provider: shared.provider, providerCardId: card.provider_card_id, runId, submitIntentAt: card.submit_intent_at, matchWindowMs: config.verificationWindowMs,
      plan, cardId: card.card_id, ledgerSource: sourceKind === 'MANUAL_IMPORT' ? createCardLedgerSource({ pool, refresh: highvccLedgerRefresh }) : null });
  };
  const recoveryVerifier = new LivePostPaymentRecoveryVerifier({
    runtimeAdapter, manifest, sessionProvider: shared.postPaymentSessionProvider,
    resolveSessionIdentity: ({ orderId }) => resolveIdentity(pool, { orderId }), transactionReaderFactory,
    navigationTimeoutMs: config.executionTimeoutMs, verificationWindowMs: config.verificationWindowMs,
    verificationIntervalMs: config.verificationIntervalMs, postPlusAction: postPlusActionForPlan,
    // 块 6：付款后复核也按这一单的套餐确认。套餐来自同一次运行的交易读取器（上面按订单解析），
    // 不另开一条读套餐的路；读不到时按 Plus——5x 单对不上只会进人工，不会重付。
    verifierFactory: (input) => new ChatGptPostPaymentVerifier({ ...input, targetPlan: input.transactionReader?.plan || 'plus' }),
  });
  const verification = createBrowserPaymentVerificationService({
    repository: createBrowserExecutionRepository(pool), verifier: recoveryVerifier, maxBatch: 1, workerId,
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
    operatorTakeoverWindowMs: config.operatorTakeoverWindowMs,
    postClickTiming: shared.postClickTiming,
    postPlusAction: postPlusActionForPlan, stopBeforeSubmit: config.stopBeforeSubmit, releaseSessionOnComplete: true, safeAbortOnFailure: true,
  });
  const withCleanupGuard = withLaneGuard({ query: (sql, params) => pool.query(sql, params), workerId });
  return Object.freeze({
    laneId: lane.laneId, workerId,
    steps: Object.freeze([
      { name: 'post-payment-verification', run: () => verification.runOnce() },
      { name: 'order-preflight', run: withCleanupGuard(() => preflight.runOnce()) },
      { name: 'live', run: withCleanupGuard(() => live.runOnce()) },
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
      // D-389：点完付款后各段耗时，写本机池状态目录（与 WAL 同目录，不进仓库、不上传）。
      postClickTiming: createPostClickTiming({ file: join(config.stateDir, 'post-click-timing.jsonl') }),
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
    // 付款后立刻回填卡余额（D-195，方向由 D-169 定：「单量上来后再按订单驱动」）。
    // 为什么需要：付款确认会把卡置成 DEPLETED、current_balance=NULL，而 highvcc 的卡
    // （sync_tier=MANUAL_IMPORT）不在 pojia-card-read-sync 的范围内——那个 runner 用的是
    // HnskjCardProvider，且 manual_excel 账号 supports_api_sync=0。于是余额只能等
    // pojia-highvcc-snapshot-sync 那个**小时级** timer 回填，这段时间里卡不可分配。
    // 2026-09-13 第一个真实客户单跑完后，系统整整一小时接不了下一单。
    //
    // 这里不新增任何写余额的代码路径——只是把既有的正式快照同步提前触发一次。
    // 多一条写资金数据的路径就多一份漂移风险，当天的两位年份事故就是这么来的（D-194）。
    const refreshCardBalances = config.cardIntakePanHmacKey
      ? createHighvccSnapshotSyncService({
        pool,
        encryptionKey: config.materialEncryptionKey,
        panHmacKey: config.cardIntakePanHmacKey,
      })
      : null;
    if (!refreshCardBalances) {
      console.log('card balance refresh disabled', { reason: 'CARD_INTAKE_PAN_HMAC_KEY_BASE64 not set' });
    }
    const refreshAfterPayment = async (laneId) => {
      if (!refreshCardBalances) return;
      try {
        const { preview } = await refreshCardBalances.commit({ requestedBy: 'browser-pool:after-payment' });
        laneLogger(laneId)('card-balance-refresh', preview?.skipped
          ? { skipped: true, reason: preview.reason }
          : { updated: preview?.updateCount ?? null, cards: preview?.rowCount ?? null });
      } catch (error) {
        // 尽力而为：回填失败只是退回小时级 timer，绝不能影响已经完成的付款。
        laneLogger(laneId)('card-balance-refresh', { failed: String(error?.code || error?.message || '').slice(0, 120) });
      }
    };
    console.log('browser pool worker started', { mode: config.mode, lanes: lanes.map((lane) => lane.workerId) });
    const summaries = await Promise.all(lanes.map((lane) => runLaneLoop({
      laneId: lane.laneId, steps: lane.steps, pollIntervalMs: config.pollIntervalMs, signal, heartbeat,
      onResult: async ({ laneId, step, result }) => {
        laneLogger(laneId)(step, { status: result.status, reasonCode: result.reasonCode || null, orderId: result.orderId || null, ...(result.diagnosticMessage ? { diagnosticMessage: result.diagnosticMessage } : {}), ...(result.quote ? { quote: result.quote } : {}) });
        if (shouldRefreshCardBalances(result.status)) await refreshAfterPayment(laneId);
      },
      onError: async ({ laneId, error }) => laneLogger(laneId)('error', { code: error?.code || 'LANE_FAILURE', message: String(error?.message || '').slice(0, 200) }),
    })));
    return { status: 'STOPPED', mode: config.mode, lanes: summaries };
  });
}

/**
 * 跑完一单之后要不要立刻回填卡余额（D-195）。
 *
 * `SAFE_ABORTED` 是**付款前**中止——卡上的钱一分没动，去问卡台纯属白打。
 * 2026-09-13 那个真实客户单因为卡材料预检失败连续中止 10 轮（D-194），
 * 不区分的话就是 10 次无谓的卡台请求。`IDLE` 根本没跑活。
 * 其余状态（PROCESSED / UNKNOWN / CONFIRMED / …）都可能已经动过钱，回填一次。
 */
export function shouldRefreshCardBalances(status) {
  return status !== 'SAFE_ABORTED' && status !== 'IDLE';
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
