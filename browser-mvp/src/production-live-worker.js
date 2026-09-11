import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { loadRuntimeDatabaseConfig } from '../../v1/src/config.js';
import { createDatabasePool } from '../../v1/src/db/pool.js';
import { createBrowserExecutionRepository } from '../../v1/src/db/repositories/browser-execution-repository.js';
import { HnskjCardProvider } from '../../v1/src/providers/hnskj-card.js';
import { createBrowserPaymentVerificationService } from '../../v1/src/services/browser-payment-verification-service.js';
import { BillingAddressEnrichedCardMaterialSource, BrowserCardTransactionReader } from './browser-card-transaction-reader.js';
import { BitBrowserControlRuntimeAdapter } from './bitbrowser-control-runtime.js';
import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT } from './chatgpt-checkout-navigator.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT } from './checkout-observer.js';
import { DurableCardMaterialLeaseProvider } from './durable-card-material-lease.js';
import { createBitBrowserControlManifest } from './fixtures.js';
import { LivePostPaymentRecoveryVerifier } from './live-post-payment-recovery.js';
import { MockAddressBillingAddressSource, MysqlBillingAddressAssignmentStore } from './mockaddress-billing-address-source.js';
import { loadProductionLiveBrowserConfig } from './production-live-config.js';
import { CookieSessionBootstrapAdapter } from './session-bootstrap.js';
import {
  browserRunMaterialRef,
  SharedEncryptedCardMaterialSource,
  SharedEncryptedSessionSource,
  SharedPostPaymentSessionSource,
} from './shared-encrypted-materials.js';
import { createSharedLivePaymentWorker } from './shared-live-composition.js';
import { AppendOnlyWal, WalEvidenceSink } from './wal.js';
import { CompositeEvidenceSink, MysqlEvidenceSink } from './mysql-evidence-sink.js';

export const REQUIRED_PRODUCTION_LIVE_MIGRATIONS = Object.freeze([
  '039_card_consumption_attempt_link', '040_card_operational_overrides',
  '041_browser_worker_heartbeat', '047_browser_billing_address_assignments',
  '048_manual_backup_card_import', '049_browser_run_events',
]);

function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex'); }

async function postBitBrowser(apiBaseUrl, path, body = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let envelope;
  try { envelope = await response.json(); } catch { throw new Error(`BitBrowser ${path} returned invalid JSON`); }
  if (!response.ok || envelope?.success !== true) throw new Error(`BitBrowser ${path} failed`);
  return envelope.data;
}

export async function checkProductionLiveFilesystem(config) {
  for (const path of [config.walPath, config.cardLeasePath]) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await access(dirname(path), constants.R_OK | constants.W_OK | constants.X_OK);
  }
  return { ready: true };
}

export async function checkProductionLiveBitBrowser(config) {
  await postBitBrowser(config.bitbrowserApiBaseUrl, '/health');
  const listing = await postBitBrowser(config.bitbrowserApiBaseUrl, '/browser/list', { page: 0, pageSize: 100 });
  const profile = (Array.isArray(listing?.list) ? listing.list : [])
    .find((item) => String(item?.id || '') === config.bitbrowserProfileId);
  if (!profile || String(profile.platform || '').replace(/\/$/, '') !== 'https://chatgpt.com') {
    throw new Error('approved BitBrowser ChatGPT Profile is unavailable');
  }
  return { ready: true, bitbrowserProfileId: config.bitbrowserProfileId };
}

export async function checkProductionLiveDatabase(pool, config) {
  const placeholders = REQUIRED_PRODUCTION_LIVE_MIGRATIONS.map(() => '?').join(',');
  const [[migration]] = await pool.query(
    `SELECT COUNT(DISTINCT version) AS present FROM schema_migrations WHERE version IN (${placeholders})`,
    REQUIRED_PRODUCTION_LIVE_MIGRATIONS,
  );
  if (Number(migration?.present) !== REQUIRED_PRODUCTION_LIVE_MIGRATIONS.length) {
    throw new Error('required Browser LIVE migrations are not applied');
  }
  const [settings] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('browser_dispatch_enabled','browser_payment_writes_enabled')`,
  );
  const values = new Map(settings.map((row) => [row.setting_key, String(row.setting_value).toLowerCase()]));
  const expectedPayment = config.checkOnly || config.stopBeforeSubmit ? 'false' : 'true';
  if (values.get('browser_payment_writes_enabled') !== expectedPayment) {
    throw new Error(`database browser_payment_writes_enabled must be ${expectedPayment}`);
  }
  if (!config.checkOnly && values.get('browser_dispatch_enabled') !== 'true') {
    throw new Error('database browser_dispatch_enabled must be true');
  }
  const [[profile]] = await pool.query(
    `SELECT executor_kind, status,
            JSON_UNQUOTE(JSON_EXTRACT(config_public_json, '$.productionWritesEnabled')) AS production_writes_enabled
     FROM executor_profiles WHERE id=? LIMIT 1`, [config.executorProfileId],
  );
  if (!profile || profile.executor_kind !== 'BROWSER' || profile.status !== 'ACTIVE') {
    throw new Error('configured Browser executor profile must exist and be ACTIVE');
  }
  if (String(profile.production_writes_enabled).toLowerCase() !== expectedPayment) {
    throw new Error(`Browser profile productionWritesEnabled must be ${expectedPayment}`);
  }
  await pool.query('SELECT binding_ref FROM browser_billing_address_assignments LIMIT 0');
  if (!config.checkOnly) {
    const [rows] = await pool.query(
      `SELECT o.id, o.status AS order_status, fr.executor_kind,
              rat.status AS attempt_status, rat.funds_risk_state,
              bdj.status AS dispatch_status, ccl.status AS consumption_status,
              o.frozen_card_provider_account_id, c.provider_account_id
       FROM orders o
       INNER JOIN fulfillment_routes fr ON fr.id=o.fulfillment_route_id
       INNER JOIN recharge_attempts rat ON rat.order_id=o.id AND rat.executor_kind='BROWSER'
       INNER JOIN browser_dispatch_jobs bdj ON bdj.recharge_attempt_id=rat.id
       INNER JOIN card_consumption_ledger ccl ON ccl.recharge_attempt_id=rat.id
       INNER JOIN cards c ON c.id=o.assigned_card_id
       WHERE o.id=? ORDER BY rat.created_at DESC LIMIT 1`, [config.approvedOrderId],
    );
    const row = rows[0];
    if (!row || row.order_status !== 'RECHARGE_PROCESSING' || row.executor_kind !== 'BROWSER'
      || row.attempt_status !== 'PREPARED' || row.funds_risk_state !== 'ACTIVE'
      || !['QUEUED', 'CLAIMED'].includes(row.dispatch_status) || row.consumption_status !== 'RESERVED'
      || row.frozen_card_provider_account_id !== row.provider_account_id) {
      throw new Error('approved order is not at the exact Browser pre-payment boundary');
    }
  }
  return { ready: true, checkOnly: config.checkOnly, approvedOrderId: config.approvedOrderId };
}

export async function resolveIdentity(pool, { orderId }) {
  const [[row]] = await pool.query(
    `SELECT NULLIF(TRIM(chatgpt_account_id),'') AS account_id,
            NULLIF(LOWER(TRIM(customer_email)),'') AS email
     FROM orders WHERE id=? LIMIT 1`, [orderId],
  );
  const identity = {
    ...(row?.account_id ? { accountIdDigest: sha256(row.account_id) } : {}),
    ...(row?.email ? { emailDigest: sha256(row.email) } : {}),
  };
  if (!Object.keys(identity).length) throw new Error('order has no stable ChatGPT identity');
  return identity;
}

const PLAN_BY_PRODUCT_CODE = Object.freeze({ chatgpt_plus: 'plus', chatgpt_pro_5x: 'pro_5x', chatgpt_pro_20x: 'pro_20x' });
const PLAN_BY_LEGACY_TYPE = Object.freeze({ plus: 'plus', pro_5x: 'pro_5x', pro_20x: 'pro_20x', '5x': 'pro_5x', '20x': 'pro_20x' });

/** Which plan picker button this order buys: from the product code, else the legacy plan type. */
export async function resolveOrderPlan(pool, { orderId }) {
  const [[row]] = await pool.query(
    `SELECT LOWER(TRIM(o.plan_type)) AS plan_type, LOWER(TRIM(p.product_code)) AS product_code
     FROM orders o LEFT JOIN products p ON p.id = o.product_id WHERE o.id=? LIMIT 1`, [orderId],
  );
  const plan = PLAN_BY_PRODUCT_CODE[row?.product_code] || PLAN_BY_LEGACY_TYPE[row?.plan_type];
  if (!plan) throw new Error('order product is not a supported Browser plan');
  return plan;
}

export async function resolveAccountKey(pool, { orderId }) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(chatgpt_account_id),''), NULLIF(LOWER(TRIM(customer_email)),'')) AS account_key
     FROM orders WHERE id=? LIMIT 1`, [orderId],
  );
  if (!row?.account_key) throw new Error('order has no stable Browser account identity');
  return String(row.account_key);
}

export async function resolveCardContext(pool, runId) {
  const [[row]] = await pool.query(
    `SELECT c.id AS card_id, c.provider_card_id, c.sync_tier, pa.provider_code,
            MIN(bo.prepared_at) AS submit_intent_at
     FROM browser_runs br
     INNER JOIN recharge_attempts rat ON rat.id=br.recharge_attempt_id
     INNER JOIN orders o ON o.id=rat.order_id
     INNER JOIN cards c ON c.id=o.assigned_card_id
     INNER JOIN provider_accounts pa ON pa.id=c.provider_account_id
     LEFT JOIN browser_operations bo ON bo.browser_run_id=br.id AND bo.operation_type='PAYMENT_SUBMIT'
     WHERE br.id=? GROUP BY c.id, c.provider_card_id, c.sync_tier, pa.provider_code`, [runId],
  );
  if (!row?.card_id) throw new Error('Browser run card context is unavailable');
  return row;
}

export function observation() {
  return {
    pageContract: { urlPrefix: 'https://chatgpt.com/', title: 'ChatGPT', requiredSelector: 'body', markerText: '' },
    accountProbeContract: {},
    checkoutNavigationContract: CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
    checkoutContract: CHATGPT_PLUS_CHECKOUT_CONTRACT,
  };
}

/** D-150: order preflight proves login/identity/free only; no Upgrade click, no Checkout. */
export function preflightObservation() {
  const { checkoutNavigationContract, checkoutContract, ...rest } = observation();
  return rest;
}

export async function withPoolLifecycle(pool, operation) {
  if (!pool || typeof pool.end !== 'function') throw new TypeError('pool.end is required');
  if (typeof operation !== 'function') throw new TypeError('operation is required');
  try {
    return await operation();
  } finally {
    await pool.end();
  }
}

export async function runProductionLiveBrowserWorker({ env = process.env, browserType = chromium } = {}) {
  const config = loadProductionLiveBrowserConfig(env);
  const database = loadRuntimeDatabaseConfig({
    NODE_ENV: env.NODE_ENV || 'production', DATABASE_URL: config.databaseUrl,
    DATABASE_TLS: String(config.databaseTls), DATABASE_TLS_CA_BASE64: env.DATABASE_TLS_CA_BASE64,
  });
  const pool = createDatabasePool(database);
  return withPoolLifecycle(pool, async () => {
    await checkProductionLiveFilesystem(config);
    await checkProductionLiveDatabase(pool, config);
    await checkProductionLiveBitBrowser(config);
    if (config.checkOnly) return { status: 'READY' };
    if (config.postPlusAction === 'MANUAL_20X_HANDOFF') {
      const [[existing]] = await pool.query(
        `SELECT COUNT(*) AS count
         FROM browser_runs br
         INNER JOIN recharge_attempts rat ON rat.id=br.recharge_attempt_id
         WHERE rat.order_id<>?
           AND br.status='HUMAN_REQUIRED'
           AND br.control_state='TRANSFERRED'
           AND br.payment_state='PAYMENT_CONFIRMED'
           AND br.post_payment_state='PLUS_CONFIRMED'`,
        [config.approvedOrderId],
      );
      if (Number(existing?.count || 0) !== 0) {
        throw new Error('another manual 20X handoff is still active');
      }
    }

    const wal = await new AppendOnlyWal({ filePath: config.walPath }).init();
    await wal.verify();
    const runtimeAdapter = new BitBrowserControlRuntimeAdapter({
      browserType, apiBaseUrl: config.bitbrowserApiBaseUrl,
      bitbrowserProfileId: config.bitbrowserProfileId,
      // Resident identity: the Profile window stays open between orders; the
      // worker only detaches CDP. Login state is cleared per order, not the window.
      residentProfile: true,
    });
    const manifest = createBitBrowserControlManifest();
    const addressSource = new MockAddressBillingAddressSource({
      state: config.billingAddressState, name: config.billingAddressName,
      assignmentStore: new MysqlBillingAddressAssignmentStore({ pool }),
    });
    const rawCardSource = new SharedEncryptedCardMaterialSource({ db: pool, encryptionKey: config.materialEncryptionKey });
    const enrichedCardSource = new BillingAddressEnrichedCardMaterialSource({
      cardSource: rawCardSource, billingAddressSource: addressSource,
      resolveBillingAddressRef: async (runRef) => {
        const runId = String(runRef).replace(/^browser-run:/, '');
        const card = await resolveCardContext(pool, runId);
        return `card:${card.card_id}`;
      },
    });
    const cardMaterialLeaseProvider = await new DurableCardMaterialLeaseProvider({
      source: enrichedCardSource, filePath: config.cardLeasePath,
    }).init();
    const sessionProvider = new CookieSessionBootstrapAdapter({
      source: new SharedEncryptedSessionSource({ db: pool, encryptionKey: config.materialEncryptionKey }),
    });
    const postPaymentSessionProvider = new CookieSessionBootstrapAdapter({
      source: new SharedPostPaymentSessionSource({ db: pool, encryptionKey: config.materialEncryptionKey }),
    });
    const provider = config.hnskjApiKey
      ? new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey }) : null;
    const transactionReaderFactory = async ({ runId }) => {
      const card = await resolveCardContext(pool, runId);
      const sourceKind = card.sync_tier === 'MANUAL_IMPORT' || card.provider_code === 'manual_excel'
        ? 'MANUAL_IMPORT' : 'HNSKJ';
      if (sourceKind === 'HNSKJ' && (!config.providerReadsEnabled || !provider)) {
        throw new Error('HNSKJ transaction verification requires explicit Provider read credentials');
      }
      return new BrowserCardTransactionReader({
        sourceKind, provider, providerCardId: card.provider_card_id,
        runId, submitIntentAt: card.submit_intent_at,
        matchWindowMs: config.verificationWindowMs,
      });
    };

    const recoveryVerifier = new LivePostPaymentRecoveryVerifier({
      runtimeAdapter, manifest, sessionProvider: postPaymentSessionProvider,
      resolveSessionIdentity: ({ orderId }) => resolveIdentity(pool, { orderId }),
      transactionReaderFactory,
      navigationTimeoutMs: config.executionTimeoutMs,
      verificationWindowMs: config.verificationWindowMs,
      verificationIntervalMs: config.verificationIntervalMs,
      postPlusAction: config.postPlusAction,
    });
    const verification = createBrowserPaymentVerificationService({
      repository: createBrowserExecutionRepository(pool), verifier: recoveryVerifier,
      approvedOrderId: config.approvedOrderId, maxBatch: 1,
      postPlusAction: config.postPlusAction,
      verificationIntervalMs: config.verificationIntervalMs,
    });
    const verificationResult = await verification.runOnce();
    if (verificationResult.status !== 'IDLE') return verificationResult;

    const worker = createSharedLivePaymentWorker({
      pool, workerId: config.workerId, executorProfileId: config.executorProfileId,
      approvedOrderId: config.approvedOrderId, runtimeAdapter, manifest,
      observation: observation(), sessionProvider, cardMaterialLeaseProvider,
      resolveAccountKey: (input) => resolveAccountKey(pool, input),
      resolveSessionIdentity: (input) => resolveIdentity(pool, input),
      resolvePlan: (input) => resolveOrderPlan(pool, input),
      resolveSessionRef: ({ runId }) => browserRunMaterialRef(runId),
      resolveCardMaterialRef: ({ runId }) => browserRunMaterialRef(runId),
      transactionReaderFactory,
      runtimeHmacKey: config.runtimeHmacKey, artifactKey: config.artifactKey,
      resourceHmacKey: config.resourceHmacKey,
      evidenceSink: new CompositeEvidenceSink([new WalEvidenceSink(wal), new MysqlEvidenceSink({ pool, workerId: config.workerId })]),
      leaseSeconds: config.leaseSeconds, executionTimeoutMs: config.executionTimeoutMs,
      verificationWindowMs: config.verificationWindowMs,
      verificationIntervalMs: config.verificationIntervalMs,
      postPlusAction: config.postPlusAction,
      stopBeforeSubmit: config.stopBeforeSubmit,
    });
    // Await inside the try. Returning the promise directly runs `finally`
    // immediately, closing the shared MySQL pool while dispatch is starting.
    return await worker.runOnce();
  });
}

function liveFailureDiagnostic(error) {
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth += 1) {
    const message = String(current?.message || '').trim();
    if (message) return message.slice(0, 300);
  }
  return null;
}

export function parseProductionLiveArgs(argv = []) {
  const unsupported = argv.filter((arg) => !['--check', '--once'].includes(arg));
  if (unsupported.length || argv.includes('--check') === argv.includes('--once')) {
    throw new Error('production LIVE Worker requires exactly one of --check or --once');
  }
  return { checkOnly: argv.includes('--check') };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { checkOnly } = parseProductionLiveArgs(argv);
  const result = await runProductionLiveBrowserWorker({
    env: { ...env, BROWSER_WORKER_CHECK_ONLY: checkOnly ? 'true' : 'false' },
  });
  console.log('browser production-live worker stopped', {
    status: result.status, reasonCode: result.reasonCode || null,
    ...(result.quote ? { quote: result.quote } : {}),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error('browser production-live worker failed', {
      name: error?.name || 'Error', code: error?.code || 'BROWSER_LIVE_WORKER_FAILED',
      message: String(error?.message || '').slice(0, 300),
      ...(process.env.BROWSER_LIVE_DIAGNOSTIC === 'true'
        ? { diagnostic: liveFailureDiagnostic(error) } : {}),
    });
    process.exitCode = 1;
  });
}
