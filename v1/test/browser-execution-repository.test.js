import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserExecutionRepository } from '../src/db/repositories/browser-execution-repository.js';

const digest = (character) => character.repeat(64);

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
    order_status: 'SUBMITTING',
    order_version: 4,
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
        attempt_profile_id: null, order_status: 'SUBMITTING', order_version: 4,
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
  const pool = scriptedPool((sql) => {
    if (/FROM app_settings/.test(sql)) return [[{ setting_value: 'true' }], []];
    if (/FROM browser_operations/.test(sql)) return [[], []];
    if (/FROM browser_runs br[\s\S]*INNER JOIN recharge_attempts/.test(sql)) {
      return [[runContext({ worker_lease_token_hash: leaseHash })], []];
    }
    if (/FROM payment_permits/.test(sql)) {
      return [[{
        id: 'permit-1', status: 'ISSUED', nonce_hash: permitHash,
        snapshot_hash: digest('b'), issued_to: 'worker-1',
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
      snapshotHash: digest('b')
    }),
    (error) => error.code === 'BROWSER_PAYMENT_WRITES_DISABLED'
  );
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
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
  assert.match(sqlText, /INSERT INTO reconciliation_cases/);
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
  assert.equal(completed.attemptStatus, 'CLEARED');
  const sqlText = pool.calls.map(({ sql }) => sql).join('\n');
  assert.match(sqlText, /browser_post_payment_observations/);
  assert.match(sqlText, /post_payment_state = 'PLUS_PENDING'/);
  assert.match(sqlText, /post_payment_state = 'CANCELLATION_PENDING'/);
  assert.match(sqlText, /status = 'RECHARGE_SUCCESS'/);
});
