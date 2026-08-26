import { assertDigest, assertJobEnvelope, assertRef, assertSafeObject, ContractError } from './contracts.js';
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
export const BROWSER_ELIGIBLE_CARD_INVENTORY_STATUSES = Object.freeze(['AVAILABLE']);
export const BROWSER_ELIGIBLE_ROUTE_EXECUTOR_KINDS = Object.freeze(['BROWSER']);

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
      ...(projection.sessionRef == null ? {} : { sessionRef: requireRef(projection.sessionRef, 'sessionRef') }),
      auditRef: projection.auditRef == null ? null : requireRef(projection.auditRef, 'auditRef'),
    },
  };
  assertJobEnvelope(job);
  return job;
}

function projectUpstreamCard(projection, { now = Date.now() } = {}) {
  const card = projection.card;
  const route = projection.route;
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new ContractError('card projection is required');
  }
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    throw new ContractError('route projection is required');
  }
  const cardRef = requireRef(card.ref, 'card.ref');
  const providerAccountRef = requireRef(card.providerAccountRef, 'card.providerAccountRef');
  const routeRef = requireRef(route.ref, 'route.ref');
  if (card.routeRef !== route.ref) throw new ContractError('card.routeRef must match route.ref');
  if (route.cardProviderRef !== card.providerAccountRef) {
    throw new ContractError('route.cardProviderRef must match card.providerAccountRef');
  }
  if (!BROWSER_ELIGIBLE_CARD_INVENTORY_STATUSES.includes(card.inventoryStatus)) {
    throw new ContractError(`card.inventoryStatus ${card.inventoryStatus} is not Browser eligible`);
  }
  if (route.status !== 'ACTIVE') throw new ContractError('route.status must be ACTIVE');
  if (!BROWSER_ELIGIBLE_ROUTE_EXECUTOR_KINDS.includes(route.executorKind)) {
    throw new ContractError('route.executorKind must be BROWSER');
  }
  const readiness = card.readiness;
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness)) {
    throw new ContractError('card.readiness is required');
  }
  if (readiness.status !== 'READY') throw new ContractError('card.readiness.status must be READY');
  const evidenceDigest = assertDigest(readiness.evidenceDigest, 'card.readiness.evidenceDigest');
  if (!Number.isFinite(readiness.observedAt) || !Number.isFinite(readiness.validUntil)) {
    throw new ContractError('card readiness timestamps are required');
  }
  if (readiness.validUntil <= now || readiness.observedAt > now) {
    throw new ContractError('card readiness evidence is stale or from the future');
  }
  assertSafeObject({ card, route }, 'upstream card/route projection');
  return {
    cardRef,
    routeRef,
    providerAccountRef,
    ...(card.providerCardRef == null ? {} : { providerCardRef: requireRef(card.providerCardRef, 'card.providerCardRef') }),
    cardReadyEvidence: {
      digest: evidenceDigest,
      observedAt: readiness.observedAt,
      validUntil: readiness.validUntil,
    },
  };
}

/**
 * Strict read-only projection used once the Browser line consumes the
 * card-desk and operations backend as its upstream. It carries only opaque
 * card/route references and a bounded readiness proof; it never refreshes
 * the provider or carries card credentials.
 */
export function projectUpstreamBrowserJob(projection, {
  manifest = createSyntheticManifest(),
  now = Date.now(),
} = {}) {
  const job = projectSharedBrowserJob(projection, { manifest });
  const upstream = projectUpstreamCard(projection, { now });
  const metadata = {
    ...job.metadata,
    source: 'shared-upstream-read-only',
    upstream,
    ...(projection.observation?.pageContract == null
      ? {}
      : { pageContract: projection.observation.pageContract }),
    ...(projection.observation?.checkoutNavigationContract == null
      ? {}
      : { checkoutNavigationContract: projection.observation.checkoutNavigationContract }),
    ...(projection.observation?.checkoutContract == null
      ? {}
      : { checkoutContract: projection.observation.checkoutContract }),
  };
  assertSafeObject(metadata, 'upstream job metadata');
  const projected = { ...job, metadata };
  assertJobEnvelope(projected);
  return projected;
}

export class ReadOnlySharedContractAdapter {
  project(projection, options) {
    return projectSharedBrowserJob(projection, options);
  }

  projectUpstream(projection, options) {
    return projectUpstreamBrowserJob(projection, options);
  }
}
