import { createHash } from 'node:crypto';
import { assertJobEnvelope } from './contracts.js';

function digest(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function createSyntheticManifest(overrides = {}) {
  const manifest = {
    mode: 'LOCAL_MOCK',
    capability: 'NON_PH_FUNCTIONAL',
    profileDigest: digest('browser-mvp:synth:profile:v1'),
    networkDigest: digest('browser-mvp:synth:network:offline:v1'),
    allowWrites: false,
    ...overrides,
  };
  return manifest;
}

export function createSyntheticJob(overrides = {}) {
  const job = {
    schemaVersion: 1,
    jobId: 'brjob:synth:0001',
    orderRef: 'order:synth:0001',
    attemptRef: 'attempt:synth:0001',
    profileRef: 'profile:synth:0001',
    state: 'QUEUED',
    manifest: createSyntheticManifest(),
    metadata: {
      source: 'contract-test',
      requestedCurrency: 'USD',
      requestedAmountMinor: 2000,
    },
    ...overrides,
  };
  assertJobEnvelope(job);
  return job;
}

export function createSyntheticEvidence(job = createSyntheticJob()) {
  return {
    jobId: job.jobId,
    type: 'intent',
    sequence: 1,
    payloadDigest: digest(`${job.jobId}:intent`),
    summary: {
      mode: job.manifest.mode,
      capability: job.manifest.capability,
      action: 'observe-only',
    },
  };
}
