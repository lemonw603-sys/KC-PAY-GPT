import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createBrowserExecutionRepository } from '../src/db/repositories/browser-execution-repository.js';
import { createBrowserRecoveryRepository } from '../src/db/repositories/browser-recovery-repository.js';
import { createBrowserAdminService } from '../src/services/browser-admin-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const productId = '00000000-0000-4000-8000-000000000201';
const routeId = '00000000-0000-4000-8000-000000000302';

test('artifact ciphertext and resource leases survive a worker-process restart without exposing authority', {
  skip: !databaseUrl && 'TEST_DATABASE_URL 未配置；Browser 恢复集成测试只在隔离数据库运行'
}, async () => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const artifactKey = Buffer.alloc(32, 31);
  const resourceKey = Buffer.alloc(32, 47);
  const accountKeyHmac = crypto.createHmac('sha256', 'isolated-recovery-account')
    .update(orderId).digest('hex');
  const navigationUrl = 'https://pay.openai.com/c/pay/cs_test_browservault#fid-authority';
  const baseTime = new Date();
  try {
    await pool.query(
      `INSERT INTO executor_profiles
       (id, profile_code, profile_version, executor_kind, runtime_id,
        adapter_version, status, config_public_json)
       VALUES (?, ?, 1, 'BROWSER', 'RECOVERY_TEST', 'RECOVERY_TEST', 'ACTIVE',
         JSON_OBJECT('isolatedTest', TRUE))`,
      [profileId, `BROWSER_RECOVERY_TEST_${profileId}`]
    );
    await pool.query(
      `INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')`,
      [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]
    );
    await pool.query(
      `INSERT INTO orders
       (id, public_no, cdk_id, status, card_type_id, open_card_amount,
        minimum_required_card_balance, session_ciphertext,
        card_purchase_idempotency_key, product_id, fulfillment_route_id,
        route_resolution_status)
       VALUES (?, ?, ?, 'SUBMITTING', '7', 25, 16, ?, ?, ?, ?, 'RESOLVED')`,
      [orderId, `BROWSER-RECOVERY-${orderId}`, cdkId, Buffer.from('isolated-test-session'),
        `browser-recovery-purchase-${orderId}`, productId, routeId]
    );
    await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
    await pool.query(
      `INSERT INTO cards
       (id, order_id, inventory_status, provider_card_id, card_type_id, status,
        funded_amount, current_balance, currency, refund_status,
        card_credentials_ciphertext, provider_account_id, external_card_id,
        intake_status, sync_tier)
       VALUES (?, ?, 'ASSIGNED', ?, '7', 'active', 25, 20, 'USD', 'MONITORING',
         ?, '00000000-0000-4000-8000-000000000101', ?, 'ACCEPTED', 'ASSIGNED')`,
      [cardId, orderId, `browser-recovery-card-${cardId}`, Buffer.from('isolated-test-card'),
        `browser-recovery-card-${cardId}`]
    );
    await pool.query(
      `INSERT INTO recharge_attempts
       (id, order_id, fulfillment_route_id, executor_kind, status,
        funds_risk_state, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?, ?, ?)`,
      [attemptId, orderId, routeId, `browser-recovery:${attemptId}`, baseTime, baseTime]
    );

    const started = await createBrowserExecutionRepository(pool).beginRun({
      attemptId, executorProfileId: profileId, accountKeyHmac,
      workerId: 'recovery-worker-a', startOperationKey: `recovery-start:${attemptId}`,
      runId, leaseSeconds: 300, now: baseTime
    });
    const firstProcess = createBrowserRecoveryRepository(pool, {
      artifactKeys: new Map([[1, artifactKey]]),
      currentArtifactKeyVersion: 1,
      resourceHmacKey: resourceKey
    });
    const acquired = await firstProcess.acquireRunResources({
      runId, ownerId: 'recovery-worker-a', leaseToken: started.leaseToken,
      ttlSeconds: 300, now: baseTime
    });
    assert.deepEqual(acquired.resourceTypes.sort(), ['ACCOUNT', 'CARD', 'ORDER']);
    const stored = await firstProcess.storeCheckoutArtifact({
      runId, ownerId: 'recovery-worker-a', leaseToken: started.leaseToken,
      navigationUrl, artifactId, ttlSeconds: 120,
      now: new Date(baseTime.getTime() + 1000)
    });
    assert.equal(stored.secretRef, `vault://${artifactId}`);

    const [[publicIndex]] = await pool.query(
      `SELECT id, secret_ref, url_hash, checkout_hash,
              CAST(JSON_OBJECT('id', id, 'secretRef', secret_ref,
                'urlHash', url_hash, 'checkoutHash', checkout_hash) AS CHAR) AS serialized
       FROM checkout_artifacts WHERE id = ?`,
      [artifactId]
    );
    assert.equal(publicIndex.serialized.includes('fid-authority'), false);
    assert.equal(publicIndex.serialized.includes('cs_test_browservault'), false);
    const [[secretRow]] = await pool.query(
      `SELECT ciphertext, iv, auth_tag FROM browser_artifact_secrets WHERE secret_ref = ?`,
      [stored.secretRef]
    );
    assert.equal(secretRow.ciphertext.includes(Buffer.from(navigationUrl)), false);
    assert.equal(secretRow.iv.length, 12);
    assert.equal(secretRow.auth_tag.length, 16);

    const restartedProcess = createBrowserRecoveryRepository(pool, {
      artifactKeys: new Map([[1, artifactKey]]),
      currentArtifactKeyVersion: 1,
      resourceHmacKey: resourceKey
    });
    const firstReveal = await restartedProcess.revealCheckoutArtifact({
      runId, artifactId, ownerId: 'recovery-worker-a', leaseToken: started.leaseToken,
      now: new Date(baseTime.getTime() + 2000)
    });
    assert.equal(firstReveal.navigationUrl, navigationUrl);

    await pool.query(
      `UPDATE browser_runs SET worker_lease_until = ? WHERE id = ?`,
      [new Date(baseTime.getTime() + 2500), runId]
    );
    await pool.query(
      `UPDATE execution_resource_leases SET lease_until = ?
       WHERE browser_run_id = ? AND released_at IS NULL`,
      [new Date(baseTime.getTime() + 2500), runId]
    );
    const recovered = await restartedProcess.recoverExpiredRun({
      runId, newOwnerId: 'recovery-worker-b', ttlSeconds: 300,
      now: new Date(baseTime.getTime() + 3000)
    });
    assert.equal(recovered.recoveryMode, 'RESUME_EXISTING_ARTIFACT');
    assert.deepEqual(recovered.resourceTypes.sort(), [
      'ACCOUNT', 'CARD', 'CHECKOUT_ARTIFACT', 'ORDER'
    ]);
    const secondReveal = await restartedProcess.revealCheckoutArtifact({
      runId, artifactId, ownerId: 'recovery-worker-b', leaseToken: recovered.leaseToken,
      now: new Date(baseTime.getTime() + 4000)
    });
    assert.equal(secondReveal.navigationUrl, navigationUrl);

    const browserAdmin = createBrowserAdminService({ pool });
    const runList = await browserAdmin.listRuns({ publicNo: `BROWSER-RECOVERY-${orderId}` });
    assert.equal(runList.total, 1);
    assert.equal(runList.runs[0].activeArtifact.id, artifactId);
    assert.equal(JSON.stringify(runList).includes('fid-authority'), false);
    assert.equal(JSON.stringify(runList).includes('secretRef'), false);
    const runDetail = await browserAdmin.getRun(runId);
    assert.equal(runDetail.run.id, runId);
    assert.equal(runDetail.artifacts[0].id, artifactId);
    assert.equal(JSON.stringify(runDetail).includes('fid-authority'), false);
    assert.equal(JSON.stringify(runDetail).includes('secret_ref'), false);
    assert.equal(JSON.stringify(runDetail).includes('lease_token'), false);
    assert.equal(JSON.stringify(runDetail).includes('resource_key'), false);

    const requestOperation = `admin-request:${runId}`;
    await browserAdmin.controlRun(runId, {
      action: 'REQUEST', operationId: requestOperation,
      confirmation: `请求人工接管 ${runId}`,
      reasonCode: 'OPERATOR_REVIEW', actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 5000)
    });
    await browserAdmin.controlRun(runId, {
      action: 'FREEZE', operationId: `admin-freeze:${runId}`,
      confirmation: `冻结自动化 ${runId}`, actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 6000)
    });
    await browserAdmin.controlRun(runId, {
      action: 'TRANSFER', operationId: `admin-transfer:${runId}`,
      confirmation: `转交人工 ${runId}`, actorId: 'admin-test',
      humanOwnerId: 'operator-a', now: new Date(baseTime.getTime() + 7000)
    });
    const released = await browserAdmin.controlRun(runId, {
      action: 'RELEASE_SAFE', operationId: `admin-release:${runId}`,
      confirmation: `确认无付款动作并恢复 ${runId}`, actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 8000)
    });
    assert.equal(released.controlState, 'AUTOMATION');
    const releaseReplay = await browserAdmin.controlRun(runId, {
      action: 'RELEASE_SAFE', operationId: `admin-release:${runId}`,
      confirmation: `确认无付款动作并恢复 ${runId}`, actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 9000)
    });
    assert.equal(releaseReplay.idempotentReplay, true);

    const expired = await restartedProcess.revealCheckoutArtifact({
      runId, artifactId, ownerId: 'recovery-worker-b', leaseToken: recovered.leaseToken,
      now: new Date(baseTime.getTime() + 122_000)
    });
    assert.deepEqual(expired, {
      artifactId,
      navigationUrl: null,
      reviewRequired: true,
      reasonCode: 'EXPIRY_IS_NOT_INVALIDATION_PROOF'
    });
    const destroyed = await restartedProcess.destroyCheckoutArtifact({
      runId, artifactId, ownerId: 'recovery-worker-b', leaseToken: recovered.leaseToken,
      reasonCode: 'EXPERIMENT_CLEANUP_BEFORE_PAYMENT',
      now: new Date(baseTime.getTime() + 123_000)
    });
    assert.equal(destroyed.destroyed, true);
    const [[destroyedRow]] = await pool.query(
      `SELECT ca.status, bas.destroyed_at, bas.iv, bas.auth_tag, bas.ciphertext
       FROM checkout_artifacts ca
       INNER JOIN browser_artifact_secrets bas ON bas.secret_ref = ca.secret_ref
       WHERE ca.id = ?`,
      [artifactId]
    );
    assert.equal(destroyedRow.status, 'INVALIDATED');
    assert.ok(destroyedRow.destroyed_at);
    assert.equal(destroyedRow.iv, null);
    assert.equal(destroyedRow.auth_tag, null);
    assert.equal(destroyedRow.ciphertext, null);

    await browserAdmin.controlRun(runId, {
      action: 'REQUEST', operationId: `admin-unknown-request:${runId}`,
      confirmation: `请求人工接管 ${runId}`,
      reasonCode: 'PAYMENT_RECONCILIATION', actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 124_000)
    });
    await browserAdmin.controlRun(runId, {
      action: 'FREEZE', operationId: `admin-unknown-freeze:${runId}`,
      confirmation: `冻结自动化 ${runId}`, actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 125_000)
    });
    const unknown = await browserAdmin.controlRun(runId, {
      action: 'MARK_PAYMENT_UNKNOWN', operationId: `admin-unknown:${runId}`,
      confirmation: `确认付款结果未知 ${runId}`, actorId: 'admin-test',
      now: new Date(baseTime.getTime() + 126_000)
    });
    assert.equal(unknown.runStatus, 'RECONCILE_ONLY');
    assert.equal(unknown.paymentState, 'PAYMENT_UNKNOWN');
    const [[unknownState]] = await pool.query(
      `SELECT br.status AS run_status, br.payment_state,
              rat.status AS attempt_status, rat.funds_risk_state,
              o.status AS order_status
       FROM browser_runs br
       INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
       INNER JOIN orders o ON o.id = rat.order_id
       WHERE br.id = ?`, [runId]
    );
    assert.deepEqual(unknownState, {
      run_status: 'RECONCILE_ONLY', payment_state: 'PAYMENT_UNKNOWN',
      attempt_status: 'SUBMIT_UNKNOWN', funds_risk_state: 'UNKNOWN',
      order_status: 'SUBMIT_UNKNOWN'
    });
  } finally {
    await pool.query('DELETE FROM reconciliation_cases WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM order_events WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM payment_permits WHERE recharge_attempt_id = ?', [attemptId]);
    await pool.query('DELETE FROM browser_checkpoints WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_operations WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_interventions WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM execution_resource_leases WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM checkout_artifacts WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_artifact_secrets WHERE browser_run_id = ?', [runId]);
    await pool.query('DELETE FROM browser_runs WHERE id = ?', [runId]);
    await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [attemptId]);
    await pool.query('DELETE FROM card_assignment_history WHERE order_id = ?', [orderId]);
    await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
    await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]);
    await pool.query('DELETE FROM executor_profiles WHERE id = ?', [profileId]);
    await pool.end();
  }
});
