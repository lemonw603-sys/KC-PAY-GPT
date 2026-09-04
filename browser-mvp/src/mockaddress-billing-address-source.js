import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertRef, ContractError } from './contracts.js';

const TAX_FREE_STATES = Object.freeze(['AK', 'DE', 'MT', 'NH', 'OR']);
const DEFAULT_DATA_PATH = new URL('../data/mockaddress-us-taxfree-v20260426.json', import.meta.url);

function digest(value) { return createHash('sha256').update(String(value)).digest(); }
function indexFor(ref, length) {
  const bytes = digest(ref);
  let n = 0;
  for (let i = 0; i < 6; i += 1) n = (n * 256 + bytes[i]) % length;
  return n;
}

function normalizeRow(row, state) {
  if (!row || typeof row !== 'object') throw new ContractError('MockAddress row is invalid');
  const country = String(row.country || 'US').trim().toUpperCase();
  const stateCode = String(row.stateCode || state).trim().toUpperCase();
  const address = {
    country,
    state: stateCode,
    line1: String(row.street || '').trim(),
    city: String(row.city || '').trim(),
    postalCode: String(row.zip || '').trim(),
  };
  if (!address.line1 || !address.city || !address.postalCode || country !== 'US' || stateCode !== state) {
    throw new ContractError('MockAddress row is incomplete or mismatched');
  }
  return address;
}

/** Small reference→row-index store; production should back this with a transactional DB table. */
export class InMemoryBillingAddressAssignmentStore {
  constructor() { this.byRef = new Map(); this.byIndex = new Map(); }
  async get(ref) { return this.byRef.get(String(ref)) ?? null; }
  async claim(ref, state, index, rowCount) {
    const key = String(ref); const existing = this.byRef.get(key);
    if (existing != null) return existing;
    for (let offset = 0; offset < rowCount; offset += 1) {
      const candidate = (index + offset) % rowCount;
      const owners = this.byIndex.get(`${state}:${candidate}`) || new Set();
      if (owners.size === 0 || owners.has(key)) {
        owners.add(key); this.byIndex.set(`${state}:${candidate}`, owners); this.byRef.set(key, candidate); return candidate;
      }
    }
    // Pool exhausted: reuse the preferred address rather than blocking an order.
    const fallback = `${state}:${index}`; const owners = this.byIndex.get(fallback) || new Set();
    owners.add(key); this.byIndex.set(fallback, owners); this.byRef.set(key, index); return index;
  }
}

/**
 * Fixed-version, local MockAddress data source. It never calls mockaddress.com
 * at order time; the pinned JSON is updated deliberately and reviewed.
 */
export class MockAddressBillingAddressSource {
  constructor({ dataPath = DEFAULT_DATA_PATH, state = 'DE', name, assignmentStore = new InMemoryBillingAddressAssignmentStore() } = {}) {
    this.dataPath = dataPath;
    this.state = String(state || 'DE').trim().toUpperCase();
    this.name = String(name || '').trim();
    if (!TAX_FREE_STATES.includes(this.state)) throw new TypeError('state must be a supported MockAddress tax-free state');
    if (!this.name) throw new TypeError('name is required for billing address');
    if (!assignmentStore || typeof assignmentStore.get !== 'function' || typeof assignmentStore.claim !== 'function') throw new TypeError('assignmentStore.get/claim are required');
    this.assignmentStore = assignmentStore;
    this.version = 'taxfree_target_no_source_perstate888@2026-04-26';
    this._datasetPromise = null;
  }

  async _loadDataset() {
    if (!this._datasetPromise) {
      this._datasetPromise = readFile(this.dataPath, 'utf8').then((text) => {
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new ContractError('MockAddress dataset is invalid JSON'); }
        if (parsed?.version !== 'taxfree_target_no_source_perstate888' || !parsed?.data || typeof parsed.data !== 'object') {
          throw new ContractError('MockAddress dataset version or shape is invalid');
        }
        return parsed;
      });
    }
    return this._datasetPromise;
  }

  async load(bindingRef = 'default') {
    assertRef(String(bindingRef), 'bindingRef');
    const dataset = await this._loadDataset();
    const rows = dataset.data?.[this.state];
    if (!Array.isArray(rows) || rows.length === 0) throw new ContractError('MockAddress has no rows for configured state');
    const preferred = indexFor(bindingRef, rows.length);
    const assigned = await this.assignmentStore.get(String(bindingRef));
    const rowIndex = assigned == null
      ? await this.assignmentStore.claim(String(bindingRef), this.state, preferred, rows.length)
      : assigned;
    const row = normalizeRow(rows[rowIndex], this.state);
    const result = { ...row, name: this.name };
    if (!result.name || !result.line1 || !result.city || !result.postalCode || !/^[A-Z]{2}$/.test(result.state)) {
      throw new ContractError('MockAddress billing address is incomplete');
    }
    return result;
  }

  metadata() { return { source: 'MockAddress', version: this.version, state: this.state }; }
}

export { TAX_FREE_STATES };

/** Transactional MySQL store for production; row contents stay in the pinned dataset. */
export class MysqlBillingAddressAssignmentStore {
  constructor({ pool } = {}) { if (!pool || typeof pool.query !== 'function') throw new TypeError('pool.query is required'); this.pool = pool; }
  async get(ref) {
    const [rows] = await this.pool.query('SELECT row_index AS rowIndex FROM browser_billing_address_assignments WHERE binding_ref = ? LIMIT 1', [String(ref)]);
    return rows[0]?.rowIndex == null ? null : Number(rows[0].rowIndex);
  }
  async claim(ref, state, index, rowCount) {
    const key = String(ref);
    for (let offset = 0; offset < rowCount; offset += 1) {
      const candidate = (index + offset) % rowCount;
      await this.pool.query('INSERT IGNORE INTO browser_billing_address_assignments (binding_ref, state, row_index) VALUES (?, ?, ?)', [key, state, candidate]);
      const found = await this.get(key);
      if (found != null) return found;
    }
    const [[fallback]] = await this.pool.query('SELECT row_index AS rowIndex FROM browser_billing_address_assignments WHERE state = ? GROUP BY row_index ORDER BY COUNT(*) ASC, row_index ASC LIMIT 1', [state]);
    const rowIndex = fallback?.rowIndex == null ? index : Number(fallback.rowIndex);
    await this.pool.query('INSERT IGNORE INTO browser_billing_address_assignments (binding_ref, state, row_index) VALUES (?, ?, ?)', [key, state, rowIndex]);
    const found = await this.get(key);
    return found == null ? rowIndex : found;
  }
}
