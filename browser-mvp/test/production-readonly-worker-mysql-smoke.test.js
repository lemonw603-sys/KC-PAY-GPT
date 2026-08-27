import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { createBrowserAdminService } from '../../v1/src/services/browser-admin-service.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';

test('production readonly entry claims MySQL dispatch, opens Chrome, and safe-aborts', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for isolated shared Browser dry-run integration',
}, async (t) => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 6, timezone: 'Z' });
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'browser-production-readonly-smoke-'));
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));
  const html = encodeURIComponent('<title>Shared dry-run fixture</title><main data-shared-dry-run>no-payment</main>');
  try {
    await pool.query(
      `INSERT INTO executor_profiles
       (id, profile_code, profile_version, executor_kind, runtime_id,
        adapter_version, status, config_public_json)
       VALUES (?, ?, 1, 'BROWSER', 'SHARED_DRY_RUN', 'SHARED_DRY_RUN',
         'ACTIVE', JSON_OBJECT('isolatedTest', TRUE, 'productionWritesEnabled', FALSE))`,
      [profileId, `SHARED_DRY_RUN_${profileId}`],
    );
    await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')', [
      cdkId, crypto.createHash('sha256').update(cdkId).digest('hex'),
    ]);
    await pool.query(
      `INSERT INTO orders
       (id, public_no, cdk_id, status, card_type_id, open_card_amount,
        minimum_required_card_balance, session_ciphertext, chatgpt_account_id,
        card_purchase_idempotency_key, product_id, fulfillment_route_id,
        route_resolution_status)
       VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '7', 25, 16, ?, ?, ?, ?, ?, 'RESOLVED')`,
      [orderId, `SHARED-DRY-${orderId}`, cdkId, Buffer.from('unused-isolated-session'),
        `isolated-account-${orderId}`, `shared-dry-purchase-${orderId}`, productId, routeId],
    );
    await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, provider_account_id, external_card_id,
        intake_status, sync_tier, last_synced_at)
       VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING',
         ?, '00000000-0000-4000-8000-000000000101', ?, 'ACCEPTED', 'ASSIGNED',
         CURRENT_TIMESTAMP(3))`,
      [cardId, orderId, `shared-dry-card-${cardId}`, Buffer.from('unused-isolated-card'),
        `shared-dry-card-${cardId}`],
    );
    await pool.query(
      `INSERT INTO recharge_attempts
       (id, order_id, fulfillment_route_id, executor_kind, executor_profile_id,
        status, funds_risk_state, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'BROWSER', ?, 'PREPARED', 'ACTIVE', ?,
         CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [attemptId, orderId, routeId, profileId, `shared-dry:${attemptId}`],
    );
    await createBrowserDispatchRepository(pool).enqueue({
      jobKey: `shared-dry:${attemptId}`, attemptId, orderId, executorProfileId: profileId,
    });
    const dispatchBeforeRun = await createBrowserAdminService({ pool }).listDispatchJobs({
      publicNo: `SHARED-DRY-${orderId}`
    });
    assert.equal(dispatchBeforeRun.total, 1);
    assert.equal(dispatchBeforeRun.jobs[0].status, 'QUEUED');
    assert.equal(dispatchBeforeRun.jobs[0].latestRun, null);

    const key = (byte) => Buffer.alloc(32, byte).toString('base64');
    const workerEnv = {
        NODE_ENV: 'test', DATABASE_URL: databaseUrl, DATABASE_TLS: 'false',
        BROWSER_WORKER_MODE: 'PRODUCTION_READONLY',
        BROWSER_WORKER_CONFIRMATION: 'RUN BROWSER PRODUCTION READONLY WORKER',
        BROWSER_WORKER_TARGET: 'LOCAL_FIXTURE',
        BROWSER_WORKER_ID: `production-readonly-smoke-${attemptId}`,
        BROWSER_EXECUTOR_PROFILE_ID: profileId,
        BROWSER_PROFILES_ROOT: join(runtimeRoot, 'profiles'),
        BROWSER_WAL_PATH: join(runtimeRoot, 'evidence.wal.jsonl'),
        BROWSER_CHROME_EXECUTABLE_PATH: process.env.AGENT_BROWSER_EXECUTABLE_PATH
          || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        BROWSER_CHROME_HEADLESS: 'true',
        BROWSER_OBSERVE_URL_PREFIX: `data:text/html,${html}`,
        BROWSER_OBSERVE_TITLE: 'Shared dry-run fixture',
        BROWSER_OBSERVE_REQUIRED_SELECTOR: '[data-shared-dry-run]',
        BROWSER_OBSERVE_MARKER_TEXT: 'no-payment',
        BROWSER_RUNTIME_HMAC_KEY_BASE64: key(1),
        BROWSER_ARTIFACT_KEY_BASE64: key(2),
        BROWSER_RESOURCE_HMAC_KEY_BASE64: key(3),
        BROWSER_PAYMENT_WRITES_ENABLED: 'false', PROVIDER_WRITES_ENABLED: 'false',
        PROVIDER_CARD_WRITES_ENABLED: 'false', PROVIDER_RECHARGE_WRITES_ENABLED: 'false',
        CARD_FUNDING_WRITES_ENABLED: 'false',
        BROWSER_WORKER_LEASE_SECONDS: '30', BROWSER_EXECUTION_TIMEOUT_MS: '5000',
      };
    const cli = resolve(here, '../src/production-readonly-worker.js');
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, '--once'], {
      env: { ...process.env, ...workerEnv },
      timeout: 20_000,
    });
    assert.match(stdout, /status: 'SAFE_ABORTED'/);
    assert.doesNotMatch(`${stdout}\n${stderr}`, /isolated-account-/);
    const wal = await readFile(join(runtimeRoot, 'evidence.wal.jsonl'), 'utf8');
    assert.match(wal, /"type":"intent"/);
    assert.doesNotMatch(wal, /isolated-account-/);

    const [[stored]] = await pool.query(
      `SELECT o.status AS order_status, rat.status AS attempt_status,
              rat.funds_risk_state, br.status AS run_status,
              bdj.status AS dispatch_status,
              (SELECT COUNT(*) FROM payment_permits pp
                WHERE pp.recharge_attempt_id = rat.id AND pp.status IN ('ISSUED', 'CONSUMED')) AS active_permits,
              (SELECT COUNT(*) FROM browser_operations bo
                WHERE bo.browser_run_id = br.id AND bo.operation_type = 'PAYMENT_SUBMIT') AS submit_operations,
              (SELECT COUNT(*) FROM execution_resource_leases erl
                WHERE erl.browser_run_id = br.id AND erl.released_at IS NULL) AS live_resource_leases
       FROM orders o
       INNER JOIN recharge_attempts rat ON rat.order_id = o.id
       INNER JOIN browser_runs br ON br.recharge_attempt_id = rat.id
       INNER JOIN browser_dispatch_jobs bdj ON bdj.recharge_attempt_id = rat.id
       WHERE o.id = ?`,
      [orderId],
    );
    assert.deepEqual({
      orderStatus: stored.order_status,
      attemptStatus: stored.attempt_status,
      fundsRiskState: stored.funds_risk_state,
      runStatus: stored.run_status,
      dispatchStatus: stored.dispatch_status,
      activePermits: Number(stored.active_permits),
      submitOperations: Number(stored.submit_operations),
      liveResourceLeases: Number(stored.live_resource_leases),
    }, {
      orderStatus: 'CARD_READY',
      attemptStatus: 'CLEARED',
      fundsRiskState: 'CLEARED',
      runStatus: 'FAILED_SAFE',
      dispatchStatus: 'CANCELLED',
      activePermits: 0,
      submitOperations: 0,
      liveResourceLeases: 0,
    });
    const dispatchAfterRun = await createBrowserAdminService({ pool }).listDispatchJobs({
      publicNo: `SHARED-DRY-${orderId}`
    });
    assert.equal(dispatchAfterRun.jobs[0].status, 'CANCELLED');
    assert.equal(dispatchAfterRun.jobs[0].latestRun.status, 'FAILED_SAFE');
    assert.equal(JSON.stringify(dispatchAfterRun).includes('leaseToken'), false);
  } finally {
    await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id IN (SELECT id FROM browser_runs WHERE recharge_attempt_id = ?)', [attemptId]);
    await pool.query('DELETE FROM browser_operations WHERE browser_run_id IN (SELECT id FROM browser_runs WHERE recharge_attempt_id = ?)', [attemptId]);
    await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id IN (SELECT id FROM browser_runs WHERE recharge_attempt_id = ?)', [attemptId]);
    await pool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM browser_runs WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [attemptId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
    await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
    await pool.query('DELETE FROM executor_profiles WHERE id = ?', [profileId]);
    await pool.end();
  }
});
