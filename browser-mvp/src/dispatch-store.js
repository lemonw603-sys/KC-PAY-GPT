import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { DispatchStore } from './ports.js';
import { assertDigest, assertJobEnvelope, assertRef, ContractError } from './contracts.js';

export class LeaseLostError extends Error {
  constructor(message = 'dispatch lease is missing, expired, or owned by another worker') {
    super(message);
    this.name = 'LeaseLostError';
  }
}

export class JobConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JobConflictError';
  }
}

export class AmbiguousStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'AmbiguousStorageError';
    this.ambiguous = true;
  }
}

const INITIAL_STATE = Object.freeze({ version: 1, jobs: {}, idempotency: {} });

function clone(value) {
  return structuredClone(value);
}

function validateWorkerId(workerId) {
  return assertRef(workerId, 'workerId');
}

function validateLeaseToken(token) {
  if (typeof token !== 'string' || token.length < 16) throw new ContractError('leaseToken must be opaque');
  return token;
}

export class FileDispatchStore extends DispatchStore {
  constructor({ filePath, leaseMs = 30_000, clock = () => Date.now() } = {}) {
    super();
    if (typeof filePath !== 'string' || filePath.length === 0) throw new TypeError('filePath is required');
    if (!Number.isInteger(leaseMs) || leaseMs < 100) throw new TypeError('leaseMs must be at least 100ms');
    this.filePath = filePath;
    this.leaseMs = leaseMs;
    this.clock = clock;
    this.maxWriteRetries = 2;
    this._lock = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this._writeState(INITIAL_STATE);
    }
    return this;
  }

  async enqueue(job, { idempotencyKey = job?.jobId } = {}) {
    assertJobEnvelope(job);
    validateLeaseToken(idempotencyKey);
    return this._withLock(async () => {
      const state = await this._readState();
      const existingJobId = state.idempotency[idempotencyKey];
      if (existingJobId) {
        const existing = state.jobs[existingJobId];
        if (JSON.stringify(existing.job) !== JSON.stringify(job)) {
          throw new JobConflictError(`idempotency key ${idempotencyKey} maps to a different job`);
        }
        return { job: clone(existing.job), created: false };
      }
      if (state.jobs[job.jobId]) throw new JobConflictError(`job ${job.jobId} already exists`);
      state.jobs[job.jobId] = {
        job: clone(job),
        attempts: 0,
        recoveryCount: 0,
        lease: null,
        updatedAt: this.clock(),
      };
      state.idempotency[idempotencyKey] = job.jobId;
      await this._writeState(state);
      return { job: clone(job), created: true };
    });
  }

  async claim(workerId) {
    validateWorkerId(workerId);
    return this._withLock(async () => {
      const state = await this._readState();
      const candidate = Object.values(state.jobs)
        .filter((entry) => entry.job.state === 'QUEUED')
        .sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!candidate) return null;
      const now = this.clock();
      const leaseToken = randomUUID();
      candidate.job = { ...candidate.job, state: 'RUNNING' };
      candidate.attempts += 1;
      candidate.lease = { workerId, leaseToken, expiresAt: now + this.leaseMs };
      candidate.updatedAt = now;
      await this._writeState(state);
      return { job: clone(candidate.job), leaseToken, leaseExpiresAt: candidate.lease.expiresAt };
    });
  }

  async heartbeat(jobId, leaseToken) {
    assertRef(jobId, 'jobId');
    validateLeaseToken(leaseToken);
    return this._withLock(async () => {
      const state = await this._readState();
      const entry = state.jobs[jobId];
      const now = this.clock();
      if (!entry || entry.job.state !== 'RUNNING' || !entry.lease || entry.lease.leaseToken !== leaseToken || entry.lease.expiresAt <= now) {
        throw new LeaseLostError();
      }
      entry.lease.expiresAt = now + this.leaseMs;
      entry.updatedAt = now;
      await this._writeState(state);
      return { job: clone(entry.job), leaseExpiresAt: entry.lease.expiresAt };
    });
  }

  async complete({ jobId, leaseToken, state = 'COMPLETED', resultDigest = null } = {}) {
    assertRef(jobId, 'jobId');
    validateLeaseToken(leaseToken);
    if (!['COMPLETED', 'FROZEN', 'RECONCILE_ONLY'].includes(state)) throw new ContractError('invalid completion state');
    if (resultDigest !== null) assertDigest(resultDigest, 'resultDigest');
    return this._withLock(async () => {
      const snapshot = await this._readState();
      const entry = snapshot.jobs[jobId];
      const now = this.clock();
      if (!entry || entry.job.state !== 'RUNNING' || !entry.lease || entry.lease.leaseToken !== leaseToken || entry.lease.expiresAt <= now) {
        throw new LeaseLostError();
      }
      entry.job = { ...entry.job, state, ...(resultDigest ? { resultDigest } : {}) };
      entry.lease = null;
      entry.updatedAt = now;
      await this._writeState(snapshot);
      return { job: clone(entry.job), completedAt: now };
    });
  }

  async recover(now = this.clock()) {
    if (!Number.isFinite(now)) throw new TypeError('now must be a timestamp');
    return this._withLock(async () => {
      const state = await this._readState();
      const recovered = [];
      for (const [jobId, entry] of Object.entries(state.jobs)) {
        if (entry.job.state !== 'RUNNING' || !entry.lease || entry.lease.expiresAt > now) continue;
        entry.job = { ...entry.job, state: 'QUEUED' };
        entry.lease = null;
        entry.recoveryCount += 1;
        entry.updatedAt = now;
        recovered.push(jobId);
      }
      if (recovered.length > 0) await this._writeState(state);
      return recovered;
    });
  }

  async snapshot() {
    return this._withLock(async () => clone(await this._readState()));
  }

  async _withLock(operation) {
    const next = this._lock.then(operation, operation);
    this._lock = next.catch(() => undefined);
    return next;
  }

  async _readState() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (parsed.version !== 1 || !parsed.jobs || !parsed.idempotency) throw new Error('invalid dispatch store state');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return clone(INITIAL_STATE);
      throw error;
    }
  }

  async _writeState(state) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const payload = `${JSON.stringify(state)}\n`;
    let written = false;
    for (let attempt = 0; attempt <= this.maxWriteRetries; attempt += 1) {
      try {
        await writeFile(tempPath, payload, { mode: 0o600 });
        written = true;
        break;
      } catch (error) {
        if (!['EAGAIN', 'EINTR'].includes(error.code) || attempt === this.maxWriteRetries) throw error;
      }
    }
    if (!written) throw new Error('dispatch state write did not complete');
    try {
      // Rename is intentionally not retried: after an ambiguous rename error the
      // caller must reconcile from the durable file instead of replaying a claim.
      await rename(tempPath, this.filePath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw new AmbiguousStorageError('dispatch state rename outcome is ambiguous; reconcile before retrying', error);
    }
  }
}
