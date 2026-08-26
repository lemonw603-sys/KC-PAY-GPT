import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ChromeExtensionSessionRuntimeAdapter, extensionIdFromPath } from '../src/extension-session-runtime.js';
import { InMemoryCardMaterialLeaseProvider } from '../src/card-material-lease.js';
import { DurableCardMaterialLeaseProvider } from '../src/durable-card-material-lease.js';
import { PaymentSafetyGate } from '../src/payment-safety-gate.js';
import { DurablePaymentSafetyGate } from '../src/durable-payment-safety-gate.js';
import { AppendOnlyWal } from '../src/wal.js';
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
  const validated = await adapter.validateExtension();
  assert.equal(validated.name, 'fixture');
  assert.equal(validated.version, '1');
  assert.equal(validated.popup, 'popup.html');
  assert.match(validated.extensionId, /^[a-p]{32}$/);
  assert.equal(validated.extensionId, extensionIdFromPath(await realpath(extensionPath)));
  await adapter.close(runtime);
});

test('extension lane fails closed when Chrome did not actually load the popup', async () => {
  const adapter = Object.create(ChromeExtensionSessionRuntimeAdapter.prototype);
  adapter.validateExtension = async () => ({ extensionId: 'a'.repeat(32), popup: 'popup.html' });
  const popup = {
    goto: async () => { throw new Error('net::ERR_BLOCKED_BY_CLIENT'); },
    close: async () => undefined,
  };
  const runtime = { context: { serviceWorkers: () => [], newPage: async () => popup } };
  await assert.rejects(() => adapter.verifyLoaded(runtime), /extension is not loaded/);
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

test('durable payment gate restores UNKNOWN after a fresh process', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'browser-mvp-durable-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const wal = await new AppendOnlyWal({ filePath: join(root, 'payments.wal') }).init();
  await wal.append({ jobId: 'brjob:prior-event', type: 'intent', sequence: 1, payloadDigest: '0'.repeat(64), summary: { action: 'prior' } });
  const first = await new DurablePaymentSafetyGate({ wal, filePath: join(root, 'gate.json') }).init();
  const permit = await first.prepare({ orderRef: 'order:durable', attemptRef: 'attempt:durable', cardRef: 'card:durable' });
  await first.markSubmitted(permit, 'provider-call:durable');
  await first.markUnknown(permit, 'worker-crash');
  const second = await new DurablePaymentSafetyGate({ wal, filePath: join(root, 'gate.json') }).init();
  assert.equal(second.canSubmit({ orderRef: 'order:durable', cardRef: 'card:durable' }), false);
  assert.equal(second.snapshot().attempts[0].state, 'UNKNOWN');
  const concurrent = await Promise.allSettled([
    second.prepare({ orderRef: 'order:concurrent', attemptRef: 'attempt:concurrent', cardRef: 'card:concurrent' }),
    second.prepare({ orderRef: 'order:concurrent', attemptRef: 'attempt:concurrent', cardRef: 'card:concurrent' }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
});

test('durable card lease requires recovery after a process restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'browser-mvp-durable-card-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = { load: async () => ({ pan: '4111111111111111', expMonth: '12', expYear: '2030', cvc: '123' }) };
  const first = await new DurableCardMaterialLeaseProvider({ source, filePath: join(root, 'leases.json') }).init();
  const lease = await first.open('card:durable', { ttlMs: 2_000 });
  assert.equal(await first.withMaterial(lease, (material) => material.expYear), '2030');
  const second = await new DurableCardMaterialLeaseProvider({ source, filePath: join(root, 'leases.json') }).init();
  await assert.rejects(() => second.withMaterial(lease, () => undefined), ContractError);
  await second.recover(lease.leaseId, 'release');
  const replacement = await second.open('card:durable');
  assert.equal(replacement.cardRef, 'card:durable');
  const concurrent = await Promise.allSettled([second.open('card:concurrent'), second.open('card:concurrent')]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
});
