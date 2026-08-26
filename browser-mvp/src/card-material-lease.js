import { randomUUID } from 'node:crypto';

import { assertRef, ContractError } from './contracts.js';

function clone(value) {
  return structuredClone(value);
}

function assertMaterial(material) {
  if (!material || typeof material !== 'object' || Array.isArray(material)) throw new ContractError('card material must be an object');
  for (const key of ['pan', 'expMonth', 'expYear', 'cvc']) {
    if (material[key] === undefined || material[key] === null || String(material[key]).trim() === '') {
      throw new ContractError(`card material.${key} is required`);
    }
  }
  return material;
}

/** Minimal JIT card-material boundary. Raw card fields never enter a job or lease. */
export class InMemoryCardMaterialLeaseProvider {
  constructor({ source, clock = () => Date.now() } = {}) {
    if (!source || typeof source.load !== 'function') throw new TypeError('card material source.load is required');
    this.source = source;
    this.clock = clock;
    this.leases = new Map();
  }

  async open(cardRef, { purpose = 'browser-checkout', ttlMs = 60_000 } = {}) {
    assertRef(cardRef, 'cardRef');
    if (typeof purpose !== 'string' || purpose.length === 0) throw new TypeError('purpose is required');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new TypeError('ttlMs must be at least 1000ms');
    const material = assertMaterial(await this.source.load(cardRef));
    const lease = { leaseId: `card-material-lease:${randomUUID()}`, cardRef, expiresAt: this.clock() + ttlMs, purpose };
    this.leases.set(lease.leaseId, { ...lease, material: clone(material) });
    return { ...lease };
  }

  async withMaterial(lease, callback) {
    if (!lease || typeof lease !== 'object' || typeof callback !== 'function') throw new TypeError('lease and callback are required');
    const entry = this.leases.get(lease.leaseId);
    if (!entry || entry.expiresAt <= this.clock()) throw new ContractError('card material lease is expired or unknown');
    return callback(clone(entry.material));
  }

  async close(lease) {
    if (!lease?.leaseId) throw new TypeError('lease is required');
    this.leases.delete(lease.leaseId);
  }
}
