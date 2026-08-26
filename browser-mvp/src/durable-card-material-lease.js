import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { assertRef, ContractError } from './contracts.js';
import { assertCardMaterial } from './card-material-lease.js';

function clone(value) { return structuredClone(value); }

/**
 * Durable lease registry. Card fields are reloaded from the upstream source
 * only inside withMaterial; the registry persists opaque lease state, never
 * PAN/CVC or billing material.
 */
export class DurableCardMaterialLeaseProvider {
  constructor({ source, filePath, clock = () => Date.now() } = {}) {
    if (!source || typeof source.load !== 'function') throw new TypeError('card material source.load is required');
    if (typeof filePath !== 'string' || filePath.length === 0) throw new TypeError('filePath is required');
    this.source = source;
    this.filePath = filePath;
    this.clock = clock;
    this.leases = new Map();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    let state;
    try { state = JSON.parse(await readFile(this.filePath, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { version: 1, leases: {} };
    }
    if (state.version !== 1 || !state.leases || typeof state.leases !== 'object') throw new ContractError('invalid card lease registry');
    this.leases = new Map(Object.values(state.leases).map((lease) => [lease.leaseId, lease]));
    // An active lease surviving a process restart is not safe to reuse blindly.
    for (const lease of this.leases.values()) if (lease.state === 'ACTIVE') lease.state = 'RECOVERY_REQUIRED';
    await this._persist();
    return this;
  }

  async open(cardRef, { purpose = 'browser-checkout', ttlMs = 60_000 } = {}) {
    assertRef(cardRef, 'cardRef');
    if (typeof purpose !== 'string' || purpose.length === 0) throw new TypeError('purpose is required');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60_000) throw new TypeError('ttlMs must be between 1000ms and 300000ms');
    for (const lease of this.leases.values()) {
      if (lease.cardRef === cardRef && ['ACTIVE', 'RECOVERY_REQUIRED'].includes(lease.state) && lease.expiresAt > this.clock()) {
        throw new ContractError('card already has an active or recovery-required lease');
      }
    }
    assertCardMaterial(await this.source.load(cardRef));
    const lease = { leaseId: `card-material-lease:${randomUUID()}`, cardRef, purpose, expiresAt: this.clock() + ttlMs, state: 'ACTIVE' };
    this.leases.set(lease.leaseId, lease);
    await this._persist();
    return { ...lease };
  }

  async withMaterial(lease, callback) {
    if (!lease || typeof callback !== 'function') throw new TypeError('lease and callback are required');
    const entry = this.leases.get(lease.leaseId);
    if (!entry || entry.state !== 'ACTIVE' || entry.expiresAt <= this.clock()) throw new ContractError('card material lease is expired, revoked, or requires recovery');
    if (lease.cardRef !== entry.cardRef || lease.expiresAt !== entry.expiresAt || lease.purpose !== entry.purpose) throw new ContractError('card material lease does not match the issued lease');
    const material = assertCardMaterial(await this.source.load(entry.cardRef));
    return callback(clone(material));
  }

  async close(lease) {
    const entry = this.leases.get(lease?.leaseId);
    if (!entry) return;
    entry.state = 'RELEASED';
    await this._persist();
  }

  async recover(leaseId, action = 'revoke') {
    const entry = this.leases.get(leaseId);
    if (!entry || entry.state !== 'RECOVERY_REQUIRED') throw new ContractError('lease is not awaiting recovery');
    if (!['release', 'revoke'].includes(action)) throw new ContractError('recovery action must be release or revoke');
    entry.state = action === 'release' ? 'RELEASED' : 'REVOKED';
    await this._persist();
    return { ...entry };
  }

  snapshot() { return { version: 1, leases: Object.fromEntries([...this.leases].map(([id, lease]) => [id, { ...lease }])) }; }

  async _persist() {
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(this.snapshot())}\n`, { mode: 0o600 });
    await rename(temp, this.filePath);
  }
}
