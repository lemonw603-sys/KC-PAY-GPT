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

/**
 * Fixed-version, local MockAddress data source. It never calls mockaddress.com
 * at order time; the pinned JSON is updated deliberately and reviewed.
 */
export class MockAddressBillingAddressSource {
  constructor({ dataPath = DEFAULT_DATA_PATH, state = 'DE', name } = {}) {
    this.dataPath = dataPath;
    this.state = String(state || 'DE').trim().toUpperCase();
    this.name = String(name || '').trim();
    if (!TAX_FREE_STATES.includes(this.state)) throw new TypeError('state must be a supported MockAddress tax-free state');
    if (!this.name) throw new TypeError('name is required for billing address');
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
    const row = normalizeRow(rows[indexFor(bindingRef, rows.length)], this.state);
    const result = { ...row, name: this.name };
  if (!result.name || !result.line1 || !result.city || !result.postalCode || !/^[A-Z]{2}$/.test(result.state)) {
    throw new ContractError('MockAddress billing address is incomplete');
  }
  return result;
  }

  metadata() { return { source: 'MockAddress', version: this.version, state: this.state }; }
}

export { TAX_FREE_STATES };
