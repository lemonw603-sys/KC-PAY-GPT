import assert from 'node:assert/strict';
import test from 'node:test';
import { runReadinessAudit } from '../src/diagnostics/readiness-audit.js';

function fakePool({ counts = {}, heartbeat = '2026-08-21T00:00:00.000Z', migration = '023_bark_notifications' } = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: 'false' },
        { setting_key: 'dispatch_new_recharges', setting_value: 'false' },
        { setting_key: 'worker_heartbeat_at', setting_value: heartbeat }
      ]];
      if (sql.includes('FROM schema_migrations')) return [[{ version: migration }]];
      const match = [
        ['FROM tasks WHERE status IN', 'activeTasks'],
        ["status = 'RUNNING'", 'expiredLeases'],
        ['FROM provider_calls', 'uncertainProviderCalls'],
        ['FROM recharge_authorizations', 'activeRechargeAuthorizations'],
        ['FROM recharge_attempts', 'activeOrUnknownFundsRisk'],
        ['FROM reconciliation_cases', 'openReconciliationCases'],
        ['FROM alert_notifications', 'deadBarkNotifications']
      ].find(([needle]) => sql.includes(needle));
      return [[{ count: counts[match?.[1]] || 0 }]];
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

test('readiness audit accepts later migrations after Bark schema is present', async () => {
  const report = await runReadinessAudit(fakePool({ migration: '024_future_operations' }), {
    now: new Date('2026-08-21T00:01:00.000Z')
  });
  assert.equal(report.blockers.includes('schema_not_current'), false);
  assert.equal(report.latestMigrationNumber, 24);
});
