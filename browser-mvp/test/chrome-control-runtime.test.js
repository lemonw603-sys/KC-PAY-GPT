import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { GoogleChromeControlRuntimeAdapter } from '../src/chrome-control-runtime.js';
import { ContractError } from '../src/contracts.js';
import { createChromeControlManifest } from '../src/fixtures.js';

test('Google Chrome control lane opens a dedicated persistent profile and closes it', async (t) => {
  const profilesRoot = await mkdtemp(join(tmpdir(), 'browser-mvp-chrome-'));
  t.after(() => rm(profilesRoot, { recursive: true, force: true }));
  const runtimeAdapter = new GoogleChromeControlRuntimeAdapter({
    browserType: chromium,
    profilesRoot,
    launchOptions: { headless: true },
  });
  const runtime = await runtimeAdapter.open(createChromeControlManifest(), { profileRef: 'profile:chrome-smoke' });
  try {
    const page = await runtime.context.newPage();
    await page.goto('data:text/html,<title>Chrome control</title><main>ok</main>');
    assert.equal(await page.title(), 'Chrome control');
    assert.match(runtime.userDataDir, /[a-f0-9]{32}$/);
  } finally {
    await runtimeAdapter.close(runtime);
  }
});

test('Google Chrome control lane rejects write-enabled manifests', async () => {
  const runtimeAdapter = new GoogleChromeControlRuntimeAdapter({
    browserType: chromium,
    profilesRoot: join(tmpdir(), 'browser-mvp-invalid'),
  });
  await assert.rejects(
    () => runtimeAdapter.open({ ...createChromeControlManifest(), allowWrites: true }, { profileRef: 'profile:write' }),
    ContractError,
  );
});
