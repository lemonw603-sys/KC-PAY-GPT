import test from 'node:test';
import assert from 'node:assert/strict';

import { ContractError, hasSensitiveKey } from '../src/contracts.js';
import {
  BROWSER_ELIGIBLE_ATTEMPT_STATUSES,
  BROWSER_ELIGIBLE_FUNDS_RISK_STATES,
  BROWSER_ELIGIBLE_ORDER_STATUSES,
  projectSharedBrowserJob,
  ReadOnlySharedContractAdapter,
} from '../src/shared-contract-adapter.js';

function projection(overrides = {}) {
  return {
    order: { id: 'ord-0001', status: 'RECHARGE_PROCESSING', fulfillmentRouteId: 'route-0001' },
    attempt: {
      id: 'att-0001', status: 'PREPARED', fundsRiskState: 'ACTIVE',
      executorKind: 'BROWSER', executorProfileId: 'prof-0001', fulfillmentRouteId: 'route-0001',
    },
    profile: { id: 'prof-0001' },
    card: {
      id: 'card-0001', orderId: 'ord-0001', providerCardRef: 'provider-card-0001',
      providerAccountId: 'provider-account-0001',
    },
    cardConsumption: {
      id: 'consumption-0001', status: 'RESERVED', attemptId: 'att-0001',
      orderId: 'ord-0001', cardId: 'card-0001',
    },
    route: { id: 'route-0001', executorKind: 'BROWSER', cardProviderAccountId: 'provider-account-0001' },
    ...overrides,
  };
}

test('formal projection maps shared references without parallel business states', () => {
  const adapter = new ReadOnlySharedContractAdapter();
  const job = adapter.project(projection(), { sessionRef: 'session-runtime-0001' });
  assert.equal(job.jobId, 'brjob:ord-0001:att-0001');
  assert.equal(job.orderRef, 'order:ord-0001');
  assert.equal(job.attemptRef, 'attempt:att-0001');
  assert.equal(job.profileRef, 'profile:prof-0001');
  assert.deepEqual(job.metadata.sharedState, {
    orderStatus: 'RECHARGE_PROCESSING', attemptStatus: 'PREPARED',
    fundsRiskState: 'ACTIVE', executorKind: 'BROWSER',
  });
  assert.equal(job.metadata.upstream.cardId, 'card-0001');
  assert.equal(job.metadata.upstream.cardConsumptionId, 'consumption-0001');
  assert.equal(job.metadata.sessionRef, 'session-runtime-0001');
  assert.equal('fundsGate' in job.metadata, false);
  assert.equal('auditRef' in job.metadata, false);
  assert.equal(hasSensitiveKey(job), false);
});

test('only RECHARGE_PROCESSING plus PREPARED/ACTIVE enters Browser', () => {
  assert.deepEqual(BROWSER_ELIGIBLE_ORDER_STATUSES, ['RECHARGE_PROCESSING']);
  assert.deepEqual(BROWSER_ELIGIBLE_ATTEMPT_STATUSES, ['PREPARED']);
  assert.deepEqual(BROWSER_ELIGIBLE_FUNDS_RISK_STATES, ['ACTIVE']);
  for (const status of ['CARD_READY', 'RECONCILIATION_REQUIRED', 'SUBMIT_UNKNOWN']) {
    assert.throws(() => projectSharedBrowserJob(projection({
      order: { ...projection().order, status },
    })), ContractError);
  }
  for (const status of ['PENDING', 'OBSERVING', 'SUBMITTING', 'CLEARED']) {
    assert.throws(() => projectSharedBrowserJob(projection({
      attempt: { ...projection().attempt, status },
    })), ContractError);
  }
  assert.throws(() => projectSharedBrowserJob(projection({
    attempt: { ...projection().attempt, fundsRiskState: 'CLEARED' },
  })), ContractError);
});

test('retired fundsGate, independent auditRef, projection Session and credentials are rejected', () => {
  assert.throws(() => projectSharedBrowserJob(projection({ fundsGate: { status: 'NOT_REQUESTED' } })), /retired/);
  assert.throws(() => projectSharedBrowserJob(projection({ auditRef: 'audit-0001' })), /auditRef/);
  assert.throws(() => projectSharedBrowserJob(projection({ sessionRef: 'session-0001' })), /controlled runtime context/);
  assert.throws(() => projectSharedBrowserJob(projection({ session_ciphertext: 'ciphertext' })), ContractError);
  assert.throws(() => projectSharedBrowserJob(projection({ card: { ...projection().card, card_credentials_ciphertext: 'x' } })), ContractError);
});

test('shared card consumption reservation must remain RESERVED and bound to the same attempt', () => {
  assert.throws(() => projectSharedBrowserJob(projection({ cardConsumption: null })), ContractError);
  assert.throws(() => projectSharedBrowserJob(projection({
    cardConsumption: { ...projection().cardConsumption, status: 'RELEASED' },
  })), ContractError);
  assert.throws(() => projectSharedBrowserJob(projection({
    cardConsumption: { ...projection().cardConsumption, attemptId: 'att-other' },
  })), ContractError);
});

test('attempt executor profile must remain bound to the Browser run profile', () => {
  assert.throws(() => projectSharedBrowserJob(projection({
    attempt: { ...projection().attempt, executorProfileId: 'prof-other' },
  })), /executorProfileId must match/);
});

test('browser_run.id is the execution/audit reference and unsafe payment states are rejected', () => {
  const running = projectSharedBrowserJob(projection({
    run: { id: 'run-0001', attemptId: 'att-0001', status: 'RUNNING', paymentState: 'NOT_STARTED' },
  }));
  assert.equal(running.state, 'RUNNING');
  assert.equal(running.metadata.browserRunRef, 'run:run-0001');
  assert.throws(() => projectSharedBrowserJob(projection({
    run: { id: 'run-0001', attemptId: 'att-0001', status: 'RUNNING', paymentState: 'PAYMENT_SUBMITTING' },
  })), ContractError);
});
