import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ChromeExtensionSessionRuntimeAdapter } from '../src/extension-session-runtime.js';
import { InMemoryCardMaterialLeaseProvider } from '../src/card-material-lease.js';
import { PaymentSafetyGate } from '../src/payment-safety-gate.js';
import { ContractError } from '../src/contracts.js';
import { createChromeControlManifest } from '../src/fixtures.js';

test('extension lane validates MV3 and adds load-extension flags without exposing input', async (t) => {
  const extensionPath = await mkdtemp(join(tmpdir(), 'browser-mvp-ext-'));
  t.after(() => rm(extensionPath, { recursive: true, force: true }));
  await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'fixture', version: '1', action: { default_popup: 'popup.html' } }));
  await writeFile(join(extensionPath, 'popup.html'), '<button id="loginButton">ok</button>');
  const calls = [];
  const context = { close: async () => undefined };
  const adapter = new ChromeExtensionSessionRuntimeAdapter({
    extensionPath,
    profilesRoot: join(extensionPath, 'profiles'),
    browserType: { launchPersistentContext: async (_dir, options) => { calls.push(options); return context; } },
  });
  const runtime = await adapter.open(createChromeControlManifest(), { profileRef: 'profile:extension' });
  assert.ok(calls[0].args.some((arg) => arg === `--load-extension=${extensionPath}`));
  assert.equal(calls[0].headless, false);
  assert.deepEqual(await adapter.validateExtension(), { name: 'fixture', version: '1', popup: 'popup.html' });
  await adapter.close(runtime);
});

test('card material is only available inside a short lease callback', async () => {
  let now = 10_000;
  const provider = new InMemoryCardMaterialLeaseProvider({
    clock: () => now,
    source: { load: async () => ({ pan: '4111111111111111', expMonth: '12', expYear: '2030', cvc: '123' }) },
  });
  const lease = await provider.open('card:one', { ttlMs: 2_000 });
  assert.equal(Object.hasOwn(lease, 'pan'), false);
  assert.equal(await provider.withMaterial(lease, (material) => material.pan), '4111111111111111');
  now += 2_001;
  await assert.rejects(() => provider.withMaterial(lease, () => undefined), ContractError);
  await assert.rejects(() => provider.withMaterial({ ...lease, cardRef: 'card:other' }, () => undefined), ContractError);
});

test('UNKNOWN locks an order/card and stop switches block new permits', () => {
  const gate = new PaymentSafetyGate();
  const permit = gate.prepare({ orderRef: 'order:one', attemptRef: 'attempt:one', cardRef: 'card:one' });
  assert.throws(() => gate.prepare({ orderRef: 'order:one', attemptRef: 'attempt:one', cardRef: 'card:one' }), ContractError);
  gate.markSubmitted(permit, 'provider-call:one');
  gate.markUnknown(permit);
  assert.equal(gate.canSubmit({ orderRef: 'order:one', cardRef: 'card:one' }), false);
  assert.throws(() => gate.prepare({ orderRef: 'order:one', attemptRef: 'attempt:two', cardRef: 'card:one' }), ContractError);
  gate.reconcileUnknown(permit, 'FAILED');
  assert.equal(gate.canSubmit({ orderRef: 'order:one', cardRef: 'card:one' }), true);
  const cardLocked = gate.prepare({ orderRef: 'order:two', attemptRef: 'attempt:two', cardRef: 'card:one' });
  gate.markUnknown(cardLocked);
  assert.equal(gate.canSubmit({ orderRef: 'order:three', cardRef: 'card:one' }), false);
  gate.stop('global');
  assert.equal(gate.canSubmit({ orderRef: 'order:two', cardRef: 'card:two' }), false);
  gate.resume('global');
  assert.equal(gate.canSubmit({ orderRef: 'order:four', cardRef: 'card:two' }), true);
  assert.deepEqual(gate.stopOnFundsDifference({ expectedMinor: 2000, actualMinor: 1999 }), { stopped: true, differenceMinor: -1 });
  assert.equal(gate.canSubmit({ orderRef: 'order:three', cardRef: 'card:three' }), false);
});
