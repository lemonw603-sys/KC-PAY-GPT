import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';

function required(value, code, max = 128) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new PublicApiError(code, { code, status: 400 });
  return text;
}
function safeWaitingPredicate(alias = 'o') {
  return `${alias}.status IN ('CREATED','WAITING_FOR_CARD')
    AND ${alias}.assigned_card_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.order_id=${alias}.id AND h.status='ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM card_consumption_ledger l WHERE l.order_id=${alias}.id
      AND l.status IN ('RESERVED','CONSUMED','RECONCILIATION'))
    AND NOT EXISTS (SELECT 1 FROM recharge_attempts ra WHERE ra.order_id=${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM card_funding_attempts fa WHERE fa.order_id=${alias}.id
      AND (fa.status IN ('PREPARED','PENDING','MANUAL_REVIEW') OR fa.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')))
    AND NOT EXISTS (SELECT 1 FROM reconciliation_cases rc WHERE rc.order_id=${alias}.id
      AND rc.status IN ('OPEN','ASSIGNED'))`;
}
function mapSource(row) {
  return { id: row.id, providerCode: row.provider_code, accountCode: row.account_code,
    displayName: row.display_name || row.account_code, adapter: row.source_adapter,
    supportsApiRecharge: Boolean(row.supports_api_recharge), supportsBrowserRecharge: Boolean(row.supports_browser_recharge),
    supportsApiSync: Boolean(row.supports_api_sync), supportsAutoOpen: Boolean(row.supports_auto_open),
    supportsAutoFunding: Boolean(row.supports_auto_funding), operationalEnabled: Boolean(row.operational_enabled),
    readEnabled: Boolean(row.read_enabled), circuitState: row.circuit_state,
    lastFullSnapshotAt: row.last_full_snapshot_at?.toISOString?.() || row.last_full_snapshot_at || null,
    cardCount: Number(row.card_count || 0), presentCount: Number(row.present_count || 0),
    usableFactCount: Number(row.usable_fact_count || 0) };
}

export function createCardSourceAdminService({ pool } = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('pool is required');

  async function list() {
    const [rows] = await pool.query(`SELECT pa.*,
      COUNT(c.id) AS card_count,
      SUM(COALESCE(c.source_present,1)=1) AS present_count,
      SUM(COALESCE(c.source_present,1)=1 AND LOWER(c.status) IN ('active','available','usable','ready')) AS usable_fact_count
      FROM provider_accounts pa LEFT JOIN cards c ON c.provider_account_id=pa.id
      WHERE pa.purpose='CARD' GROUP BY pa.id ORDER BY pa.provider_code='hnskj' DESC, pa.created_at ASC`);
    const [selectionRows] = await pool.query(`SELECT s.provider_account_id, s.version, s.updated_by, s.updated_at
      FROM browser_card_source_selections s INNER JOIN products p ON p.id=s.product_id
      WHERE p.product_code='chatgpt_plus' LIMIT 1`);
    const [apiRows] = await pool.query(`SELECT fr.card_provider_account_id
      FROM fulfillment_routes fr INNER JOIN products p ON p.id=fr.product_id
      WHERE p.product_code='chatgpt_plus' AND fr.executor_kind='API' AND fr.retired_at IS NULL
      ORDER BY fr.route_version DESC LIMIT 1`);
    const selection = selectionRows[0] || {};
    return { displayNames: { API: 'API 充值', BROWSER: '浏览器自动化充值' },
      apiProviderAccountId: apiRows[0]?.card_provider_account_id || null,
      browserProviderAccountId: selection.provider_account_id || null,
      browserSelectionVersion: Number(selection.version || 0),
      browserSelectionUpdatedBy: selection.updated_by || null,
      browserSelectionUpdatedAt: selection.updated_at?.toISOString?.() || selection.updated_at || null,
      sources: rows.map(mapSource) };
  }

  async function createManualSource({ accountCode, displayName, adapter = 'backup_card_export_v1', actorId = 'admin' } = {}) {
    const code = required(accountCode, 'INVALID_CARD_SOURCE_CODE', 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(code)) throw new PublicApiError('invalid source code', { code: 'INVALID_CARD_SOURCE_CODE', status: 400 });
    const name = required(displayName, 'INVALID_CARD_SOURCE_NAME', 128);
    const adapterCode = required(adapter, 'INVALID_CARD_SOURCE_ADAPTER', 64);
    if (adapterCode !== 'backup_card_export_v1') throw new PublicApiError('unsupported adapter', { code: 'UNSUPPORTED_CARD_SOURCE_ADAPTER', status: 400 });
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO provider_accounts
      (id, provider_code, account_code, display_name, environment, purpose, credential_ref,
       source_adapter, supports_api_recharge, supports_browser_recharge, supports_api_sync,
       supports_auto_open, supports_auto_funding, operational_enabled, read_enabled, write_enabled,
       max_concurrency)
      VALUES (?, 'manual_excel', ?, ?, 'PRODUCTION', 'CARD', NULL, ?, 0,1,0,0,0,1,0,0,1)`,
    [id, code, name, adapterCode]);
    return { id, accountCode: code, displayName: name, adapter: adapterCode, createdBy: String(actorId || 'admin') };
  }

  async function estimateWaitingTakeover() {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS count FROM orders o
      INNER JOIN fulfillment_routes fr ON fr.id=o.fulfillment_route_id
      WHERE fr.executor_kind='BROWSER' AND ${safeWaitingPredicate('o')}`);
    return { count: Number(row?.count || 0) };
  }

  async function switchBrowserSource({ providerAccountId, takeoverWaiting = false, actorId = 'admin' } = {}) {
    const targetId = required(providerAccountId, 'CARD_SOURCE_REQUIRED', 36);
    const actor = String(actorId || 'admin').trim().slice(0, 128) || 'admin';
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query(`SELECT id FROM products
        WHERE product_code='chatgpt_plus' AND status='ACTIVE' LIMIT 1 FOR UPDATE`);
      const productId = products[0]?.id;
      if (!productId) throw new PublicApiError('product unavailable', { code: 'PRODUCT_UNAVAILABLE', status: 409 });
      const [targets] = await connection.query(`SELECT id, provider_code, display_name, account_code,
        supports_browser_recharge, operational_enabled, read_enabled, circuit_state, retry_after_until
        FROM provider_accounts WHERE id=? AND purpose='CARD' LIMIT 1 FOR UPDATE`, [targetId]);
      const target = targets[0];
      if (!target || !target.supports_browser_recharge) throw new PublicApiError('Browser source unavailable', { code: 'BROWSER_CARD_SOURCE_UNAVAILABLE', status: 409 });
      const [currentRows] = await connection.query(`SELECT provider_account_id, version
        FROM browser_card_source_selections WHERE product_id=? FOR UPDATE`, [productId]);
      const previousId = currentRows[0]?.provider_account_id || null;
      const [[estimate]] = await connection.query(`SELECT COUNT(*) AS count FROM orders o
        INNER JOIN fulfillment_routes fr ON fr.id=o.fulfillment_route_id
        WHERE o.product_id=? AND fr.executor_kind='BROWSER' AND ${safeWaitingPredicate('o')}`, [productId]);
      let actual = 0;
      await connection.query(`INSERT INTO browser_card_source_selections
        (product_id,provider_account_id,version,updated_by) VALUES (?,?,1,?)
        ON DUPLICATE KEY UPDATE provider_account_id=VALUES(provider_account_id),
          version=version+1,updated_by=VALUES(updated_by)`, [productId, targetId, actor]);
      if (takeoverWaiting) {
        const [updated] = await connection.query(`UPDATE orders o
          INNER JOIN fulfillment_routes fr ON fr.id=o.fulfillment_route_id
          SET o.frozen_card_provider_account_id=?, o.version=o.version+1,
              o.updated_at=CURRENT_TIMESTAMP(3)
          WHERE o.product_id=? AND fr.executor_kind='BROWSER' AND ${safeWaitingPredicate('o')}`,
        [targetId, productId]);
        actual = Number(updated.affectedRows || 0);
      }
      const eventId = crypto.randomUUID();
      await connection.query(`INSERT INTO browser_card_source_switch_events
        (id,product_id,previous_provider_account_id,provider_account_id,
         waiting_takeover_requested,estimated_takeover_count,actual_takeover_count,actor_id)
        VALUES (?,?,?,?,?,?,?,?)`, [eventId, productId, previousId, targetId,
        takeoverWaiting ? 1 : 0, Number(estimate?.count || 0), actual, actor]);
      await connection.commit();
      const warnings = [];
      if (!target.operational_enabled) warnings.push('SOURCE_DISABLED');
      if (!target.read_enabled && target.provider_code !== 'manual_excel') warnings.push('READ_DISABLED');
      if (target.circuit_state && target.circuit_state !== 'CLOSED') warnings.push('CIRCUIT_OPEN');
      if (target.retry_after_until && new Date(target.retry_after_until) > new Date()) warnings.push('RETRY_WINDOW_ACTIVE');
      return { eventId, previousProviderAccountId: previousId, providerAccountId: targetId,
        changed: previousId !== targetId, estimatedTakeoverCount: Number(estimate?.count || 0),
        actualTakeoverCount: actual, warnings };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  return { list, createManualSource, estimateWaitingTakeover, switchBrowserSource };
}
