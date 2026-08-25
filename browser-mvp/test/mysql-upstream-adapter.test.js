import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_UPSTREAM_PROJECTION_SQL,
  createMysqlUpstreamProjectionAdapter,
  rowToProjection,
} from '../src/mysql-upstream-adapter.js';
import { ContractError } from '../src/contracts.js';

const now = Date.parse('2026-08-26T00:00:00.000Z');

function row(overrides = {}) {
  return {
    order_id: 'ord-mysql-0001',
    order_status: 'CARD_READY',
    attempt_id: 'att-mysql-0001',
    attempt_status: 'PENDING',
    profile_id: 'prof-mysql-0001',
    card_ref: 'card:inventory:0001',
    card_route_ref: 'route:browser:0001',
    card_provider_account_ref: 'provider-account:hnskj:0001',
    card_inventory_status: 'AVAILABLE',
    card_readiness_status: 'READY',
    card_readiness_digest: 'a'.repeat(64),
    card_readiness_observed_at: new Date(now - 1000),
    card_readiness_valid_until: new Date(now + 60_000),
    route_ref: 'route:browser:0001',
    route_card_provider_ref: 'provider-account:hnskj:0001',
    route_executor_kind: 'BROWSER',
    route_status: 'ACTIVE',
    session_ref: 'session-ref:mysql-0001',
    audit_ref: 'audit:mysql-0001',
    ...overrides,
  };
}

test('MySQL adapter performs one parameterized read and returns an opaque Browser job', async () => {
  const calls = [];
  const db = { execute: async (sql, params) => {
    calls.push({ sql, params });
    return [[row()], []];
  } };
  const adapter = createMysqlUpstreamProjectionAdapter({ db });
  const result = await adapter.load({ attemptId: 'att-mysql-0001', now });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['att-mysql-0001']);
  assert.match(calls[0].sql, /FROM browser_upstream_ready_projection/);
  assert.doesNotMatch(calls[0].sql, /SELECT\s+\*/i);
  assert.equal(result.job.metadata.upstream.cardRef, 'card:inventory:0001');
  assert.equal(result.job.metadata.sessionRef, 'session-ref:mysql-0001');
  assert.equal(result.projection.fundsGate.status, 'NOT_REQUESTED');
  assert.equal(result.sourceDigest.length, 64);
});

test('adapter rejects missing or ambiguous rows before Browser dispatch', async () => {
  for (const rows of [[], [row(), row({ attempt_id: 'att-mysql-0001b' })]]) {
    const adapter = createMysqlUpstreamProjectionAdapter({ db: { query: async () => [rows, []] } });
    await assert.rejects(() => adapter.load({ attemptId: 'att-mysql-0001', now }), /projection (not found|is ambiguous)/);
  }
});

test('row mapper and projection remain fail-closed for stale readiness and credential-shaped fields', async () => {
  const stale = createMysqlUpstreamProjectionAdapter({
    db: { query: async () => [[row({ card_readiness_valid_until: new Date(now - 1) })], []] },
  });
  await assert.rejects(() => stale.load({ attemptId: 'att-mysql-0001', now }), /.+/);
  assert.throws(() => rowToProjection({ ...row(), card_credentials_ciphertext: 'must-not-be-read' }), /.+/);
  assert.doesNotThrow(() => rowToProjection(row({ route_executor_kind: 'API' })));
  assert.throws(() => createMysqlUpstreamProjectionAdapter({ db: {} }), TypeError);
  assert.match(BROWSER_UPSTREAM_PROJECTION_SQL, /WHERE attempt_id = \?/);
});

test('adapter does not silently reinterpret PREPARED until shared mapping is frozen', async () => {
  const adapter = createMysqlUpstreamProjectionAdapter({ db: { query: async () => [[row({ attempt_status: 'PREPARED' }),], []] } });
  await assert.rejects(() => adapter.load({ attemptId: 'att-mysql-0001', now }), ContractError);
});
