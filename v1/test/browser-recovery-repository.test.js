import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserRecoveryError,
  createBrowserRecoveryRepository
} from '../src/db/repositories/browser-recovery-repository.js';

function repository(pool = { getConnection: async () => { throw new Error('database should not be reached'); } }) {
  return createBrowserRecoveryRepository(pool, {
    artifactKeys: new Map([[1, Buffer.alloc(32, 1)]]),
    currentArtifactKeyVersion: 1,
    resourceHmacKey: Buffer.alloc(32, 2)
  });
}

test('recovery repository requires explicit independent 32-byte keys and an available version', () => {
  assert.throws(
    () => createBrowserRecoveryRepository({}, {
      artifactKeys: new Map([[1, Buffer.alloc(31)]]),
      currentArtifactKeyVersion: 1,
      resourceHmacKey: Buffer.alloc(32)
    }),
    (error) => error instanceof BrowserRecoveryError && error.code === 'INVALID_KEY'
  );
  assert.throws(
    () => createBrowserRecoveryRepository({}, {
      artifactKeys: new Map([[1, Buffer.alloc(32)]]),
      currentArtifactKeyVersion: 2,
      resourceHmacKey: Buffer.alloc(32)
    }),
    (error) => error.code === 'INVALID_KEY'
  );
});

test('unapproved, credential-bearing and incomplete Checkout authorities fail before MySQL access', async () => {
  for (const navigationUrl of [
    'https://pay.openai.com.evil.test/c/pay/cs_live_abc#fid',
    'https://user:pass@pay.openai.com/c/pay/cs_live_abc#fid',
    'https://pay.openai.com/c/pay/cs_live_abc',
    'https://chatgpt.com/checkout/not-a-checkout-id'
  ]) {
    await assert.rejects(
      repository().storeCheckoutArtifact({
        runId: 'run-1', ownerId: 'worker-1', leaseToken: 'lease-1', navigationUrl
      }),
      (error) => error.code === 'INVALID_CHECKOUT_ARTIFACT'
    );
  }
});

test('artifact destruction requires a deterministic allowlisted reason before MySQL access', async () => {
  await assert.rejects(
    repository().destroyCheckoutArtifact({
      runId: 'run-1', artifactId: 'artifact-1', ownerId: 'worker-1',
      leaseToken: 'lease-1', reasonCode: 'IT_LOOKS_OLD'
    }),
    (error) => error.code === 'INVALID_DESTROY_REASON'
  );
});

// 第④步（面三③，D-248）：崩溃 / 租约丢失后 RECONCILE_ONLY 不再是终点，进付款后补核。
function recoveryHarness(row, { paymentOperations = 1 } = {}) {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      if (flat.startsWith('SELECT br.id AS run_id')) return [[row]];
      if (flat.startsWith('SELECT id FROM browser_operations')) return [Array.from({ length: paymentOperations }, (_, i) => ({ id: i }))];
      if (flat.startsWith('SELECT public_no')) return [[{ public_no: 'PJV1-r' }]];
      return [{ affectedRows: 1 }];
    }
  };
  return { queries, repo: repository({ getConnection: async () => connection }) };
}
const baseRun = { run_id: 'run-1', run_status: 'RUNNING', account_key_hmac: 'h', worker_id: 'w-old', worker_lease_token_hash: 't',
  worker_lease_until: new Date(0), control_state: 'AUTOMATION', automation_owner_id: 'w-old', attempt_id: 'att-1', order_id: 'o1',
  order_status: 'RECHARGE_PROCESSING', order_version: 5, card_id: 'c1', active_artifact_id: null };

test('restart after the payment click (PAYMENT_SUBMITTING, no terminal result) → PAYMENT_UNKNOWN + VERIFYING_PAYMENT, funds fence locked, order SUBMIT_UNKNOWN', async () => {
  const h = recoveryHarness({ ...baseRun, payment_state: 'PAYMENT_SUBMITTING', attempt_status: 'SUBMITTING', funds_risk_state: 'ACTIVE', verification_state: 'NOT_REQUIRED' });
  const result = await h.repo.recoverExpiredRun({ runId: 'run-1', newOwnerId: 'w-new', ttlSeconds: 60, now: new Date('2026-09-18T12:00:00Z') });
  assert.deepEqual(result, { runId: 'run-1', recoveryMode: 'RECONCILE_ONLY', leaseToken: null, verification: 'PAYMENT_UNKNOWN' });
  const run = h.queries.find((q) => /UPDATE browser_runs SET status = 'RECONCILE_ONLY', payment_state = 'PAYMENT_UNKNOWN'/.test(q.sql));
  assert.ok(run, 'run enters the verification lane');
  assert.equal(run.params[1].toISOString(), '2026-09-18T12:30:00.000Z', 'deadline = now + 30min (window放长)');
  const attempt = h.queries.find((q) => /UPDATE recharge_attempts SET status = 'SUBMIT_UNKNOWN', funds_risk_state = 'UNKNOWN'/.test(q.sql));
  assert.equal(attempt.params[2], 'att-1');
  assert.equal(h.queries.find((q) => /UPDATE card_consumption_ledger/.test(q.sql)).params[0], 'RECONCILIATION');
  assert.equal(h.queries.find((q) => /UPDATE orders SET status = 'SUBMIT_UNKNOWN'/.test(q.sql)).params[4], 5);
  assert.equal(h.queries.some((q) => /INSERT INTO order_events/.test(q.sql)), true);
  assert.equal(h.queries.find((q) => /INSERT INTO operator_alerts/.test(q.sql)).params[0], 'BROWSER_PAYMENT_UNKNOWN');
  assert.equal(h.queries.some((q) => /worker_lease_token_hash = \?/.test(q.sql) && /SET status = 'RUNNING'/.test(q.sql)), false, 'no new lease is ever issued after a submit');
});

test('restart while the payment is already confirmed keeps the run RUNNING for the post-payment lane and issues no lease', async () => {
  const h = recoveryHarness({ ...baseRun, payment_state: 'PAYMENT_CONFIRMED', attempt_status: 'SUBMITTING', funds_risk_state: 'ACTIVE', verification_state: 'VERIFYING_PAYMENT' });
  const result = await h.repo.recoverExpiredRun({ runId: 'run-1', newOwnerId: 'w-new', ttlSeconds: 60 });
  assert.equal(result.recoveryMode, 'RECONCILE_ONLY');
  assert.equal(result.verification, 'POST_PAYMENT');
  assert.equal(h.queries.some((q) => /SET status = 'RECONCILE_ONLY'/.test(q.sql)), false, 'PAYMENT_CONFIRMED stays RUNNING so listPaymentVerificationsDue can pick it');
  assert.equal(h.queries.some((q) => q.sql.startsWith('UPDATE recharge_attempts') || q.sql.startsWith('UPDATE orders')), false);
});

test('an already-UNKNOWN run that lost its verification schedule gets VERIFYING_PAYMENT back on restart', async () => {
  const h = recoveryHarness({ ...baseRun, run_status: 'RECONCILE_ONLY', payment_state: 'PAYMENT_UNKNOWN', attempt_status: 'SUBMIT_UNKNOWN', funds_risk_state: 'UNKNOWN', verification_state: 'NOT_REQUIRED' });
  const result = await h.repo.recoverExpiredRun({ runId: 'run-1', newOwnerId: 'w-new', ttlSeconds: 60 });
  assert.equal(result.recoveryMode, 'RECONCILE_ONLY');
  const run = h.queries.find((q) => /SET status = 'RECONCILE_ONLY', verification_state = IF/.test(q.sql));
  assert.ok(run);
  assert.equal(h.queries.some((q) => /UPDATE recharge_attempts/.test(q.sql)), false, 'attempt already UNKNOWN: untouched');
});
