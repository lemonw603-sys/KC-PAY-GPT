/**
 * 卡台账户按能力位解析（D-246 面一 C1 ④）。
 *
 * 之前这里从「accepts_new_orders=1 的 Plus 路线」反查 `fr.card_provider_account_id`
 * 再过滤 `pa.provider_code='hnskj'`：路线表 BROWSER 行的 101 就是被这条查询撑着的，
 * Plus 走 Browser 时八个 hnskj runner 全靠它才启动得起来。这把「谁是当前卡台」跟
 * 「走哪条路」绑死了，切路线就牵动供给。
 *
 * 现在分派只看 provider_accounts 的能力位与适配器码，不看名字：
 *   - `open_adapter` / `source_adapter`：这行账户由哪个适配器实现（hnskj_api_v1 / highvcc_api_v1 /
 *     backup_card_export_v1）。新卡台 = 一行账户 + 一个适配器，不改这里。
 *   - `supports_api_sync` 等能力位：runner 只对有对应能力的账户发请求。
 */

export const CARD_ADAPTER_HNSKJ = 'hnskj_api_v1';
export const CARD_ADAPTER_HIGHVCC = 'highvcc_api_v1';

export const CARD_ACCOUNT_COLUMNS = `pa.id, pa.provider_code, pa.account_code, pa.display_name,
  pa.environment, pa.purpose, pa.source_adapter, pa.open_adapter, pa.default_card_segment,
  pa.wallet_floor, pa.wallet_alert_threshold, pa.supply_fault_state, pa.supply_fault_reason, pa.supply_fault_at,
  pa.supports_api_recharge, pa.supports_browser_recharge, pa.supports_api_sync, pa.supports_auto_open,
  pa.supports_auto_funding, pa.operational_enabled, pa.read_enabled, pa.write_enabled,
  pa.circuit_state, pa.retry_after_until, pa.last_full_snapshot_at`;

function bool(value) {
  return Number(value) === 1 || value === true;
}

export function mapCardProviderAccount(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    providerCode: row.provider_code,
    accountCode: row.account_code,
    displayName: row.display_name || row.account_code,
    sourceAdapter: row.source_adapter || null,
    openAdapter: row.open_adapter || null,
    defaultCardSegment: row.default_card_segment == null ? null : String(row.default_card_segment),
    walletFloor: row.wallet_floor == null ? null : String(row.wallet_floor),
    walletAlertThreshold: row.wallet_alert_threshold == null ? null : String(row.wallet_alert_threshold),
    supplyFaultState: row.supply_fault_state || 'OK',
    supplyFaultReason: row.supply_fault_reason || null,
    supplyFaultAt: row.supply_fault_at instanceof Date ? row.supply_fault_at.toISOString() : row.supply_fault_at || null,
    supportsApiRecharge: bool(row.supports_api_recharge),
    supportsBrowserRecharge: bool(row.supports_browser_recharge),
    supportsApiSync: bool(row.supports_api_sync),
    supportsAutoOpen: bool(row.supports_auto_open),
    supportsAutoFunding: bool(row.supports_auto_funding),
    operationalEnabled: bool(row.operational_enabled),
    readEnabled: bool(row.read_enabled),
    writeEnabled: bool(row.write_enabled),
    circuitState: row.circuit_state || null,
    retryAfterUntil: row.retry_after_until instanceof Date ? row.retry_after_until.toISOString() : row.retry_after_until || null,
    lastFullSnapshotAt: row.last_full_snapshot_at instanceof Date ? row.last_full_snapshot_at.toISOString() : row.last_full_snapshot_at || null
  };
}

/**
 * 账户此刻能不能被系统自动使用（分卡、开卡、同步）。
 * `read_enabled` 只对有 API 同步能力的账户有意义：备用卡台 A 没有只读 API，
 * 它的 read_enabled=0 是「没有这个能力」，不是「被停用」。
 */
export function cardProviderAccountIsHealthy(account, { now = Date.now() } = {}) {
  if (!account) return false;
  if (!account.operationalEnabled) return false;
  if (account.circuitState && account.circuitState !== 'CLOSED') return false;
  if (account.retryAfterUntil && Date.parse(account.retryAfterUntil) > now) return false;
  if (account.supportsApiSync && !account.readEnabled) return false;
  return true;
}

export async function listCardProviderAccounts(queryable, { forUpdate = false } = {}) {
  const [rows] = await queryable.query(
    `SELECT ${CARD_ACCOUNT_COLUMNS}
       FROM provider_accounts pa
      WHERE pa.purpose = 'CARD' AND pa.environment = 'PRODUCTION'
      ORDER BY pa.created_at ASC${forUpdate ? ' FOR UPDATE' : ''}`
  );
  return rows.map(mapCardProviderAccount);
}

export async function readCardProviderAccount(queryable, providerAccountId, { forUpdate = false } = {}) {
  const [rows] = await queryable.query(
    `SELECT ${CARD_ACCOUNT_COLUMNS}
       FROM provider_accounts pa
      WHERE pa.id = ? AND pa.purpose = 'CARD' LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [String(providerAccountId || '')]
  );
  return mapCardProviderAccount(rows[0]);
}

/**
 * 「这个适配器现在服务哪一行账户」。hnskj 的几个 runner（只读同步 / 目录对账 / 人工开卡执行）
 * 自己就是 hnskj_api_v1 适配器的运行时，它们要的不是「当前路线的卡台」，而是
 * 「我这个适配器该对哪个账户发请求」——健康的那一行；没有就返回 null，调用方 fail closed。
 */
export async function resolveCardProviderAccountForAdapter(queryable, adapterCode, { now = Date.now() } = {}) {
  const code = String(adapterCode || '').trim();
  if (!code) throw new TypeError('adapterCode is required');
  const accounts = await listCardProviderAccounts(queryable);
  return accounts.find((account) => (account.openAdapter === code || account.sourceAdapter === code)
    && cardProviderAccountIsHealthy(account, { now })) || null;
}

export async function resolveCardProviderAccountIdForAdapter(pool, adapterCode, options = {}) {
  const account = await resolveCardProviderAccountForAdapter(pool, adapterCode, options);
  return account ? account.id : null;
}
