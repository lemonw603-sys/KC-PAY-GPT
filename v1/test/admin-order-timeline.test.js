import assert from 'node:assert/strict';
import test from 'node:test';
import { mapBrowserTimelineRow } from '../src/services/admin-read-service.js';

test('browser timeline rows map to operator events with digests and counts only', () => {
  const row = { job_id: 'brjob:order-1:attempt-1', browser_run_id: 'run-1', sequence_no: 6, event_type: 'checkpoint', action: 'checkout-navigation',
    summary_json: JSON.stringify({ action: 'checkout-navigation', plan: 'plus', checkoutCreated: true, checkoutUrlDigest: 'a'.repeat(64), submitCalls: 0 }),
    worker_id: 'pool:lane-3', created_at: new Date('2026-09-07T09:34:00.000Z') };
  assert.deepEqual(mapBrowserTimelineRow(row), {
    at: '2026-09-07T09:34:00.000Z', sequence: 6, type: 'checkpoint', action: 'checkout-navigation', jobKind: 'run', runId: 'run-1', workerId: 'pool:lane-3',
    facts: { plan: 'plus', checkoutCreated: true, checkoutUrlDigest: 'a'.repeat(64), submitCalls: 0 },
  });
  assert.equal(mapBrowserTimelineRow({ job_id: 'brpreflight:order-1:83', summary_json: '{bad', event_type: 'freeze' }).jobKind, 'preflight');
  assert.deepEqual(mapBrowserTimelineRow({ job_id: 'x', summary_json: null, event_type: 'intent' }).facts, {});
});
