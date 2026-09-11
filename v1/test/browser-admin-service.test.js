import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserAdminService } from '../src/services/browser-admin-service.js';

function queuedPool(results = []) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      if (!results.length) throw new Error(`unexpected query: ${sql}`);
      return [results.shift(), []];
    },
    async getConnection() { throw new Error('unexpected transaction'); }
  };
}

const now = new Date('2026-08-22T00:00:00.000Z');
const runRow = {
  run_id: 'run-1', recharge_attempt_id: 'attempt-1', run_no: 1,
  run_status: 'HUMAN_REQUIRED', payment_state: 'NOT_STARTED', control_state: 'FROZEN',
  worker_id: 'worker-a', worker_lease_until: now, automation_owner_id: 'worker-a',
  human_owner_id: null, selected_lane: 'HOSTED', last_checkpoint_sequence: 2,
  last_checkpoint_kind: 'CONTROL_FREEZE', last_error_code: null,
  created_at: now, updated_at: now, finished_at: null,
  attempt_status: 'PREPARED', funds_risk_state: 'ACTIVE',
  public_no: 'PJV1-BROWSER', order_status: 'RECHARGE_PROCESSING',
  profile_code: 'BROWSER_V1', profile_version: 1,
  runtime_id: 'PLAYWRIGHT', adapter_version: 'v1',
  artifact_id: 'artifact-1', artifact_kind: 'HOSTED_COMPLETE',
  artifact_status: 'ACTIVE', artifact_expires_at: now
};

const dispatchRow = {
  dispatch_id: 41, job_key: 'browser:attempt-1', recharge_attempt_id: 'attempt-1',
  order_id: 'order-1', executor_profile_id: 'profile-1', dispatch_status: 'CLAIMED',
  lease_owner: 'worker-a', lease_until: now, attempt_count: 2,
  last_error_code: 'LEASE_EXPIRED', queued_at: now, claimed_at: now,
  completed_at: null, updated_at: now,
  attempt_status: 'PREPARED', funds_risk_state: 'ACTIVE',
  public_no: 'PJV1-BROWSER', order_status: 'RECHARGE_PROCESSING',
  profile_code: 'BROWSER_V1', profile_version: 1,
  runtime_id: 'CHROME', adapter_version: 'v1',
  run_id: 'run-1', run_no: 1, run_status: 'RUNNING', payment_state: 'NOT_STARTED'
};

test('lists queued and claimed Browser dispatch jobs without lease authority', async () => {
  const pool = queuedPool([[dispatchRow], [{ total: 1 }]]);
  const result = await createBrowserAdminService({ pool }).listDispatchJobs({
    page: '1', pageSize: '20', status: 'CLAIMED', publicNo: 'PJV1-BROWSER'
  });
  assert.equal(result.total, 1);
  assert.deepEqual(result.jobs[0].lease, { owner: 'worker-a', until: now.toISOString() });
  assert.deepEqual(result.jobs[0].latestRun, {
    id: 'run-1', runNo: 1, status: 'RUNNING', paymentState: 'NOT_STARTED'
  });
  assert.equal(result.jobs[0].attemptCount, 2);
  assert.equal(Object.hasOwn(result.jobs[0], 'orderId'), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('leaseToken'), false);
  assert.equal(serialized.includes('leaseTokenHash'), false);
  assert.doesNotMatch(pool.queries[0].sql, /lease_token_hash|session|ciphertext|card_credentials/i);
  assert.deepEqual(pool.queries[0].values, ['CLAIMED', 'PJV1-BROWSER', 20, 0]);
});

test('dispatch list includes a QUEUED job before a Browser run exists', async () => {
  const pool = queuedPool([[[
    { ...dispatchRow, dispatch_status: 'QUEUED', lease_owner: null, lease_until: null,
      attempt_count: 0, run_id: null, run_no: null, run_status: null, payment_state: null }
  ][0]], [{ total: 1 }]]);
  const result = await createBrowserAdminService({ pool }).listDispatchJobs();
  assert.equal(result.jobs[0].status, 'QUEUED');
  assert.equal(result.jobs[0].lease, null);
  assert.equal(result.jobs[0].latestRun, null);
});

test('lists Browser runs without selecting authority, lease hashes, or account HMACs', async () => {
  const pool = queuedPool([[runRow], [{ total: 1 }]]);
  const result = await createBrowserAdminService({ pool }).listRuns({
    page: '1', pageSize: '20', controlState: 'FROZEN', publicNo: 'PJV1-BROWSER'
  });
  assert.equal(result.total, 1);
  assert.equal(result.runs[0].activeArtifact.id, 'artifact-1');
  assert.equal(result.runs[0].worker.id, 'worker-a');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secretRef'), false);
  assert.equal(serialized.includes('accountKeyHmac'), false);
  assert.equal(serialized.includes('leaseToken'), false);
  assert.doesNotMatch(pool.queries[0].sql, /secret_ref|ciphertext|lease_token_hash|resource_key_hmac|account_key_hmac/i);
  assert.deepEqual(pool.queries[0].values.slice(-4), ['FROZEN', 'PJV1-BROWSER', 20, 0]);
});

test('Browser run detail redacts evidence and omits every authority-bearing column', async () => {
  const pool = queuedPool([
    [runRow],
    [{ sequence_no: 2, checkpoint_kind: 'CONTROL_FREEZE', payment_risk: 'NONE',
      operation_id: 'op-1', page_signature_hash: 'a'.repeat(64),
      evidence_json: JSON.stringify({ accessToken: 'eyJ.secret.value', cardNumber: '4242424242424242' }),
      created_at: now }],
    [{ operation_id: 'op-1', operation_type: 'MANUAL_CONTROL', status: 'COMMITTED',
      result_code: 'FREEZE', public_result_json: JSON.stringify({ sessionToken: 'secret' }),
      prepared_at: now, completed_at: now }],
    [{ id: 'permit-1', status: 'ISSUED', issued_to: 'worker-a', expires_at: now,
      issued_at: now, consumed_at: null, revoked_at: null }],
    [{ id: 'artifact-1', artifact_kind: 'HOSTED_COMPLETE', status: 'ACTIVE',
      created_at: now, opened_at: null, expires_at: now, invalidated_at: null, destroyed_at: null }],
    [{ id: 'lease-1', resource_type: 'ACCOUNT', owner_id: 'worker-a', lease_until: now,
      acquired_at: now, heartbeat_at: now, released_at: null, release_reason: null }],
    [{ id: 'intervention-1', status: 'FROZEN', requested_by: 'admin',
      automation_owner_id: 'worker-a', human_owner_id: null, reason_code: 'OPERATOR_REVIEW',
      result_code: null, requested_at: now, transferred_at: null, finished_at: null }],
    [{ id: 'case-1', case_type: 'BROWSER_PAYMENT_UNKNOWN', status: 'OPEN',
      severity: 'critical', assigned_to: null, detected_at: now,
      last_seen_at: now, resolved_at: null }]
  ]);
  const result = await createBrowserAdminService({ pool }).getRun('run-1');
  assert.equal(result.checkpoints[0].evidence.accessToken, '[REDACTED]');
  assert.equal(result.checkpoints[0].evidence.cardNumber, '[REDACTED]');
  assert.equal(result.operations[0].result.sessionToken, '[REDACTED]');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret_ref'), false);
  assert.equal(serialized.includes('ciphertext'), false);
  assert.equal(serialized.includes('lease_token'), false);
  assert.equal(serialized.includes('resource_key'), false);
  assert.equal(pool.queries.some(({ sql }) => /secret_ref|ciphertext|lease_token_hash|resource_key_hmac|account_key_hmac/i.test(sql)), false);
});

test('rejects invalid filters and control confirmations before database access', async () => {
  const pool = queuedPool();
  const service = createBrowserAdminService({ pool });
  await assert.rejects(() => service.listRuns({ status: 'NOT_A_STATUS' }), {
    code: 'INVALID_RUN_STATUS'
  });
  await assert.rejects(() => service.listDispatchJobs({ status: 'NOT_A_STATUS' }), {
    code: 'INVALID_DISPATCH_STATUS'
  });
  await assert.rejects(() => service.controlRun('run-1', {
    action: 'REQUEST', operationId: 'op-1', confirmation: 'yes',
    reasonCode: 'OPERATOR_REVIEW'
  }), { code: 'CONTROL_CONFIRMATION_REQUIRED' });
  assert.equal(pool.queries.length, 0);
});

test('manual payment confirmation validates outcome and evidence before database access', async () => {
  const pool = queuedPool();
  const service = createBrowserAdminService({ pool });
  const base = {
    action: 'CONFIRM_MANUAL_PAYMENT', operationId: 'op-2',
    confirmation: '确认人工付款已完成 run-1'
  };
  await assert.rejects(() => service.controlRun('run-1', { ...base, evidenceNote: 'seen' }),
    { code: 'INVALID_MANUAL_OUTCOME' });
  await assert.rejects(() => service.controlRun('run-1', { ...base, manualOutcome: 'PAID', evidenceNote: 'seen' }),
    { code: 'INVALID_MANUAL_OUTCOME' });
  await assert.rejects(() => service.controlRun('run-1', { ...base, manualOutcome: 'UPGRADED_20X' }),
    { code: 'INVALID_ARGUMENT' });
  await assert.rejects(() => service.controlRun('run-1', {
    ...base, manualOutcome: 'PLUS_ACTIVE', evidenceNote: 'x'.repeat(501)
  }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(() => service.controlRun('run-1', {
    ...base, confirmation: '确认20X升级完成 run-1', manualOutcome: 'UPGRADED_20X', evidenceNote: 'seen'
  }), { code: 'CONTROL_CONFIRMATION_REQUIRED' });
  assert.equal(pool.queries.length, 0);
});

// F-16/F-3: the only formal closeout for a payment-result-unknown or escalated-to-human run.
test('resolve-unknown-payment validates outcome, confirmation, and evidence before database access', async () => {
  const pool = queuedPool();
  const service = createBrowserAdminService({ pool });
  const base = {
    action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: 'op-3',
    confirmation: '确认核实结果 run-1'
  };
  await assert.rejects(() => service.controlRun('run-1', { ...base, evidenceNote: 'checked the account' }),
    { code: 'INVALID_VERIFIED_OUTCOME' });
  await assert.rejects(() => service.controlRun('run-1', { ...base, verifiedOutcome: 'MAYBE', evidenceNote: 'x' }),
    { code: 'INVALID_VERIFIED_OUTCOME' });
  await assert.rejects(() => service.controlRun('run-1', { ...base, verifiedOutcome: 'CHARGED' }),
    { code: 'INVALID_ARGUMENT' }); // evidenceNote required
  await assert.rejects(() => service.controlRun('run-1', {
    ...base, verifiedOutcome: 'CHARGED', evidenceNote: 'x'.repeat(501)
  }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(() => service.controlRun('run-1', {
    ...base, confirmation: '确认付款结果未知 run-1', verifiedOutcome: 'CHARGED', evidenceNote: 'seen'
  }), { code: 'CONTROL_CONFIRMATION_REQUIRED' });
  assert.equal(pool.queries.length, 0);
});

// F-44: a JSON string "false" was Boolean()-coerced to true and closed the order as
// RECHARGE_SUCCESS with the renewal review skipped. Only real booleans are accepted.
test('resolve-unknown-payment refuses a non-boolean renewalCancelled before database access', async () => {
  const pool = queuedPool();
  const service = createBrowserAdminService({ pool });
  const base = {
    action: 'RESOLVE_UNKNOWN_PAYMENT', operationId: 'op-4',
    confirmation: '确认核实结果 run-1', verifiedOutcome: 'CHARGED', evidenceNote: 'account shows Plus'
  };
  for (const bad of ['false', 'true', 1, 0, 'yes', {}, []]) {
    await assert.rejects(() => service.controlRun('run-1', { ...base, renewalCancelled: bad }),
      { code: 'INVALID_RENEWAL_CANCELLED' }, `renewalCancelled=${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(pool.queries.length, 0);
});
