const SENSITIVE_KEYS = new Set([
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'session',
  'sessionToken',
  'accessToken',
  'checkoutAuthority',
  'apiKey',
  'secret',
  'password',
]);

export const JOB_STATES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'FROZEN',
  'RECONCILE_ONLY',
  'COMPLETED',
]);

export const EXECUTION_MODES = Object.freeze(['LOCAL_MOCK', 'CHROME_CONTROL']);
export const CAPABILITIES = Object.freeze(['NON_PH_FUNCTIONAL', 'CHECKOUT_OBSERVE']);

export class ContractError extends TypeError {}

function fail(message) {
  throw new ContractError(message);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

export function assertSafeObject(value, label = 'value', seen = new Set()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') fail(`${label} has unsupported type`);
  if (seen.has(value)) fail(`${label} must not be cyclic`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertSafeObject(item, `${label}[${index}]`, seen));
  else {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) fail(`${label}.${key} is not accepted by Browser MVP`);
      assertSafeObject(child, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return value;
}

export function assertRef(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(value)) {
    fail(`${label} must be a non-empty opaque reference`);
  }
  return value;
}

export function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{16,128}$/i.test(value)) {
    fail(`${label} must be a lowercase hex digest`);
  }
  return value;
}

export function assertSessionLease(lease) {
  assertObject(lease, 'sessionLease');
  assertRef(lease.leaseId, 'sessionLease.leaseId');
  assertDigest(lease.sessionDigest, 'sessionLease.sessionDigest');
  if (!Number.isFinite(lease.expiresAt) || lease.expiresAt <= 0) fail('sessionLease.expiresAt must be a timestamp');
  if (Object.prototype.hasOwnProperty.call(lease, 'material') || Object.prototype.hasOwnProperty.call(lease, 'session')) {
    fail('session material must stay inside the SessionProvider/runtime boundary');
  }
  assertSafeObject(lease, 'sessionLease');
  return lease;
}

export function assertCohortManifest(manifest) {
  assertObject(manifest, 'manifest');
  if (!EXECUTION_MODES.includes(manifest.mode)) fail(`manifest.mode must be one of ${EXECUTION_MODES.join(', ')}`);
  if (!CAPABILITIES.includes(manifest.capability)) fail(`manifest.capability must be one of ${CAPABILITIES.join(', ')}`);
  assertDigest(manifest.profileDigest, 'manifest.profileDigest');
  assertDigest(manifest.networkDigest, 'manifest.networkDigest');
  if (manifest.allowWrites !== false) fail('manifest.allowWrites must be false for M0');
  assertSafeObject(manifest, 'manifest');
  return manifest;
}

export function assertJobEnvelope(job) {
  assertObject(job, 'job');
  assertRef(job.jobId, 'job.jobId');
  assertRef(job.orderRef, 'job.orderRef');
  assertRef(job.attemptRef, 'job.attemptRef');
  assertRef(job.profileRef, 'job.profileRef');
  if (!JOB_STATES.includes(job.state)) fail(`job.state must be one of ${JOB_STATES.join(', ')}`);
  if (!Number.isInteger(job.schemaVersion) || job.schemaVersion !== 1) fail('job.schemaVersion must be 1');
  assertCohortManifest(job.manifest);
  assertSafeObject(job.metadata ?? {}, 'job.metadata');
  return job;
}

export function assertEvidenceEvent(event) {
  assertObject(event, 'event');
  assertRef(event.jobId, 'event.jobId');
  if (!['intent', 'checkpoint', 'completion', 'freeze', 'recovery'].includes(event.type)) {
    fail('event.type is not supported');
  }
  if (!Number.isInteger(event.sequence) || event.sequence < 1) fail('event.sequence must be a positive integer');
  assertDigest(event.payloadDigest, 'event.payloadDigest');
  assertSafeObject(event.summary ?? {}, 'event.summary');
  return event;
}

export function hasSensitiveKey(value) {
  try {
    assertSafeObject(value);
    return false;
  } catch (error) {
    if (error instanceof ContractError) return true;
    throw error;
  }
}
