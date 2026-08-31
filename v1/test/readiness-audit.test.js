import assert from 'node:assert/strict';
import test from 'node:test';
import { runReadinessAudit } from '../src/diagnostics/readiness-audit.js';

function fakePool({
  counts = {}, heartbeat = '2026-08-21T00:00:00.000Z',
  migration = '026_automatic_fulfillment_funds_fence', dispatchMode = 'AUTOMATIC',
  acceptNewOrders = false, dispatchNewRecharges = false, rechargeWritesEnabled = true,
  executorKind = 'API'
} = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: String(acceptNewOrders) },
        { setting_key: 'dispatch_new_recharges', setting_value: String(dispatchNewRecharges) },
        { setting_key: 'recharge_dispatch_mode', setting_value: dispatchMode },
        { setting_key: 'worker_heartbeat_at', setting_value: heartbeat },
        { setting_key: 'worker_recharge_writes_enabled', setting_value: String(rechargeWritesEnabled) }
      ]];
      if (sql.includes('FROM fulfillment_routes')) return executorKind ? [[{ executor_kind: executorKind }]] : [[]];
      if (sql.includes('FROM schema_migrations')) return [[{ version: migration }]];
      const match = [
        ['FROM tasks WHERE status IN', 'activeTasks'],
        ["status = 'RUNNING'", 'expiredLeases'],
        ["operation = 'create_direct' AND recharge_attempt_id IS NULL", 'orphanRechargeCreateCalls'],
        ['rat.submit_intent_at IS NOT NULL', 'rechargeAttemptsWithoutCreateIntent'],
        [') duplicate_create_intents', 'duplicateRechargeCreateIntents'],
        ['FROM provider_calls', 'uncertainProviderCalls'],
        ['FROM recharge_authorizations', 'activeRechargeAuthorizations'],
        ['FROM recharge_attempts', 'activeOrUnknownFundsRisk'],
        ['FROM card_stock_jobs', 'activeCardStockJobs'],
        ['FROM reconciliation_cases', 'openReconciliationCases'],
        ['FROM alert_notifications', 'deadBarkNotifications'],
        ['information_schema.COLUMNS', 'rechargeCreateFenceColumns'],
        ['information_schema.STATISTICS', 'rechargeCreateFenceIndexes']
      ].find(([needle]) => sql.includes(needle));
      const key = match?.[1];
      const defaultCount = ['rechargeCreateFenceColumns', 'rechargeCreateFenceIndexes'].includes(key) ? 1 : 0;
      return [[{ count: counts[key] ?? defaultCount }]];
    }
  };
}

test('readiness audit is read-only and passes a clean current baseline', async () => {
  const report = await runReadinessAudit(fakePool(), {
    now: new Date('2026-08-21T00:01:00.000Z')
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'read-only');
  assert.deepEqual(report.blockers, []);
  assert.equal(report.workerHeartbeatAgeSeconds, 60);
});

test('readiness audit names decisive blockers without exposing row data', async () => {
  const report = await runReadinessAudit(fakePool({
    counts: { uncertainProviderCalls: 1, activeOrUnknownFundsRisk: 2 },
    heartbeat: '2026-08-20T23:00:00.000Z',
    migration: '022_foundation_v2_operations'
  }), { now: new Date('2026-08-21T00:01:00.000Z') });
  assert.equal(report.ok, false);
  assert.deepEqual(report.blockers, [
    'uncertain_provider_calls',
    'active_or_unknown_funds_risk',
    'worker_heartbeat_stale',
    'schema_not_current'
  ]);
  assert.equal(JSON.stringify(report).includes('session'), false);
});

test('readiness audit accepts later migrations after Stage 3 funds schema is present', async () => {
  const report = await runReadinessAudit(fakePool({ migration: '027_future_operations' }), {
    now: new Date('2026-08-21T00:01:00.000Z')
  });
  assert.equal(report.blockers.includes('schema_not_current'), false);
  assert.equal(report.latestMigrationNumber, 27);
});

test('readiness audit catches an open API business with payment execution disabled', async () => {
  const report = await runReadinessAudit(fakePool({
    acceptNewOrders: true,
    dispatchNewRecharges: true,
    rechargeWritesEnabled: false
  }), { now: new Date('2026-08-21T00:01:00.000Z') });
  assert.equal(report.ok, false);
  assert.equal(report.settings.selectedExecutorKind, 'API');
  assert.equal(report.settings.apiRechargeExecutionEnabled, false);
  assert.deepEqual(report.blockers, ['api_recharge_execution_disabled']);
});

test('readiness audit does not allow open business without a selected route', async () => {
  const report = await runReadinessAudit(fakePool({
    acceptNewOrders: true,
    dispatchNewRecharges: true,
    executorKind: null
  }), { now: new Date('2026-08-21T00:01:00.000Z') });
  assert.deepEqual(report.blockers, ['fulfillment_route_unavailable']);
});

test('readiness rejects missing Stage 3 schema artifacts and an invalid dispatch mode', async () => {
  const report = await runReadinessAudit(fakePool({
    migration: '025_session_recovery_and_finalization',
    dispatchMode: 'BROKEN',
    counts: { rechargeCreateFenceColumns: 0, rechargeCreateFenceIndexes: 0 }
  }), { now: new Date('2026-08-21T00:01:00.000Z') });
  assert.deepEqual(report.blockers, [
    'recharge_dispatch_mode_invalid',
    'schema_not_current'
  ]);
});

test('readiness audit blocks a broken attempt-to-create-intent ledger', async () => {
  const report = await runReadinessAudit(fakePool({
    counts: {
      orphanRechargeCreateCalls: 1,
      rechargeAttemptsWithoutCreateIntent: 2,
      duplicateRechargeCreateIntents: 1
    }
  }), { now: new Date('2026-08-21T00:01:00.000Z') });
  assert.deepEqual(report.blockers, [
    'orphan_recharge_create_calls',
    'recharge_attempts_without_create_intent',
    'duplicate_recharge_create_intents'
  ]);
});

test('readiness audits API create intents without treating Browser payment attempts as ZZSHU calls', async () => {
  const observed = [];
  const pool = fakePool();
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    observed.push(sql);
    return originalQuery(sql);
  };
  await runReadinessAudit(pool, { now: new Date('2026-08-21T00:01:00.000Z') });
  const attemptQuery = observed.find((sql) => sql.includes('rat.submit_intent_at IS NOT NULL'));
  assert.match(attemptQuery, /rat\.executor_kind = 'API'/);
});
