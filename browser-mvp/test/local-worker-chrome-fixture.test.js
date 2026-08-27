import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { createBrowserWorkerProcess } from '../../v1/src/services/browser-worker-process.js';
import { GoogleChromeControlRuntimeAdapter } from '../src/chrome-control-runtime.js';
import { createChromeControlManifest } from '../src/fixtures.js';

test('local Worker process opens Google Chrome fixture and completes without payment', async (t) => {
  const profilesRoot = await mkdtemp(join(tmpdir(), 'browser-mvp-worker-chrome-'));
  t.after(() => rm(profilesRoot, { recursive: true, force: true }));

  const workerId = 'local-worker-chrome-fixture';
  let claimCount = 0;
  let completeCount = 0;
  let observed = false;
  const claimedJob = {
    jobId: 'fixture-job-1',
    jobKey: 'fixture-job-key-1',
    status: 'CLAIMED',
    leaseOwner: workerId,
    leaseToken: 'fixture-lease-token',
  };
  const workerService = {
    async claim() {
      claimCount += 1;
      return claimCount === 1 ? claimedJob : null;
    },
    async runClaimedJob() {
      return {
        run: { runId: 'fixture-run-1' },
        async complete() {
          completeCount += 1;
          return { status: 'COMPLETED' };
        },
        stop() {},
      };
    },
  };
  const runtimeAdapter = new GoogleChromeControlRuntimeAdapter({
    browserType: chromium,
    profilesRoot,
    launchOptions: { headless: true },
  });
  const manifest = createChromeControlManifest();
  const process = createBrowserWorkerProcess({
    workerService,
    workerId,
    runtimeMode: 'LOCAL_MOCK',
    runtime: { mode: 'LOCAL_MOCK' },
    executeJob: async (control) => {
      assert.equal(control.run.runId, 'fixture-run-1');
      const runtime = await runtimeAdapter.open(manifest, { profileRef: 'profile:worker-chrome-fixture' });
      try {
        const page = await runtime.context.newPage();
        await page.goto('data:text/html,<title>Worker Chrome fixture</title><main data-worker-fixture>ok</main>');
        assert.equal(await page.title(), 'Worker Chrome fixture');
        assert.equal(await page.locator('[data-worker-fixture]').textContent(), 'ok');
        observed = true;
      } finally {
        await runtimeAdapter.close(runtime);
      }
      await control.complete();
      return { submitCalls: 0, browser: 'GOOGLE_CHROME_FIXTURE' };
    },
    leaseSeconds: 30,
  });

  const [result] = await process.run({ iterations: 1 });
  assert.equal(result.status, 'EXECUTED');
  assert.equal(observed, true);
  assert.equal(completeCount, 1);
});
