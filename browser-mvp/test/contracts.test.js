import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ContractError,
  assertCohortManifest,
  assertEvidenceEvent,
  assertJobEnvelope,
  hasSensitiveKey,
} from '../src/contracts.js';
import {
  BrowserExecutionPort,
  DispatchStore,
  EvidenceSink,
  PortNotImplementedError,
  RuntimeAdapter,
} from '../src/ports.js';
import { createSyntheticEvidence, createSyntheticJob, createSyntheticManifest } from '../src/fixtures.js';

test('synthetic fixture is a safe, non-payment job envelope', () => {
  const job = createSyntheticJob();
  assert.equal(job.manifest.mode, 'LOCAL_MOCK');
  assert.equal(job.manifest.capability, 'NON_PH_FUNCTIONAL');
  assert.equal(job.manifest.allowWrites, false);
  assert.doesNotThrow(() => assertJobEnvelope(job));
  assert.equal(hasSensitiveKey(job), false);
});

test('contract rejects sensitive credentials and payment authorities', () => {
  assert.throws(
    () => assertJobEnvelope(createSyntheticJob({ metadata: { sessionToken: 'redacted?' } })),
    ContractError,
  );
  assert.throws(
    () => assertCohortManifest(createSyntheticManifest({ allowWrites: true })),
    ContractError,
  );
  assert.equal(hasSensitiveKey({ nested: { cvv: '123' } }), true);
});

test('evidence event requires an opaque reference, digest and supported type', () => {
  const event = createSyntheticEvidence();
  assert.doesNotThrow(() => assertEvidenceEvent(event));
  assert.throws(() => assertEvidenceEvent({ ...event, type: 'payment' }), ContractError);
  assert.throws(() => assertEvidenceEvent({ ...event, payloadDigest: 'plain-text' }), ContractError);
});

test('all four ports expose explicit extension points and fail closed by default', async () => {
  const job = createSyntheticJob();
  const ports = [
    [new BrowserExecutionPort(), () => ports[0][0].execute(job, {})],
    [new DispatchStore(), () => ports[1][0].enqueue(job)],
    [new EvidenceSink(), () => ports[2][0].append(createSyntheticEvidence(job))],
    [new RuntimeAdapter(), () => ports[3][0].open(job.manifest)],
  ];
  for (const [, invoke] of ports) {
    await assert.rejects(invoke, PortNotImplementedError);
  }
});
