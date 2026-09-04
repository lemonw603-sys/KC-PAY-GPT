import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import mysql from 'mysql2/promise';

import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { encryptSecret } from '../../v1/src/security/secret-box.js';
import { runProductionReadonlyBrowserWorker } from '../src/production-readonly-worker.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const profileConfigPath = process.env.BITBROWSER_PROFILE_CONFIG;
const enabled = Boolean(databaseUrl && profileConfigPath);
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';
const providerAccountId = '00000000-0000-4000-8000-000000000101';

async function loadProfileIds(path) {
  const info = await stat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('BitBrowser profile config must be a caller-owned 0600 regular file');
  }
  const line = (await readFile(path, 'utf8')).split(/\r?\n/)
    .find((candidate) => candidate.startsWith('BROWSER_BITBROWSER_PROFILE_IDS='));
  const ids = String(line || '').split('=', 2)[1]?.split(',').map((id) => id.trim()).filter(Boolean) || [];
  if (ids.length !== 6 || new Set(ids).size !== 6) throw new Error('exactly six unique Profile IDs are required');
  return ids;
}

async function waitForTerminalJobs(pool, expected, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status IN ('COMPLETED', 'CANCELLED', 'DEAD')) AS terminal_count
       FROM browser_dispatch_jobs`,
    );
    last = { total: Number(row.total), terminalCount: Number(row.terminal_count) };
    if (Number(row.total) === expected && Number(row.terminal_count) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const [states] = await pool.query(
    'SELECT status, COUNT(*) AS count FROM browser_dispatch_jobs GROUP BY status ORDER BY status',
  );
  throw new Error(`timed out waiting for isolated Browser jobs: ${JSON.stringify({ last, states })}`);
}

test('six real BitBrowser Profiles consume isolated MySQL jobs and safe-abort without payment', {
  skip: !enabled && 'TEST_DATABASE_URL and BITBROWSER_PROFILE_CONFIG are required',
  // Six physical BitBrowser windows intentionally start serially. Keep this
  // environment-only limit outside the 30-second per-job lease and allow slow
  // local GUI startup without turning it into a queue correctness failure.
  timeout: 300_000,
}, async () => {
  const profileIds = await loadProfileIds(profileConfigPath);
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 12, timezone: 'Z' });
  const executorProfileId = crypto.randomUUID();
  const secretKey = Buffer.alloc(32, 21);
  const fixture = encodeURIComponent('<title>Six lane shared dry-run</title><main data-six-lane>no-payment</main>');
  const runtimeRoot = join(tmpdir(), `bitbrowser-six-lane-${crypto.randomUUID()}`);
  const records = [];
  const results = [];
  const controller = new AbortController();
  let workerPromise = null;
  try {
    await pool.query("UPDATE app_settings SET setting_value = 'true' WHERE setting_key = 'browser_dispatch_enabled'");
    await pool.query(
      `INSERT INTO executor_profiles
       (id, profile_code, profile_version, executor_kind, runtime_id,
        adapter_version, status, config_public_json)
       VALUES (?, ?, 1, 'BROWSER', 'BITBROWSER_SIX_LANE_TEST', 'BITBROWSER_LOCAL_API',
         'ACTIVE', JSON_OBJECT('isolatedTest', TRUE, 'productionWritesEnabled', FALSE))`,
      [executorProfileId, `BITBROWSER_SIX_${executorProfileId}`],
    );
    const dispatch = createBrowserDispatchRepository(pool);
    for (let index = 0; index < 6; index += 1) {
      const record = {
        cdkId: crypto.randomUUID(),
        orderId: crypto.randomUUID(),
        cardId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
        ledgerId: crypto.randomUUID(),
      };
      records.push(record);
      await pool.query("INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')", [
        record.cdkId, crypto.createHash('sha256').update(record.cdkId).digest('hex'),
      ]);
      await pool.query(
        `INSERT INTO orders
         (id, public_no, cdk_id, status, card_type_id, open_card_amount,
          minimum_required_card_balance, session_ciphertext, chatgpt_account_id,
          card_purchase_idempotency_key, product_id, fulfillment_route_id,
          route_resolution_status)
         VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '7', 16, 16, ?, ?, ?, ?, ?, 'RESOLVED')`,
        [record.orderId, `SIX-LANE-${index + 1}-${record.orderId}`, record.cdkId,
          encryptSecret(JSON.stringify({ fixture: true, lane: index + 1 }), secretKey),
          `isolated-account-${index + 1}`, `six-lane-purchase-${record.orderId}`, productId, routeId],
      );
      await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [record.orderId, record.cdkId]);
      await pool.query(
        `INSERT INTO cards
         (id, order_id, inventory_status, provider_card_id, card_type_id, status,
          funded_amount, current_balance, currency, refund_status,
          card_credentials_ciphertext, provider_account_id, external_card_id,
          intake_status, sync_tier, last_synced_at, last_transaction_synced_at)
         VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 16, 16, 'USD', 'MONITORING',
           ?, ?, ?, 'ACCEPTED', 'ASSIGNED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [record.cardId, record.orderId, `six-lane-card-${index + 1}`,
          encryptSecret(JSON.stringify({ fixture: true, lane: index + 1 }), secretKey),
          providerAccountId, `six-lane-card-${index + 1}`],
      );
      await pool.query(
        `INSERT INTO recharge_attempts
         (id, order_id, fulfillment_route_id, executor_kind, executor_profile_id,
          status, funds_risk_state, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, 'BROWSER', ?, 'PREPARED', 'ACTIVE', ?,
           CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [record.attemptId, record.orderId, routeId, executorProfileId, `six-lane:${record.attemptId}`],
      );
      await pool.query(
        `INSERT INTO card_consumption_ledger
         (id, card_id, order_id, recharge_attempt_id, product_id, status, amount, currency)
         VALUES (?, ?, ?, ?, ?, 'RESERVED', 16, 'USD')`,
        [record.ledgerId, record.cardId, record.orderId, record.attemptId, productId],
      );
      await dispatch.enqueue({
        jobKey: `six-lane:${record.attemptId}`,
        attemptId: record.attemptId,
        orderId: record.orderId,
        executorProfileId,
      });
    }

    const key = (byte) => Buffer.alloc(32, byte).toString('base64');
    const workerEnv = {
      ...process.env,
      NODE_ENV: 'test', DATABASE_URL: databaseUrl, DATABASE_TLS: 'false',
      BROWSER_WORKER_MODE: 'PRODUCTION_READONLY',
      BROWSER_WORKER_CONFIRMATION: 'RUN BROWSER PRODUCTION READONLY WORKER',
      BROWSER_WORKER_TARGET: 'LOCAL_FIXTURE',
      BROWSER_WORKER_ID: `bitbrowser-six-lane-${crypto.randomUUID()}`,
      BROWSER_EXECUTOR_PROFILE_ID: executorProfileId,
      BROWSER_WAL_PATH: join(runtimeRoot, 'evidence.wal.jsonl'),
      BROWSER_OBSERVE_URL_PREFIX: `data:text/html,${fixture}`,
      BROWSER_OBSERVE_TITLE: 'Six lane shared dry-run',
      BROWSER_OBSERVE_REQUIRED_SELECTOR: '[data-six-lane]',
      BROWSER_OBSERVE_MARKER_TEXT: 'no-payment',
      BROWSER_RUNTIME_PROVIDER: 'BITBROWSER',
      BROWSER_BITBROWSER_ENABLED: 'true',
      BROWSER_BITBROWSER_API_URL: 'http://127.0.0.1:54345',
      BROWSER_BITBROWSER_PROFILE_IDS: profileIds.join(','),
      BROWSER_BITBROWSER_KEEP_ALIVE: 'true',
      BROWSER_BITBROWSER_API_TIMEOUT_MS: '60000',
      BROWSER_WORKER_CONCURRENCY: '6',
      BROWSER_WORKER_POLL_INTERVAL_MS: '100',
      BROWSER_WORKER_HEARTBEAT_INTERVAL_MS: '5000',
      BROWSER_WORKER_LEASE_SECONDS: '30',
      BROWSER_EXECUTION_TIMEOUT_MS: '15000',
      BROWSER_SHARED_MATERIALS_MODE: 'DISABLED',
      BROWSER_READONLY_HARNESS: 'PAGE_ONLY',
      BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1),
      BROWSER_ARTIFACT_KEY_BASE64: key(2),
      BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3),
      BROWSER_PAYMENT_EXECUTOR_ENABLED: 'false', BROWSER_PAYMENT_EXECUTOR_MODE: 'MOCK',
      BROWSER_PAYMENT_WRITES_ENABLED: 'false', PROVIDER_WRITES_ENABLED: 'false',
      PROVIDER_CARD_WRITES_ENABLED: 'false', PROVIDER_RECHARGE_WRITES_ENABLED: 'false',
      CARD_FUNDING_WRITES_ENABLED: 'false',
      CHATGPT_SESSION_COOKIE: '', CHATGPT_TOKEN: '', SESSION_JSON: '',
      CARD_NUMBER: '', CARD_EXPIRY: '', CARD_CVC: '',
    };
    workerPromise = runProductionReadonlyBrowserWorker({
      env: workerEnv,
      signal: controller.signal,
      onResult: (result) => results.push({ status: result.status, reasonCode: result.reasonCode || null }),
    });
    const earlyWorkerExit = workerPromise.then(
      () => Promise.reject(new Error('Browser Worker stopped before all isolated jobs reached a terminal state')),
      (error) => Promise.reject(error),
    );
    earlyWorkerExit.catch(() => undefined);
    await Promise.race([waitForTerminalJobs(pool, 6), earlyWorkerExit]);
    controller.abort();
    const stopped = await workerPromise;
    workerPromise = null;
    assert.deepEqual(stopped, { status: 'STOPPED', lanes: 6 });

    const [[summary]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM browser_dispatch_jobs WHERE status = 'CANCELLED') AS cancelled_jobs,
        (SELECT COUNT(*) FROM browser_runs WHERE status = 'FAILED_SAFE') AS failed_safe_runs,
        (SELECT COUNT(*) FROM recharge_attempts WHERE status = 'CLEARED' AND funds_risk_state = 'CLEARED') AS cleared_attempts,
        (SELECT COUNT(*) FROM orders WHERE status = 'CARD_READY') AS card_ready_orders,
        (SELECT COUNT(*) FROM payment_permits WHERE status IN ('ISSUED', 'CONSUMED')) AS active_permits,
        (SELECT COUNT(*) FROM browser_operations WHERE operation_type = 'PAYMENT_SUBMIT') AS submit_operations,
        (SELECT COUNT(*) FROM execution_resource_leases WHERE released_at IS NULL) AS live_leases`,
    );
    assert.deepEqual({
      cancelledJobs: Number(summary.cancelled_jobs),
      failedSafeRuns: Number(summary.failed_safe_runs),
      clearedAttempts: Number(summary.cleared_attempts),
      cardReadyOrders: Number(summary.card_ready_orders),
      activePermits: Number(summary.active_permits),
      submitOperations: Number(summary.submit_operations),
      liveLeases: Number(summary.live_leases),
    }, {
      cancelledJobs: 6,
      failedSafeRuns: 6,
      clearedAttempts: 6,
      cardReadyOrders: 6,
      activePermits: 0,
      submitOperations: 0,
      liveLeases: 0,
    });
    assert.equal(results.filter((result) => result.status === 'SAFE_ABORTED').length, 6);
  } finally {
    controller.abort();
    if (workerPromise) await workerPromise.catch(() => undefined);
    await pool.end();
  }
});
