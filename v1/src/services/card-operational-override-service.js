import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';

const POLICIES = new Set(['NORMAL', 'PRODUCT_ONLY', 'RETIRED']);

function text(value, name, max = 500) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) {
    throw new PublicApiError(`Invalid ${name}`, { code: 'INVALID_CARD_OVERRIDE', status: 400 });
  }
  return result;
}

export function createCardOperationalOverrideService({ pool }) {
  async function list({ providerAccountId = null, policy = null, limit = 100 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const params = [];
    const where = [];
    if (providerAccountId) { where.push('o.provider_account_id = ?'); params.push(String(providerAccountId)); }
    if (policy) { if (!POLICIES.has(String(policy))) throw new PublicApiError('Invalid policy', { code: 'INVALID_CARD_OVERRIDE', status: 400 }); where.push('o.allocation_policy = ?'); params.push(String(policy)); }
    const [rows] = await pool.query(
      `SELECT o.id, o.provider_account_id, o.external_card_id, o.allocation_policy,
              o.product_code, o.reason, o.set_by, o.set_at, o.updated_at
         FROM card_operational_overrides o
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.updated_at DESC LIMIT ${size}`, params);
    return { overrides: rows };
  }

  async function set({ providerAccountId, externalCardId, allocationPolicy, productCode = null, reason, actorId = 'admin' }) {
    const account = text(providerAccountId, 'providerAccountId', 64);
    const card = text(externalCardId, 'externalCardId', 191);
    const policy = text(allocationPolicy, 'allocationPolicy', 24).toUpperCase();
    if (!POLICIES.has(policy)) throw new PublicApiError('Invalid policy', { code: 'INVALID_CARD_OVERRIDE', status: 400 });
    const product = productCode == null || String(productCode).trim() === '' ? null : text(productCode, 'productCode', 32).toLowerCase();
    if (policy === 'PRODUCT_ONLY' && !product) throw new PublicApiError('Product is required for PRODUCT_ONLY', { code: 'INVALID_CARD_OVERRIDE', status: 400 });
    const note = text(reason, 'reason');
    const actor = text(actorId || 'admin', 'actorId', 128);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO card_operational_overrides
        (id, provider_account_id, external_card_id, allocation_policy, product_code, reason, set_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE allocation_policy = VALUES(allocation_policy),
         product_code = VALUES(product_code), reason = VALUES(reason), set_by = VALUES(set_by)`,
      [id, account, card, policy, product, note, actor]);
    const [rows] = await pool.query(
      `SELECT id, provider_account_id, external_card_id, allocation_policy, product_code, reason, set_by, set_at, updated_at
         FROM card_operational_overrides WHERE provider_account_id = ? AND external_card_id = ? LIMIT 1`, [account, card]);
    return rows[0];
  }

  async function clear({ providerAccountId, externalCardId }) {
    const account = text(providerAccountId, 'providerAccountId', 64);
    const card = text(externalCardId, 'externalCardId', 191);
    const [result] = await pool.query(
      'DELETE FROM card_operational_overrides WHERE provider_account_id = ? AND external_card_id = ?', [account, card]);
    return { deleted: result.affectedRows > 0, providerAccountId: account, externalCardId: card };
  }

  return { list, set, clear };
}
