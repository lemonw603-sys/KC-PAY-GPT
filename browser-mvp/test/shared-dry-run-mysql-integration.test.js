import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { chromium } from 'playwright';

import { createBrowserDispatchRepository } from '../../v1/src/db/repositories/browser-dispatch-repository.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createSyntheticManifest } from '../src/fixtures.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import {
  createSharedNonPaymentDryRun,
  SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION,
} from '../src/shared-dry-run-composition.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';

test('real MySQL dispatch/run executes a local Browser dry-run and clears every pre-payment fence', {
  skip: !databaseUrl && 'TEST_DATABASE_URL is required for isolated shared Browser dry-run integration',
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 6, timezone: 'Z' });
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const evidenceSink = new MemoryEvidenceSink();
  const html = encodeURIComponent('<title>Shared dry-run fixture</title><main data-shared-dry-run>no-payment</main>');
  try {
    await pool.query(
      `INSERT INTO executor_profiles
       (id, profile_code, profile_version, executor_kind, runtime_id,
        adapter_version, status, config_public_json)
       VALUES (?, ?, 1, 'BROWSER', 'SHARED_DRY_RUN', 'SHARED_DRY_RUN',
         'ACTIVE', JSON_OBJECT('isolatedTest', TRUE))`,
      [profileId, `SHARED_DRY_RUN_${profileId}`],
    );
    await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')', [
      cdkId, crypto.createHash('sha256').update(cdkId).digest('hex'),
    ]);
    await pool.query(
      `INSERT INTO orders
       (id, public_no, cdk_id, status, card_type_id, open_card_amount,
        minimum_required_card_balance, session_ciphertext,
        card_purchase_idempotency_key, product_id, fulfillment_route_id,
        route_resolution_status)
       VALUES (?, ?, ?, 'RECHARGE_PROCESSING', '7', 25, 16, ?, ?, ?, ?, 'RESOLVED')`,
      [orderId, `SHARED-DRY-${orderId}`, cdkId, Buffer.from('unused-isolated-session'),
        `shared-dry-purchase-${orderId}`, productId, routeId],
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

    const dryRun = createSharedNonPaymentDryRun({
      pool,
      workerId: `shared-dry-worker-${attemptId}`,
      executorProfileId: profileId,
      runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
      manifest: createSyntheticManifest(),
      observation: {
        pageContract: {
          urlPrefix: `data:text/html,${html}`,
          title: 'Shared dry-run fixture',
          requiredSelector: '[data-shared-dry-run]',
          markerText: 'no-payment',
        },
      },
      resolveAccountKey: async ({ orderId: currentOrderId }) => `isolated-account:${currentOrderId}`,
      runtimeHmacKey: crypto.randomBytes(32),
      artifactKey: crypto.randomBytes(32),
      resourceHmacKey: crypto.randomBytes(32),
      evidenceSink,
      leaseSeconds: 30,
      executionTimeoutMs: 3_000,
    });
    const result = await dryRun.runOnce({ confirmation: SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION });
    assert.equal(result.status, 'SAFE_ABORTED');
    assert.equal(result.externalPaymentCalls, 0);
    assert.equal(result.fundsRiskState, 'CLEARED');

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
    assert.deepEqual(evidenceSink.events.map(({ type }) => type), ['intent', 'checkpoint']);
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
