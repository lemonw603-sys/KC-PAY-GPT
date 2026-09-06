import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createBrowserExecutionRepository } from '../src/db/repositories/browser-execution-repository.js';

const digest = (character) => character.repeat(64);

function paymentSnapshotHash(row) {
  const micros = (value) => {
    const [whole, fraction = ''] = String(value).split('.');
    return ((BigInt(whole) * 1_000_000n) + BigInt(fraction.padEnd(6, '0'))).toString();
  };
  const facts = {
    executorProfileId: row.executor_profile_id,
    attemptId: row.recharge_attempt_id,
    orderId: row.order_id,
    routeId: row.route_id,
    frozenCardProviderAccountId: row.frozen_card_provider_account_id,
    cardId: row.card_id,
    cardConsumptionId: row.card_consumption_id,
    cardConsumptionStatus: row.card_consumption_status,
    cardProviderAccountId: row.card_provider_account_id,
    providerCardId: row.provider_card_id,
    cardStatus: String(row.card_status).toLowerCase(),
    cardBalanceMicros: micros(row.card_current_balance),
    minimumBalanceMicros: micros(row.minimum_required_card_balance),
    cardCredentialsDigest: crypto.createHash('sha256').update(row.card_credentials_ciphertext).digest('hex'),
    cardLastSyncedAt: new Date(row.card_last_synced_at).toISOString(),
    cardLastTransactionSyncedAt: new Date(row.card_last_transaction_synced_at).toISOString()
  };
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

function scriptedPool(responder) {
  const calls = [];
  const transaction = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { transaction.began += 1; },
    async commit() { transaction.committed += 1; },
    async rollback() { transaction.rolledBack += 1; },
    release() { transaction.released += 1; },
    async query(sql, values = []) {
      calls.push({ sql, values });
      return responder(sql, values, calls);
    }
  };
  return {
    calls,
    transaction,
    async getConnection() { return connection; },
    async query(sql, values = []) {
      calls.push({ sql, values });
      return responder(sql, values, calls);
    }
  };
}

function updateOk() {
  return [{ affectedRows: 1 }, []];
}

function runContext(overrides = {}) {
  return {
    run_id: 'run-1',
    recharge_attempt_id: 'attempt-1',
    executor_profile_id: 'profile-1',
    run_status: 'RUNNING',
    payment_state: 'PAYMENT_ARMED',
    post_payment_state: 'NOT_STARTED',
    account_key_hmac: digest('a'),
    worker_id: 'worker-1',
    worker_lease_token_hash: null,
    worker_lease_until: new Date('2026-08-22T00:05:00.000Z'),
    control_state: 'AUTOMATION',
    automation_owner_id: 'worker-1',
    human_owner_id: null,
    last_checkpoint_sequence: 1,
    order_id: 'order-1',
    attempt_status: 'PREPARED',
    funds_risk_state: 'ACTIVE',
    executor_kind: 'BROWSER',
    attempt_profile_id: 'profile-1',
    authorization_item_id: 'authorization-item-1',
    attempt_fulfillment_route_id: 'route-1',
    order_status: 'RECHARGE_PROCESSING',
    order_version: 4,
    order_fulfillment_route_id: 'route-1',
    frozen_card_provider_account_id: 'card-provider-1',
    assigned_card_id: 'card-1',
    minimum_required_card_balance: '16.000000',
    card_id: 'card-1',
    card_order_id: 'order-1',
    card_provider_account_id: 'card-provider-1',
    provider_card_id: 'provider-card-1',
    card_status: 'active',
    card_current_balance: '20.000000',
    card_credentials_ciphertext: Buffer.from('encrypted-card-credentials'),
    card_last_synced_at: new Date('2026-08-22T00:00:00.000Z'),
    card_last_transaction_synced_at: new Date('2026-08-22T00:00:00.000Z'),
    card_consumption_id: 'consumption-1',
    card_consumption_status: 'RESERVED',
    card_consumption_attempt_id: 'attempt-1',
    card_consumption_order_id: 'order-1',
    card_consumption_card_id: 'card-1',
    route_id: 'route-1',
    route_executor_kind: 'BROWSER',
    route_card_provider_account_id: 'card-provider-1',
    ...overrides
  };
}

test('beginRun binds an existing Browser funds attempt without creating a provider call', async () => {
  const pool = scriptedPool((sql) => {
    if (/WHERE br\.start_operation_key/.test(sql)) return [[], []];
    if (/FROM recharge_attempts rat[\s\S]*LEFT JOIN cards/.test(sql)) {
      return [[{
        recharge_attempt_id: 'attempt-1', order_id: 'order-1',
        attempt_status: 'PREPARED', funds_risk_state: 'ACTIVE', executor_kind: 'BROWSER',
        fulfillment_route_id: 'route-1',
        attempt_profile_id: null, order_status: 'RECHARGE_PROCESSING', order_version: 4,
        card_id: 'card-1'
      }], []];
    }
    if (/FROM fulfillment_routes fr[\s\S]*CROSS JOIN executor_profiles/.test(sql)) {
      return [[{
        route_executor_kind: 'BROWSER', profile_status: 'ACTIVE',
        profile_executor_kind: 'BROWSER'
      }], []];
    }
    return updateOk();
  });
  const repository = createBrowserExecutionRepository(pool);
  const result = await repository.beginRun({
    attemptId: 'attempt-1', executorProfileId: 'profile-1',
    accountKeyHmac: digest('a'), workerId: 'worker-1',
    startOperationKey: 'start:task-1', runId: 'run-1',
    now: new Date('2026-08-22T00:00:00.000Z')
  });

  assert.equal(result.runId, 'run-1');
  assert.equal(result.idempotentReplay, false);
  assert.match(result.leaseToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
  assert.equal(pool.calls.some(({ sql }) => /INSERT INTO browser_runs/.test(sql)), true);
  assert.equal(pool.calls.some(({ sql }) => /INSERT INTO browser_operations/.test(sql)), true);
  assert.equal(pool.calls.some(({ sql }) => /provider_calls/.test(sql)), false);
});

test('payment submission commits permit consumption, checkpoint and funds intent atomically', async () => {
  const leaseToken = 'lease-secret';
  const crypto = await import('node:crypto');
  const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
  const permitNonce = 'permit-secret';
  const permitHash = crypto.createHash('sha256').update(permitNonce).digest('hex');
  const context = runContext({ worker_lease_token_hash: leaseHash });
  const pool = scriptedPool((sql) => {
    if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'true' }], []];
    if (/FROM browser_operations/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[context], []];
    }
    if (/FROM payment_permits/.test(sql)) {
      return [[{
        id: 'permit-1', status: 'ISSUED', nonce_hash: permitHash,
        snapshot_hash: paymentSnapshotHash(context), issued_to: 'worker-1',
        expires_at: new Date('2026-08-22T00:02:00.000Z')
      }], []];
    }
    return updateOk();
  });
  const repository = createBrowserExecutionRepository(pool);
  const result = await repository.commitPaymentSubmissionIntent({
    runId: 'run-1', workerId: 'worker-1', leaseToken, permitNonce,
    operationId: 'payment-submit:1', now: new Date('2026-08-22T00:01:00.000Z')
  });

  assert.equal(result.executeExternal, true);
  assert.equal(result.idempotentReplay, false);
  const sqlText = pool.calls.map(({ sql }) => sql).join('\n');
  assert.match(sqlText, /INSERT INTO browser_checkpoints/);
  assert.match(sqlText, /INSERT INTO browser_operations/);
  assert.match(sqlText, /UPDATE payment_permits[\s\S]*status = 'CONSUMED'/);
  assert.match(sqlText, /UPDATE browser_runs[\s\S]*payment_state = 'PAYMENT_SUBMITTING'/);
  assert.match(sqlText, /UPDATE recharge_attempts[\s\S]*status = 'SUBMITTING'[\s\S]*funds_risk_state = 'ACTIVE'/);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
});

test('replayed payment operation never authorizes a second external action', async () => {
  const pool = scriptedPool((sql) => {
    if (/FROM browser_operations/.test(sql)) {
      return [[{
        operation_type: 'PAYMENT_SUBMIT', status: 'COMMITTED',
        result_code: 'EXTERNAL_ACTION_AUTHORIZED', public_result_json: null
      }], []];
    }
    throw new Error(`unexpected query after idempotent replay: ${sql}`);
  });
  const result = await createBrowserExecutionRepository(pool).commitPaymentSubmissionIntent({
    runId: 'run-1', workerId: 'worker-1', leaseToken: 'not-read',
    permitNonce: 'not-read', operationId: 'payment-submit:1'
  });
  assert.deepEqual(result, {
    executeExternal: false,
    idempotentReplay: true,
    resultCode: 'EXTERNAL_ACTION_AUTHORIZED'
  });
  assert.equal(pool.calls.some(({ sql }) => /^\s*UPDATE/m.test(sql)), false);
  assert.equal(pool.calls.some(({ sql }) => /FROM app_settings/.test(sql)), false);
});

test('payment writes fail closed and roll back while the Browser production switch is disabled', async () => {
  const pool = scriptedPool((sql) => {
    if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'false' }], []];
    throw new Error(`unexpected query after disabled switch: ${sql}`);
  });
  await assert.rejects(
    createBrowserExecutionRepository(pool).issuePaymentPermit({
      runId: 'run-1', workerId: 'worker-1', leaseToken: 'lease',
    }),
    (error) => error.code === 'BROWSER_PAYMENT_WRITES_DISABLED'
  );
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('payment permit derives its snapshot from locked card and route facts', async () => {
  const leaseToken = 'lease-secret';
  const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
  const context = runContext({ payment_state: 'NOT_STARTED', last_checkpoint_sequence: 0,
    worker_lease_token_hash: leaseHash });
  const pool = scriptedPool((sql) => {
    if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'true' }], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) return [[context], []];
    return updateOk();
  });
  const result = await createBrowserExecutionRepository(pool).issuePaymentPermit({
    runId: 'run-1', workerId: 'worker-1', leaseToken,
    snapshotHash: digest('f'), permitId: 'permit-1',
    now: new Date('2026-08-22T00:01:00.000Z')
  });
  assert.equal(result.snapshotHash, paymentSnapshotHash(context));
  assert.notEqual(result.snapshotHash, digest('f'));
  const insert = pool.calls.find(({ sql }) => /INSERT INTO payment_permits/.test(sql));
  assert.equal(insert.values[4], paymentSnapshotHash(context));
});

test('payment permit accepts a reused card bound through orders.assigned_card_id', async () => {
  const leaseToken = 'lease-secret';
  const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
  const context = runContext({
    payment_state: 'NOT_STARTED', last_checkpoint_sequence: 0,
    worker_lease_token_hash: leaseHash, card_order_id: 'original-order-1',
  });
  const pool = scriptedPool((sql) => {
    if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'true' }], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) return [[context], []];
    return updateOk();
  });
  const result = await createBrowserExecutionRepository(pool).issuePaymentPermit({
    runId: 'run-1', workerId: 'worker-1', leaseToken,
    permitId: 'permit-reused-card', now: new Date('2026-08-22T00:01:00.000Z'),
  });
  assert.equal(result.snapshotHash, paymentSnapshotHash(context));
});

for (const [name, overrides, code] of [
  ['missing card consumption reservation', { card_consumption_status: 'RELEASED' }, 'CARD_CONSUMPTION_NOT_RESERVED'],
  ['executor profile drift', { attempt_profile_id: 'profile-other' }, 'EXECUTOR_PROFILE_CONFLICT'],
  ['insufficient balance', { card_current_balance: '15.999999' }, 'CARD_BALANCE_INSUFFICIENT'],
  ['inactive card', { card_status: 'frozen' }, 'CARD_NOT_READY'],
  ['missing card credentials', { card_credentials_ciphertext: null }, 'CARD_NOT_READY'],
  ['stale card sync', { card_last_synced_at: new Date('2026-08-21T23:40:00.000Z') }, 'CARD_CHECK_STALE'],
  ['stale transaction evidence', { card_last_transaction_synced_at: new Date('2026-08-21T23:40:00.000Z') }, 'CARD_TRANSACTION_CHECK_STALE'],
  ['frozen source mismatch', { frozen_card_provider_account_id: 'card-provider-2' }, 'CARD_PROVIDER_MISMATCH']
]) {
  test(`payment permit rejects ${name}`, async () => {
    const leaseToken = 'lease-secret';
    const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
    const pool = scriptedPool((sql) => {
      if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'true' }], []];
      if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
        return [[runContext({ payment_state: 'NOT_STARTED', worker_lease_token_hash: leaseHash, ...overrides })], []];
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    await assert.rejects(
      createBrowserExecutionRepository(pool).issuePaymentPermit({
        runId: 'run-1', workerId: 'worker-1', leaseToken,
        now: new Date('2026-08-22T00:01:00.000Z')
      }),
      (error) => error.code === code
    );
    assert.equal(pool.transaction.rolledBack, 1);
  });
}

test('payment submission rejects an authoritative snapshot changed after permit issuance', async () => {
  const leaseToken = 'lease-secret';
  const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
  const permitNonce = 'permit-secret';
  const permitHash = crypto.createHash('sha256').update(permitNonce).digest('hex');
  const original = runContext({ worker_lease_token_hash: leaseHash });
  const changed = { ...original, card_current_balance: '19.000000' };
  const pool = scriptedPool((sql) => {
    if (/FROM browser_operations/.test(sql)) return [[], []];
    if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'true' }], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) return [[changed], []];
    if (/FROM payment_permits/.test(sql)) return [[{
      id: 'permit-1', status: 'ISSUED', nonce_hash: permitHash,
      snapshot_hash: paymentSnapshotHash(original), issued_to: 'worker-1',
      expires_at: new Date('2026-08-22T00:02:00.000Z')
    }], []];
    throw new Error(`unexpected query: ${sql}`);
  });
  await assert.rejects(
    createBrowserExecutionRepository(pool).commitPaymentSubmissionIntent({
      runId: 'run-1', workerId: 'worker-1', leaseToken, permitNonce,
      operationId: 'payment-submit:changed', now: new Date('2026-08-22T00:01:00.000Z')
    }),
    (error) => error.code === 'PAYMENT_SNAPSHOT_CHANGED'
  );
  assert.equal(pool.calls.some(({ sql }) => /operation_type.*PAYMENT_SUBMIT/.test(sql) && /INSERT/.test(sql)), false);
});

test('Session failure before payment atomically closes Browser state and opens replacement', async () => {
  const leaseToken = 'lease-secret';
  const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
  const pool = scriptedPool((sql) => {
    if (/WHERE browser_run_id = \? AND operation_id = \?/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[runContext({ payment_state: 'PAYMENT_ARMED', worker_lease_token_hash: leaseHash })], []];
    }
    if (/operation_type = 'PAYMENT_SUBMIT'/.test(sql)) return [[], []];
    if (/SELECT id, status FROM payment_permits/.test(sql)) return [[{ id: 'permit-1', status: 'ISSUED' }], []];
    if (/session_replacement_window_hours/.test(sql)) return [[{ setting_value: '72' }], []];
    return updateOk();
  });
  const result = await createBrowserExecutionRepository(pool).abortBeforePayment({
    runId: 'run-1', workerId: 'worker-1', leaseToken,
    operationId: 'safe-abort:session-1', targetOrderStatus: 'WAITING_FOR_SESSION',
    reasonCode: 'SESSION_INVALID', failureReason: 'Session is invalid',
    customerActionCode: 'SESSION_INVALID', now: new Date('2026-08-22T00:01:00.000Z')
  });
  assert.equal(result.runStatus, 'FAILED_SAFE');
  assert.equal(result.attemptStatus, 'CLEARED');
  assert.equal(result.fundsRiskState, 'CLEARED');
  assert.equal(result.orderStatus, 'WAITING_FOR_SESSION');
  const sqlText = pool.calls.map(({ sql }) => sql).join('\n');
  assert.match(sqlText, /payment_permits SET status = 'REVOKED'/);
  assert.match(sqlText, /checkout_artifacts[\s\S]*status = 'INVALIDATED'/);
  assert.match(sqlText, /browser_artifact_secrets[\s\S]*ciphertext = NULL/);
  assert.match(sqlText, /execution_resource_leases[\s\S]*released_at/);
  assert.match(sqlText, /browser_dispatch_jobs[\s\S]*status = 'CANCELLED'/);
  assert.match(sqlText, /recharge_authorization_items SET status = 'RELEASED'/);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
});

test('pre-payment abort refuses any committed payment-submit evidence', async () => {
  const leaseToken = 'lease-secret';
  const leaseHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
  const pool = scriptedPool((sql) => {
    if (/WHERE browser_run_id = \? AND operation_id = \?/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[runContext({ payment_state: 'PAYMENT_ARMED', worker_lease_token_hash: leaseHash })], []];
    }
    if (/operation_type = 'PAYMENT_SUBMIT'/.test(sql)) return [[{ id: 1 }], []];
    if (/SELECT id, status FROM payment_permits/.test(sql)) return [[{ id: 'permit-1', status: 'CONSUMED' }], []];
    throw new Error(`unexpected query: ${sql}`);
  });
  await assert.rejects(
    createBrowserExecutionRepository(pool).abortBeforePayment({
      runId: 'run-1', workerId: 'worker-1', leaseToken,
      operationId: 'safe-abort:unsafe', targetOrderStatus: 'WAITING_FOR_SESSION',
      reasonCode: 'SESSION_INVALID', failureReason: 'Session is invalid',
      customerActionCode: 'SESSION_INVALID', now: new Date('2026-08-22T00:01:00.000Z')
    }),
    (error) => error.code === 'RECONCILE_ONLY'
  );
  assert.equal(pool.transaction.rolledBack, 1);
  assert.equal(pool.calls.some(({ sql }) => /UPDATE browser_runs/.test(sql)), false);
});

test('unknown Browser payment locks run, attempt and order into reconciliation in one transaction', async () => {
  const pool = scriptedPool((sql) => {
    if (/FROM browser_operations/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[runContext({
        payment_state: 'PAYMENT_SUBMITTING', attempt_status: 'SUBMITTING'
      })], []];
    }
    return updateOk();
  });
  const result = await createBrowserExecutionRepository(pool).markPaymentUnknown({
    runId: 'run-1', operationId: 'payment-unknown:1',
    reasonCode: 'BROWSER_DISCONNECTED', now: new Date('2026-08-22T00:02:00.000Z')
  });

  assert.equal(result.runStatus, 'RECONCILE_ONLY');
  assert.equal(result.paymentState, 'PAYMENT_UNKNOWN');
  assert.equal(result.fundsRiskState, 'UNKNOWN');
  assert.equal(result.orderStatus, 'SUBMIT_UNKNOWN');
  const sqlText = pool.calls.map(({ sql }) => sql).join('\n');
  assert.match(sqlText, /UPDATE browser_runs[\s\S]*status = 'RECONCILE_ONLY'/);
  assert.match(sqlText, /UPDATE recharge_attempts[\s\S]*funds_risk_state = 'UNKNOWN'/);
  assert.match(sqlText, /UPDATE orders[\s\S]*status = 'SUBMIT_UNKNOWN'/);
  assert.doesNotMatch(sqlText, /INSERT INTO reconciliation_cases/);
  assert.match(sqlText, /verification_state = 'VERIFYING_PAYMENT'/);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
});

test('recovery state becomes reconcile-only after a committed payment submit intent', async () => {
  const pool = scriptedPool((sql) => {
    if (/FROM browser_runs br/.test(sql)) {
      return [[{
        ...runContext({ payment_state: 'PAYMENT_SUBMITTING', attempt_status: 'SUBMITTING' }),
        payment_submit_committed: 1
      }], []];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const result = await createBrowserExecutionRepository(pool).getRecoveryState('run-1');
  assert.equal(result.recoveryMode, 'RECONCILE_ONLY');
});

test('confirmed payment schedules bounded post-payment recovery for only the approved order', async () => {
  const pool = scriptedPool((sql) => {
    if (/verification_next_check_at IS NULL/.test(sql)) return [[], []];
    if (/FROM browser_operations/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[runContext({ payment_state: 'PAYMENT_CONFIRMED',
        post_payment_state: 'PLUS_PENDING', attempt_status: 'SUBMITTING' })], []];
    }
    return updateOk();
  });
  const repository = createBrowserExecutionRepository(pool);
  const scheduled = await repository.schedulePostPaymentVerification({
    runId: 'run-1', operationId: 'schedule-post-payment:1',
    reasonCode: 'PLUS_ACTIVATION_UNCONFIRMED',
    verificationNextCheckAt: new Date('2026-08-22T00:02:05.000Z'),
    verificationDeadline: new Date('2026-08-22T00:07:00.000Z'),
    now: new Date('2026-08-22T00:02:00.000Z'),
  });
  assert.equal(scheduled.verificationState, 'VERIFYING_PAYMENT');
  assert.match(pool.calls.map(({ sql }) => sql).join('\n'), /POST_PAYMENT_VERIFICATION_SCHEDULED/);

  pool.calls.length = 0;
  await repository.listPaymentVerificationsDue({
    orderId: 'order-1', now: new Date('2026-08-22T00:03:00.000Z'), limit: 1,
  });
  assert.match(pool.calls[0].sql, /rat\.order_id = \?/);
  assert.deepEqual(pool.calls[0].values, [new Date('2026-08-22T00:03:00.000Z'), 'order-1', 1]);
});

test('post-payment lifecycle requires activation and cancellation before final success', async () => {
  let phase = 0;
  const pool = scriptedPool((sql) => {
    if (/FROM browser_operations/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[runContext({
        payment_state: phase === 0 ? 'PAYMENT_SUBMITTING' : 'PAYMENT_CONFIRMED',
        post_payment_state: phase === 0 ? 'NOT_STARTED' : phase === 1 ? 'PLUS_PENDING' : 'CANCELLATION_PENDING',
        attempt_status: 'SUBMITTING'
      })], []];
    }
    return updateOk();
  });
  const repository = createBrowserExecutionRepository(pool);
  const evidence = digest('c');
  const confirmed = await repository.markPaymentConfirmed({
    runId: 'run-1', operationId: 'payment-confirmed:1', evidenceHash: evidence
  });
  assert.equal(confirmed.postPaymentState, 'PLUS_PENDING');
  phase = 1;

  const activated = await repository.recordPlusActivation({
    runId: 'run-1', operationId: 'plus-activated:1', evidenceHash: evidence
  });
  assert.equal(activated.postPaymentState, 'CANCELLATION_PENDING');
  phase = 2;

  const completed = await repository.recordCancellationConfirmed({
    runId: 'run-1', operationId: 'cancel-confirmed:1', evidenceHash: evidence
  });
  assert.equal(completed.runStatus, 'COMPLETED');
  assert.equal(completed.orderStatus, 'RECHARGE_SUCCESS');
  assert.equal(completed.attemptStatus, 'SUCCESS');
  assert.equal(completed.fundsRiskState, 'SETTLED');
  const sqlText = pool.calls.map(({ sql }) => sql).join('\n');
  assert.match(sqlText, /browser_post_payment_observations/);
  assert.match(sqlText, /post_payment_state = 'PLUS_PENDING'/);
  assert.match(sqlText, /post_payment_state = 'CANCELLATION_PENDING'/);
  assert.match(sqlText, /status = 'RECHARGE_SUCCESS'/);
});
