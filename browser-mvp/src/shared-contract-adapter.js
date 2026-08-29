import { assertJobEnvelope, assertRef, assertSafeObject, ContractError } from './contracts.js';
import { createSyntheticManifest } from './fixtures.js';

/**
 * Browser is executable only after the shared funds transaction has created a
 * PREPARED/ACTIVE attempt and moved the order to RECHARGE_PROCESSING. These
 * are shared database states, not a Browser-local projection state machine.
 */
export const BROWSER_ELIGIBLE_ORDER_STATUSES = Object.freeze(['RECHARGE_PROCESSING']);
export const BROWSER_ELIGIBLE_ATTEMPT_STATUSES = Object.freeze(['PREPARED']);
export const BROWSER_ELIGIBLE_FUNDS_RISK_STATES = Object.freeze(['ACTIVE']);
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
    if (FORBIDDEN_SOURCE_KEYS.has(key)) throw new ContractError(`${path}.${key} cannot enter a Browser job`);
    rejectForbiddenKeys(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function requireRef(value, label) {
  return assertRef(String(value ?? ''), label);
}

function assertFormalFundsContext(projection) {
  const orderStatus = projection.order?.status;
  const attemptStatus = projection.attempt?.status;
  const fundsRiskState = projection.attempt?.fundsRiskState;
  const executorKind = projection.attempt?.executorKind;
  const attemptProfileId = requireRef(projection.attempt?.executorProfileId, 'attempt.executorProfileId');
  const profileId = requireRef(projection.profile?.id, 'profile.id');
  if (!BROWSER_ELIGIBLE_ORDER_STATUSES.includes(orderStatus)) {
    throw new ContractError(`order.status ${orderStatus} is not executable by Browser`);
  }
  if (!BROWSER_ELIGIBLE_ATTEMPT_STATUSES.includes(attemptStatus)) {
    throw new ContractError(`attempt.status ${attemptStatus} is not executable by Browser`);
  }
  if (!BROWSER_ELIGIBLE_FUNDS_RISK_STATES.includes(fundsRiskState)) {
    throw new ContractError(`attempt.fundsRiskState ${fundsRiskState} is not executable by Browser`);
  }
  if (executorKind !== 'BROWSER') {
    throw new ContractError('attempt.executorKind must be BROWSER');
  }
  if (attemptProfileId !== profileId) {
    throw new ContractError('attempt.executorProfileId must match profile.id');
  }
  return { orderStatus, attemptStatus, fundsRiskState, executorKind };
}

function projectFormalBinding(projection) {
  const card = projection.card;
  const route = projection.route;
  const consumption = projection.cardConsumption;
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new ContractError('card binding is required');
  }
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    throw new ContractError('route binding is required');
  }
  if (!consumption || typeof consumption !== 'object' || Array.isArray(consumption)) {
    throw new ContractError('shared card consumption reservation is required');
  }
  const orderId = requireRef(projection.order.id, 'order.id');
  const cardId = requireRef(card.id, 'card.id');
  const routeId = requireRef(route.id, 'route.id');
  const cardProviderAccountId = requireRef(card.providerAccountId, 'card.providerAccountId');
  const routeCardProviderAccountId = requireRef(route.cardProviderAccountId, 'route.cardProviderAccountId');
  if (card.orderId !== projection.order.id) throw new ContractError('card.orderId must match order.id');
  if (projection.attempt.fulfillmentRouteId !== route.id) {
    throw new ContractError('attempt.fulfillmentRouteId must match route.id');
  }
  if (projection.order.fulfillmentRouteId !== route.id) {
    throw new ContractError('order.fulfillmentRouteId must match route.id');
  }
  if (!BROWSER_ELIGIBLE_ROUTE_EXECUTOR_KINDS.includes(route.executorKind)) {
    throw new ContractError('route.executorKind must be BROWSER');
  }
  if (cardProviderAccountId !== routeCardProviderAccountId) {
    throw new ContractError('card Provider account must match the frozen route');
  }
  const cardConsumptionId = requireRef(consumption.id, 'cardConsumption.id');
  if (consumption.status !== 'RESERVED') {
    throw new ContractError('cardConsumption.status must be RESERVED before payment');
  }
  if (consumption.attemptId !== projection.attempt.id
    || consumption.orderId !== projection.order.id
    || consumption.cardId !== card.id) {
    throw new ContractError('card consumption reservation must match attempt/order/card');
  }
  return {
    orderId,
    cardId,
    routeId,
    cardProviderAccountId,
    cardConsumptionId,
    cardConsumptionStatus: consumption.status,
    ...(card.providerCardRef == null
      ? {}
      : { providerCardRef: requireRef(card.providerCardRef, 'card.providerCardRef') }),
  };
}

function projectRun(projection) {
  if (projection.run == null) return null;
  const run = projection.run;
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new ContractError('run must be an object');
  if (run.status !== 'RUNNING') throw new ContractError('run.status must be RUNNING');
  if (!['NOT_STARTED', 'PAYMENT_ARMED'].includes(run.paymentState)) {
    throw new ContractError('run.paymentState is not safe for pre-payment Browser execution');
  }
  if (run.attemptId !== projection.attempt.id) throw new ContractError('run.attemptId must match attempt.id');
  return {
    id: requireRef(run.id, 'run.id'),
    status: run.status,
    paymentState: run.paymentState,
  };
}

/**
 * Convert the authoritative shared execution context into the existing local
 * Browser job envelope. Raw Session/card material is deliberately not part of
 * this object; it is supplied just-in-time by the runtime resolver.
 */
export function projectSharedBrowserJob(projection, {
  manifest = createSyntheticManifest(),
  sessionRef = null,
} = {}) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    throw new ContractError('shared execution context must be an object');
  }
  rejectForbiddenKeys(projection);
  if (Object.hasOwn(projection, 'auditRef') || Object.hasOwn(projection, 'audit_ref')) {
    throw new ContractError('independent auditRef is forbidden; browser_run.id is the audit reference');
  }
  if (Object.hasOwn(projection, 'sessionRef') || Object.hasOwn(projection, 'session_ref')) {
    throw new ContractError('Session must come from the controlled runtime context, not the shared projection');
  }
  if (Object.hasOwn(projection, 'fundsGate')) {
    throw new ContractError('fundsGate is a retired Browser-local truth; use attempt.fundsRiskState');
  }
  const formal = assertFormalFundsContext(projection);
  const upstream = projectFormalBinding(projection);
  const run = projectRun(projection);
  const orderId = requireRef(projection.order.id, 'order.id');
  const attemptId = requireRef(projection.attempt.id, 'attempt.id');
  const profileId = requireRef(projection.profile.id, 'profile.id');
  const metadata = {
    source: 'shared-browser-runtime-contract',
    sharedState: formal,
    upstream,
    ...(run == null ? {} : { browserRunRef: `run:${run.id}`, paymentState: run.paymentState }),
    ...(sessionRef == null ? {} : { sessionRef: requireRef(sessionRef, 'sessionRef') }),
    ...(projection.observation?.pageContract == null ? {} : { pageContract: projection.observation.pageContract }),
    ...(projection.observation?.sessionIdentity == null ? {} : { sessionIdentity: projection.observation.sessionIdentity }),
    ...(projection.observation?.accountProbeContract == null
      ? {} : { accountProbeContract: projection.observation.accountProbeContract }),
    ...(projection.observation?.checkoutNavigationContract == null
      ? {} : { checkoutNavigationContract: projection.observation.checkoutNavigationContract }),
    ...(projection.observation?.checkoutContract == null
      ? {} : { checkoutContract: projection.observation.checkoutContract }),
  };
  assertSafeObject(metadata, 'shared Browser runtime metadata');
  const job = {
    schemaVersion: 1,
    jobId: `brjob:${orderId}:${attemptId}`,
    orderRef: `order:${orderId}`,
    attemptRef: `attempt:${attemptId}`,
    profileRef: `profile:${profileId}`,
    state: run == null ? 'QUEUED' : 'RUNNING',
    manifest,
    metadata,
  };
  assertJobEnvelope(job);
  return job;
}

// Kept as an API alias for Browser-only callers. It no longer creates a
// READY/digest/validUntil parallel card projection.
export function projectUpstreamBrowserJob(projection, options = {}) {
  return projectSharedBrowserJob(projection, options);
}

export class ReadOnlySharedContractAdapter {
  project(projection, options) {
    return projectSharedBrowserJob(projection, options);
  }

  projectUpstream(projection, options) {
    return projectUpstreamBrowserJob(projection, options);
  }
}
