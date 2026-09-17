import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import {
  createCardSourceSelectionService, listCardSourceSelections, safeWaitingPredicate
} from './card-source-selection-service.js';

function required(value, code, max = 128) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new PublicApiError(code, { code, status: 400 });
  return text;
}
function mapSource(row) {
  return { id: row.id, providerCode: row.provider_code, accountCode: row.account_code,
    displayName: row.display_name || row.account_code, adapter: row.source_adapter,
    openAdapter: row.open_adapter || null,
    supportsApiRecharge: Boolean(row.supports_api_recharge), supportsBrowserRecharge: Boolean(row.supports_browser_recharge),
    supportsApiSync: Boolean(row.supports_api_sync), supportsAutoOpen: Boolean(row.supports_auto_open),
    supportsAutoFunding: Boolean(row.supports_auto_funding), operationalEnabled: Boolean(row.operational_enabled),
    readEnabled: Boolean(row.read_enabled), circuitState: row.circuit_state,
    supplyFaultState: row.supply_fault_state || 'OK', supplyFaultReason: row.supply_fault_reason || null,
    walletFloor: row.wallet_floor == null ? null : String(row.wallet_floor),
    walletAlertThreshold: row.wallet_alert_threshold == null ? null : String(row.wallet_alert_threshold),
    lastFullSnapshotAt: row.last_full_snapshot_at?.toISOString?.() || row.last_full_snapshot_at || null,
    cardCount: Number(row.card_count || 0), presentCount: Number(row.present_count || 0),
    usableFactCount: Number(row.usable_fact_count || 0) };
}

export function createCardSourceAdminService({ pool } = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('pool is required');
  const selections = createCardSourceSelectionService({ pool });

  async function list() {
    const [rows] = await pool.query(`SELECT pa.*,
      COUNT(c.id) AS card_count,
      SUM(c.id IS NOT NULL AND COALESCE(c.source_present,1)=1) AS present_count,
      SUM(c.id IS NOT NULL AND COALESCE(c.source_present,1)=1
        AND LOWER(c.status) IN ('active','available','usable','ready')) AS usable_fact_count
      FROM provider_accounts pa LEFT JOIN cards c ON c.provider_account_id=pa.id
      WHERE pa.purpose='CARD' GROUP BY pa.id ORDER BY pa.supports_api_sync DESC, pa.created_at ASC`);
    const selectionRows = await listCardSourceSelections(pool);
    const plusBrowser = selectionRows.find((row) => row.productCode === 'chatgpt_plus' && row.executorKind === 'BROWSER') || null;
    const plusApi = selectionRows.find((row) => row.productCode === 'chatgpt_plus' && row.executorKind === 'API') || null;
    return { displayNames: { API: 'API 充值', BROWSER: '浏览器自动化充值' },
      // Plus 两行的快捷字段：后台首页与卡片页现在读的就是这两个。
      apiProviderAccountId: plusApi?.providerAccountId || null,
      apiSelectionLocked: plusApi ? plusApi.locked : true,
      browserProviderAccountId: plusBrowser?.providerAccountId || null,
      browserSelectionVersion: Number(plusBrowser?.version || 0),
      browserSelectionUpdatedBy: plusBrowser?.updatedBy || null,
      browserSelectionUpdatedAt: plusBrowser?.updatedAt || null,
      selections: selectionRows,
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

  /**
   * 切 Plus 的 Browser 卡台。四项校验在选择表服务里跑，不过即拒（409 + checks）。
   * 之前这里只查 supports_browser_recharge，其他一律 warning 放行——现在不再放行。
   */
  async function switchBrowserSource({ providerAccountId, expectedVersion, takeoverWaiting = false, actorId = 'admin' } = {}) {
    const result = await selections.switchSelection({
      productCode: 'chatgpt_plus', executorKind: 'BROWSER', providerAccountId, expectedVersion,
      takeoverWaiting, actorId
    });
    return { eventId: result.eventId, previousProviderAccountId: result.previousProviderAccountId,
      providerAccountId: result.providerAccountId, changed: result.changed, version: result.version,
      actualTakeoverCount: result.actualTakeoverCount, checks: result.checks };
  }

  return { list, createManualSource, estimateWaitingTakeover, switchBrowserSource };
}
