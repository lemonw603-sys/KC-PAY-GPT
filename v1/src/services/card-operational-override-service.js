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

  /**
   * 删掉这张卡的 override —— 也就是「我手动用了」的回头路（B3）。
   *
   * 本轮之前这个端点前端一次都没调过，等于没有回头路；现在它成了运营会点的按钮，
   * 所以必须留痕：删之前把原值读出来，连同理由写一条 card_state_events。
   * CLAUDE.md：数据库状态迁移必须显式、可审计。
   *
   * 边界：override 行可能没有对应的 cards 行（页面上那些 externalOnly 的行就是这种），
   * 那种情况写不了 card_state_events（它按 card_id 挂）。此时如实返回 audited:false，
   * 不假装记过。
   */
  async function clear({ providerAccountId, externalCardId, reason = null, actorId = 'admin' }) {
    const account = text(providerAccountId, 'providerAccountId', 64);
    const card = text(externalCardId, 'externalCardId', 191);
    const actor = String(actorId || 'admin').trim().slice(0, 128) || 'admin';
    const safeReason = reason == null ? null : String(reason).trim().slice(0, 300) || null;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query(
        `SELECT allocation_policy, product_code, reason, set_by FROM card_operational_overrides
          WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ? LIMIT 1 FOR UPDATE`,
        [account, card]);
      const [result] = await connection.query(
        'DELETE FROM card_operational_overrides WHERE provider_account_id = ? AND external_card_id = ?', [account, card]);
      let audited = false;
      if (result.affectedRows > 0 && existing[0]) {
        const [cardRows] = await connection.query(
          'SELECT id FROM cards WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ? LIMIT 1',
          [account, card]);
        if (cardRows[0]) {
          await connection.query(
            `INSERT INTO card_state_events (card_id, event_type, source, previous_json, current_json)
             VALUES (?, 'CARD_OVERRIDE_CLEARED', ?, ?, ?)`,
            [cardRows[0].id, actor.slice(0, 64),
              JSON.stringify({ allocationPolicy: existing[0].allocation_policy,
                productCode: existing[0].product_code, reason: existing[0].reason, setBy: existing[0].set_by }),
              JSON.stringify({ allocationPolicy: null, clearedBy: actor, reason: safeReason })]);
          audited = true;
        }
      }
      await connection.commit();
      return { deleted: result.affectedRows > 0, audited, providerAccountId: account, externalCardId: card };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  return { list, set, clear };
}
