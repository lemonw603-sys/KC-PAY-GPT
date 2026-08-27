import { assertCohortManifest, assertEvidenceEvent, assertJobEnvelope, assertRef, assertSessionLease } from './contracts.js';

export class PortNotImplementedError extends Error {
  constructor(port, method) {
    super(`${port}.${method} is not implemented by this adapter`);
    this.name = 'PortNotImplementedError';
  }
}

/** Boundary for one Browser execution. No payment-capable operation is exposed in M0. */
export class BrowserExecutionPort {
  async execute(job, context) {
    assertJobEnvelope(job);
    if (!context || typeof context !== 'object') throw new TypeError('execution context is required');
    throw new PortNotImplementedError('BrowserExecutionPort', 'execute');
  }
}

/** Durable dispatch/lease boundary. Implementations must make claim and lease transitions atomic. */
export class DispatchStore {
  async enqueue(job) {
    assertJobEnvelope(job);
    throw new PortNotImplementedError('DispatchStore', 'enqueue');
  }

  async claim(_workerId) {
    throw new PortNotImplementedError('DispatchStore', 'claim');
  }

  async heartbeat(_jobId, _leaseToken) {
    throw new PortNotImplementedError('DispatchStore', 'heartbeat');
  }

  async complete(job) {
    assertJobEnvelope(job);
    throw new PortNotImplementedError('DispatchStore', 'complete');
  }

  async recover(_now) {
    throw new PortNotImplementedError('DispatchStore', 'recover');
  }
}

/** Append-only evidence boundary. Payloads are required to be pre-digested and safe summaries. */
export class EvidenceSink {
  async append(event) {
    assertEvidenceEvent(event);
    throw new PortNotImplementedError('EvidenceSink', 'append');
  }
}

/** Runtime/browser boundary. M0 adapters must reject write-capable manifests. */
export class RuntimeAdapter {
  async open(manifest) {
    assertCohortManifest(manifest);
    throw new PortNotImplementedError('RuntimeAdapter', 'open');
  }

  async close(_runtime) {
    throw new PortNotImplementedError('RuntimeAdapter', 'close');
  }
}

/**
 * Just-in-time Session boundary. The implementation is where the existing
 * login/"上号器" belongs. Raw session material must never leave this boundary.
 */
export class SessionProviderPort {
  async open(sessionRef, { purpose = 'browser-observe', ttlMs = 60_000 } = {}) {
    assertRef(sessionRef, 'sessionRef');
    if (typeof purpose !== 'string' || purpose.length === 0) throw new TypeError('purpose is required');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new TypeError('ttlMs must be at least 1000ms');
    throw new PortNotImplementedError('SessionProviderPort', 'open');
  }

  async close(sessionLease) {
    assertSessionLease(sessionLease);
    throw new PortNotImplementedError('SessionProviderPort', 'close');
  }
}
