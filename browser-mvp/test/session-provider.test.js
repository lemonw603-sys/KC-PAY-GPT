import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSessionLease, ContractError } from '../src/contracts.js';
import { PortNotImplementedError, SessionProviderPort } from '../src/ports.js';
import { projectSharedBrowserJob } from '../src/shared-contract-adapter.js';

test('SessionProviderPort is the future just-in-time login/上号器 boundary', async () => {
  const port = new SessionProviderPort();
  await assert.rejects(
    () => port.open('session-ref:0001'),
    PortNotImplementedError,
  );
  await assert.rejects(
    () => port.close({ leaseId: 'lease:0001', sessionDigest: 'a'.repeat(64), expiresAt: Date.now() + 60_000 }),
    PortNotImplementedError,
  );
});

test('session lease contract keeps raw material out of dispatch/evidence shapes', () => {
  assert.doesNotThrow(() => assertSessionLease({
    leaseId: 'lease:0001',
    sessionDigest: 'a'.repeat(64),
    expiresAt: Date.now() + 60_000,
  }));
  assert.throws(() => assertSessionLease({
    leaseId: 'lease:0001',
    sessionDigest: 'a'.repeat(64),
    expiresAt: Date.now() + 60_000,
    material: 'raw-session',
  }), ContractError);
});

test('controlled runtime options carry only an opaque sessionRef, never session material', () => {
  const job = projectSharedBrowserJob({
    order: { id: 'ord-session', status: 'RECHARGE_PROCESSING', fulfillmentRouteId: 'route-session', frozenCardProviderAccountId: 'provider-session' },
    attempt: {
      id: 'att-session', status: 'PREPARED', fundsRiskState: 'ACTIVE',
      executorKind: 'BROWSER', executorProfileId: 'prof-session', fulfillmentRouteId: 'route-session',
    },
    profile: { id: 'prof-session' },
    card: { id: 'card-session', orderId: 'ord-session', providerAccountId: 'provider-session' },
    cardConsumption: {
      id: 'consumption-session', status: 'RESERVED',
      attemptId: 'att-session', orderId: 'ord-session', cardId: 'card-session',
    },
    route: { id: 'route-session', executorKind: 'BROWSER', cardProviderAccountId: 'provider-session' },
  }, { sessionRef: 'session-ref:0001' });
  assert.equal(job.metadata.sessionRef, 'session-ref:0001');
  assert.equal('session' in job.metadata, false);
});
