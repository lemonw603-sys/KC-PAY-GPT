import test from 'node:test';
import assert from 'node:assert/strict';

import { ContractError, hasSensitiveKey } from '../src/contracts.js';
import {
  BROWSER_ELIGIBLE_ATTEMPT_STATUSES,
  BROWSER_ELIGIBLE_ORDER_STATUSES,
  projectSharedBrowserJob,
  ReadOnlySharedContractAdapter,
} from '../src/shared-contract-adapter.js';

function projection(overrides = {}) {
  return {
    order: { id: 'ord-0001', status: 'CARD_READY' },
    attempt: { id: 'att-0001', status: 'PENDING' },
    profile: { id: 'prof-0001', runtimeDigest: 'a'.repeat(64) },
    fundsGate: { status: 'NOT_REQUESTED' },
    auditRef: 'audit-0001',
    ...overrides,
  };
}

test('read-only projection maps shared references without copying business state', () => {
  const adapter = new ReadOnlySharedContractAdapter();
  const job = adapter.project(projection());
  assert.equal(job.jobId, 'brjob:ord-0001:att-0001');
  assert.equal(job.orderRef, 'order:ord-0001');
  assert.equal(job.attemptRef, 'attempt:att-0001');
  assert.equal(job.profileRef, 'profile:prof-0001');
  assert.equal(job.metadata.fundsGate.status, 'NOT_REQUESTED');
  assert.equal(hasSensitiveKey(job), false);
});

test('only explicitly approved order and attempt states cross the Browser boundary', () => {
  for (const status of BROWSER_ELIGIBLE_ORDER_STATUSES) {
    assert.doesNotThrow(() => projectSharedBrowserJob(projection({ order: { id: 'ord-0001', status } })));
  }
  for (const status of BROWSER_ELIGIBLE_ATTEMPT_STATUSES) {
    assert.doesNotThrow(() => projectSharedBrowserJob(projection({ attempt: { id: 'att-0001', status } })));
  }
  assert.throws(() => projectSharedBrowserJob(projection({ order: { id: 'ord-0001', status: 'SUBMITTING' } })), ContractError);
  assert.throws(() => projectSharedBrowserJob(projection({ attempt: { id: 'att-0001', status: 'COMPLETED' } })), ContractError);
});

test('active funds permits and credential-shaped fields are rejected', () => {
  assert.throws(() => projectSharedBrowserJob(projection({ fundsGate: { status: 'GRANTED', permitRef: 'permit-0001' } })), ContractError);
  assert.throws(() => projectSharedBrowserJob(projection({ session_ciphertext: 'ciphertext' })), ContractError);
  assert.throws(() => projectSharedBrowserJob(projection({ card: { card_credentials_ciphertext: 'ciphertext' } })), ContractError);
});
