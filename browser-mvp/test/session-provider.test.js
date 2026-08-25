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

test('shared projection carries only an opaque sessionRef, never session material', () => {
  const job = projectSharedBrowserJob({
    order: { id: 'ord-session', status: 'CARD_READY' },
    attempt: { id: 'att-session', status: 'OBSERVING' },
    profile: { id: 'prof-session' },
    sessionRef: 'session-ref:0001',
    fundsGate: { status: 'NOT_REQUESTED' },
  });
  assert.equal(job.metadata.sessionRef, 'session-ref:0001');
  assert.equal('session' in job.metadata, false);
});
