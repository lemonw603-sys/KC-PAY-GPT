import { assertJobEnvelope, assertRef, assertSafeObject, ContractError } from './contracts.js';
import { createSyntheticManifest } from './fixtures.js';

/**
 * The adapter consumes a deliberately normalized, read-only projection. It is
 * not a repository and has no persistence/write method. A future MySQL adapter
 * must produce this projection without passing credentials into Browser.
 */
export const BROWSER_ELIGIBLE_ORDER_STATUSES = Object.freeze([
  'CARD_READY',
  'RECONCILIATION_REQUIRED',
]);

export const BROWSER_ELIGIBLE_ATTEMPT_STATUSES = Object.freeze(['PENDING', 'OBSERVING']);

const FORBIDDEN_SOURCE_KEYS = new Set([
  'session_ciphertext',
  'sessionToken',
  'accessToken',
  'card_credentials_ciphertext',
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'checkoutAuthority',
  'apiKey',
  'secret',
]);

function rejectForbiddenKeys(value, path = 'projection', seen = new Set()) {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (seen.has(value)) throw new ContractError(`${path} must not be cyclic`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SOURCE_KEYS.has(key)) throw new ContractError(`${path}.${key} cannot cross Browser boundary`);
    rejectForbiddenKeys(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function requireRef(value, label) {
  return assertRef(String(value ?? ''), label);
}

function assertFundsGate(funds) {
  if (funds == null) return { status: 'NOT_REQUESTED' };
  if (!funds || typeof funds !== 'object' || Array.isArray(funds)) throw new ContractError('fundsGate must be an object');
  if (funds.status !== 'NOT_REQUESTED') throw new ContractError('Browser MVP cannot consume an active funds permit');
  assertSafeObject(funds, 'fundsGate');
  return { status: 'NOT_REQUESTED' };
}

export function projectSharedBrowserJob(projection, { manifest = createSyntheticManifest() } = {}) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) throw new ContractError('shared projection must be an object');
  rejectForbiddenKeys(projection);
  const orderStatus = projection.order?.status;
  const attemptStatus = projection.attempt?.status;
  if (!BROWSER_ELIGIBLE_ORDER_STATUSES.includes(orderStatus)) {
    throw new ContractError(`order.status ${orderStatus} is not eligible for Browser read-only observation`);
  }
  if (!BROWSER_ELIGIBLE_ATTEMPT_STATUSES.includes(attemptStatus)) {
    throw new ContractError(`attempt.status ${attemptStatus} is not eligible for Browser observation`);
  }
  const fundsGate = assertFundsGate(projection.fundsGate);
  const job = {
    schemaVersion: 1,
    jobId: `brjob:${requireRef(projection.order.id, 'order.id')}:${requireRef(projection.attempt.id, 'attempt.id')}`,
    orderRef: `order:${requireRef(projection.order.id, 'order.id')}`,
    attemptRef: `attempt:${requireRef(projection.attempt.id, 'attempt.id')}`,
    profileRef: `profile:${requireRef(projection.profile.id, 'profile.id')}`,
    state: 'QUEUED',
    manifest,
    metadata: {
      source: 'shared-contract-read-only',
      orderStatus,
      attemptStatus,
      fundsGate,
      auditRef: projection.auditRef == null ? null : requireRef(projection.auditRef, 'auditRef'),
    },
  };
  assertJobEnvelope(job);
  return job;
}

export class ReadOnlySharedContractAdapter {
  project(projection, options) {
    return projectSharedBrowserJob(projection, options);
  }
}
