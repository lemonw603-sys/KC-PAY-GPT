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
  await assert.rejects(() => service.controlRun('run-1', {
    action: 'REQUEST', operationId: 'op-1', confirmation: 'yes',
    reasonCode: 'OPERATOR_REVIEW'
  }), { code: 'CONTROL_CONFIRMATION_REQUIRED' });
  assert.equal(pool.queries.length, 0);
});
