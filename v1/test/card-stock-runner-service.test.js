import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleAutomaticStockJob } from '../src/services/card-stock-runner-service.js';

test('idle automatic stock check does not refresh Provider snapshot', async () => {
  let refreshes = 0;
  const result = await scheduleAutomaticStockJob({
    stockJobs: { async scheduleAutomaticJob() { return { scheduled: false, reason: 'NO_DEMAND' }; } },
    async refreshSnapshot() { refreshes += 1; }
  });
  assert.deepEqual(result, {
    automatic: { scheduled: false, reason: 'NO_DEMAND' }, providerRulesSynced: false
  });
  assert.equal(refreshes, 0);
});

test('real demand refreshes stale Provider rules once and retries scheduling', async () => {
  let schedules = 0;
  let refreshes = 0;
  const result = await scheduleAutomaticStockJob({
    stockJobs: { async scheduleAutomaticJob() {
      schedules += 1;
      if (schedules === 1) throw Object.assign(new Error('stale'), { code: 'CARD_STOCK_RULES_STALE' });
      return { scheduled: true, id: 'job-1' };
    } },
    async refreshSnapshot() { refreshes += 1; }
  });
  assert.deepEqual(result, {
    automatic: { scheduled: true, id: 'job-1' }, providerRulesSynced: true
  });
  assert.equal(schedules, 2);
  assert.equal(refreshes, 1);
});

test('non-staleness scheduling errors are not hidden or retried', async () => {
  let refreshes = 0;
  await assert.rejects(scheduleAutomaticStockJob({
    stockJobs: { async scheduleAutomaticJob() {
      throw Object.assign(new Error('catalog unresolved'), { code: 'CARD_CATALOG_UNRESOLVED' });
    } },
    async refreshSnapshot() { refreshes += 1; }
  }), (error) => error.code === 'CARD_CATALOG_UNRESOLVED');
  assert.equal(refreshes, 0);
});
