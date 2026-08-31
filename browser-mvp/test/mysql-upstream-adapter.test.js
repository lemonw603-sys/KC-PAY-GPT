import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_UPSTREAM_PROJECTION_SQL,
  createMysqlUpstreamProjectionAdapter,
  rowToProjection,
} from '../src/mysql-upstream-adapter.js';
import { ContractError } from '../src/contracts.js';

function row(overrides = {}) {
  return {
    run_id: 'run-mysql-0001',
    run_status: 'RUNNING',
    payment_state: 'NOT_STARTED',
    profile_id: 'prof-mysql-0001',
    order_id: 'ord-mysql-0001',
    order_status: 'RECHARGE_PROCESSING',
    order_fulfillment_route_id: 'route-mysql-0001',
    order_assigned_card_id: 'card-mysql-0001',
    attempt_id: 'att-mysql-0001',
    attempt_status: 'PREPARED',
    funds_risk_state: 'ACTIVE',
    attempt_executor_kind: 'BROWSER',
    attempt_profile_id: 'prof-mysql-0001',
    attempt_fulfillment_route_id: 'route-mysql-0001',
    card_id: 'card-mysql-0001',
    card_order_id: 'ord-mysql-0001',
    provider_card_ref: 'provider-card-mysql-0001',
    card_provider_account_id: 'provider-account-mysql-0001',
    card_consumption_id: 'consumption-mysql-0001',
    card_consumption_status: 'RESERVED',
    card_consumption_attempt_id: 'att-mysql-0001',
    card_consumption_order_id: 'ord-mysql-0001',
    card_consumption_card_id: 'card-mysql-0001',
    route_id: 'route-mysql-0001',
    route_executor_kind: 'BROWSER',
    route_card_provider_account_id: 'provider-account-mysql-0001',
    ...overrides,
  };
}

test('MySQL adapter reads one formal browser_run and returns a run-bound Browser job', async () => {
  const calls = [];
  const db = { execute: async (sql, params) => { calls.push({ sql, params }); return [[row()], []]; } };
  const adapter = createMysqlUpstreamProjectionAdapter({ db });
  const result = await adapter.load({ runId: 'run-mysql-0001', sessionRef: 'session-runtime-0001' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['run-mysql-0001']);
  assert.match(calls[0].sql, /FROM browser_runs br/);
  assert.doesNotMatch(calls[0].sql, /browser_upstream_ready_projection/);
  assert.doesNotMatch(calls[0].sql, /SELECT\s+\*/i);
  assert.doesNotMatch(calls[0].sql, /session_ciphertext|card_credentials_ciphertext|audit_ref/i);
  assert.equal(result.job.state, 'RUNNING');
  assert.equal(result.job.metadata.browserRunRef, 'run:run-mysql-0001');
  assert.equal(result.job.metadata.upstream.cardId, 'card-mysql-0001');
  assert.equal(result.job.metadata.upstream.providerCardRef, 'provider-card-mysql-0001');
  assert.equal(result.job.metadata.upstream.cardConsumptionId, 'consumption-mysql-0001');
  assert.equal(result.job.metadata.sessionRef, 'session-runtime-0001');
  assert.equal(result.sourceDigest.length, 64);
});

test('MySQL adapter binds a reused card through orders.assigned_card_id and the consumption reservation', async () => {
  const adapter = createMysqlUpstreamProjectionAdapter({
    db: { query: async () => [[row({ card_order_id: 'original-order-0001' })], []] },
  });
  const result = await adapter.load({ runId: 'run-mysql-0001' });
  assert.equal(result.job.metadata.upstream.orderId, 'ord-mysql-0001');
  assert.equal(result.job.metadata.upstream.cardId, 'card-mysql-0001');
});

test('adapter rejects missing or ambiguous run rows', async () => {
  for (const rows of [[], [row(), row({ run_id: 'run-mysql-0001b' })]]) {
    const adapter = createMysqlUpstreamProjectionAdapter({ db: { query: async () => [rows, []] } });
    await assert.rejects(() => adapter.load({ runId: 'run-mysql-0001' }), /runtime (not found|is ambiguous)/);
  }
});

test('row mapper rejects sensitive and retired projection columns', () => {
  for (const key of ['card_credentials_ciphertext', 'session_ciphertext', 'session_ref', 'audit_ref']) {
    assert.throws(() => rowToProjection({ ...row(), [key]: 'must-not-be-read' }), /forbidden/);
  }
  assert.throws(() => createMysqlUpstreamProjectionAdapter({ db: {} }), TypeError);
  assert.match(BROWSER_UPSTREAM_PROJECTION_SQL, /WHERE br\.id = \?/);
});

test('formal state, route and Provider drift fail closed without reinterpretation', async () => {
  for (const changed of [
    { order_status: 'RECONCILIATION_REQUIRED' },
    { attempt_status: 'OBSERVING' },
    { funds_risk_state: 'CLEARED' },
    { route_executor_kind: 'API' },
    { route_card_provider_account_id: 'provider-account-other' },
    { payment_state: 'PAYMENT_SUBMITTING' },
    { card_consumption_status: 'RELEASED' },
    { card_consumption_attempt_id: 'att-mysql-other' },
    { order_assigned_card_id: 'card-mysql-other' },
    { attempt_profile_id: 'prof-mysql-other' },
  ]) {
    const adapter = createMysqlUpstreamProjectionAdapter({ db: { query: async () => [[row(changed)], []] } });
    await assert.rejects(() => adapter.load({ runId: 'run-mysql-0001' }), ContractError);
  }
});
