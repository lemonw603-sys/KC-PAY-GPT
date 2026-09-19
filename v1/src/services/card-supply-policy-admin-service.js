import { PublicApiError } from '../domain/public-api-error.js';
import { providerLabelOf } from '../domain/provider-labels.js';

/**
 * 设置页的写路径（第⑥步 B / D-290）。
 *
 * 这两处此前**只有读、没有任何写端点**：
 *  - `card_supply_policies`（按台×按产品的水位 / 开卡金额 / 每日开卡上限）——补卡调度器读它；
 *  - `provider_accounts.wallet_floor` / `wallet_alert_threshold`（按台的钱包硬底线与告警线）
 *    ——`walletPreflight` 用底线挡开卡。
 * 也就是说，这些真正决定「什么时候自动开卡、开多大金额、钱够不够」的数，
 * 过去只能改库。设置页把它们接出来，每改一项写 `admin_setting_events`。
 *
 * 字段一律走白名单拼进 SQL（列名不能参数化），值全部参数化。
 */

const POLICY_FIELDS = Object.freeze({
  target_available: { kind: 'int', min: 0, max: 100, label: '水位' },
  open_card_amount: { kind: 'money', min: 0, max: 1000, label: '开卡金额' },
  daily_open_limit: { kind: 'int', min: 0, max: 500, label: '每日开卡上限' }
});

const WALLET_FIELDS = Object.freeze({
  wallet_floor: { kind: 'money', min: 0, max: 100000, label: '钱包底线' },
  wallet_alert_threshold: { kind: 'money', min: 0, max: 100000, label: '钱包告警线' }
});

function normalizeValue(field, spec, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new PublicApiError(`${spec.label}必须是数字`, { code: 'INVALID_SETTING_VALUE', status: 400 });
  }
  if (value < spec.min || value > spec.max) {
    throw new PublicApiError(`${spec.label}必须在 ${spec.min} 到 ${spec.max} 之间`, {
      code: 'INVALID_SETTING_VALUE', status: 400
    });
  }
  if (spec.kind === 'int') {
    if (!Number.isInteger(value)) {
      throw new PublicApiError(`${spec.label}必须是整数`, { code: 'INVALID_SETTING_VALUE', status: 400 });
    }
    return String(value);
  }
  if (Math.round(value * 100) !== value * 100) {
    throw new PublicApiError(`${spec.label}最多两位小数`, { code: 'INVALID_SETTING_VALUE', status: 400 });
  }
  return value.toFixed(2);
}

function requireActor(actorId) {
  const actor = String(actorId || '').trim();
  if (!actor || actor.length > 128) {
    throw new PublicApiError('Invalid settings actor', { code: 'INVALID_SETTINGS_ACTOR', status: 400 });
  }
  return actor;
}

export function createCardSupplyPolicyAdminService({ pool }) {
  if (!pool?.getConnection) throw new TypeError('pool is required');

  async function list() {
    const [[policies], [accounts], [settings]] = await Promise.all([
      pool.query(`SELECT p.provider_account_id, pa.account_code, pa.provider_code, p.product_code,
            p.target_available, p.open_card_amount, p.daily_open_limit, p.card_segment,
            p.updated_by, p.updated_at
          FROM card_supply_policies p
          INNER JOIN provider_accounts pa ON pa.id = p.provider_account_id
          ORDER BY pa.provider_code, p.product_code`),
      pool.query(`SELECT id, account_code, provider_code, wallet_floor, wallet_alert_threshold
          FROM provider_accounts WHERE purpose = 'CARD' ORDER BY provider_code`),
      pool.query(`SELECT setting_key, setting_value FROM app_settings
          WHERE setting_key IN ('card_max_successful_payments','default_minimum_required_card_balance',
            'minimum_required_card_balance:pro_5x','minimum_required_card_balance:pro_20x',
            'session_replacement_window_hours')`)
    ]);
    const setting = (key) => settings.find((row) => row.setting_key === key)?.setting_value ?? null;
    const money = (value) => (value == null ? null : String(value));
    return {
      policies: policies.map((row) => ({
        providerAccountId: String(row.provider_account_id),
        accountCode: row.account_code,
        providerKind: row.provider_code,
        label: providerLabelOf(row.provider_code),
        productCode: row.product_code,
        targetAvailable: Number(row.target_available || 0),
        openCardAmount: money(row.open_card_amount),
        dailyOpenLimit: Number(row.daily_open_limit || 0),
        cardSegment: row.card_segment == null ? null : String(row.card_segment),
        updatedBy: row.updated_by,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || null
      })),
      wallets: accounts.map((row) => ({
        providerAccountId: String(row.id),
        accountCode: row.account_code,
        providerKind: row.provider_code,
        label: providerLabelOf(row.provider_code),
        walletFloor: money(row.wallet_floor),
        walletAlertThreshold: money(row.wallet_alert_threshold)
      })),
      // 按产品的最低余额（已有写端点）与全局门槛，一并读出来给设置页显示。
      minimumBalanceByPlan: {
        plus: setting('default_minimum_required_card_balance'),
        pro_5x: setting('minimum_required_card_balance:pro_5x'),
        pro_20x: setting('minimum_required_card_balance:pro_20x')
      },
      // D-221 要按产品，但目前只有这一个全局值 —— 设置页只读显示，不给改（Lemon 2026-09-20 定）。
      maxSuccessfulPayments: setting('card_max_successful_payments'),
      maxSuccessfulPaymentsIsPerProduct: false,
      sessionReplacementWindowHours: setting('session_replacement_window_hours')
    };
  }

  /** 改一格策略（按台×按产品）。列名走白名单，值参数化，旧值→新值进审计。 */
  async function setPolicyField({ providerAccountId, productCode, field, value, actorId = 'admin', reason = null } = {}) {
    const spec = POLICY_FIELDS[String(field || '')];
    if (!spec) throw new PublicApiError('未知的策略字段', { code: 'UNKNOWN_SETTING_FIELD', status: 400 });
    const actor = requireActor(actorId);
    const normalized = normalizeValue(field, spec, value);
    const accountId = String(providerAccountId || '').trim();
    const product = String(productCode || '').trim().toLowerCase();
    if (!accountId || !product) {
      throw new PublicApiError('缺少卡台或产品', { code: 'INVALID_SETTING_TARGET', status: 400 });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[row]] = await connection.query(
        `SELECT p.${field} AS current_value, pa.account_code
           FROM card_supply_policies p
           INNER JOIN provider_accounts pa ON pa.id = p.provider_account_id
          WHERE p.provider_account_id = ? AND p.product_code = ? FOR UPDATE`,
        [accountId, product]
      );
      if (!row) {
        throw new PublicApiError('这个卡台没有该产品的策略行', { code: 'SUPPLY_POLICY_NOT_FOUND', status: 404 });
      }
      const oldValue = row.current_value == null ? null : String(row.current_value);
      await connection.query(
        `UPDATE card_supply_policies SET ${field} = ?, updated_by = ?
          WHERE provider_account_id = ? AND product_code = ?`,
        [normalized, actor, accountId, product]
      );
      // 值没变就不留审计噪音；数值比较用 Number，避免 "20" 与 "20.000000" 被当成改动。
      if (Number(oldValue) !== Number(normalized)) {
        await connection.query(
          `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason)
           VALUES (?, ?, ?, ?, ?)`,
          [`supply_policy:${row.account_code}:${product}:${field}`, oldValue, normalized,
            actor, reason ? String(reason).slice(0, 500) : null]
        );
      }
      await connection.commit();
      return { accountCode: row.account_code, productCode: product, field, oldValue, newValue: normalized };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  /** 改一台的钱包底线或告警线。底线是开卡预检真正用来挡开卡的那条线。 */
  async function setWalletField({ providerAccountId, field, value, actorId = 'admin', reason = null } = {}) {
    const spec = WALLET_FIELDS[String(field || '')];
    if (!spec) throw new PublicApiError('未知的钱包字段', { code: 'UNKNOWN_SETTING_FIELD', status: 400 });
    const actor = requireActor(actorId);
    const normalized = normalizeValue(field, spec, value);
    const accountId = String(providerAccountId || '').trim();
    if (!accountId) throw new PublicApiError('缺少卡台', { code: 'INVALID_SETTING_TARGET', status: 400 });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[row]] = await connection.query(
        `SELECT ${field} AS current_value, account_code FROM provider_accounts
          WHERE id = ? AND purpose = 'CARD' FOR UPDATE`, [accountId]
      );
      if (!row) throw new PublicApiError('找不到这个卡台', { code: 'PROVIDER_ACCOUNT_NOT_FOUND', status: 404 });
      const oldValue = row.current_value == null ? null : String(row.current_value);
      await connection.query(`UPDATE provider_accounts SET ${field} = ? WHERE id = ?`, [normalized, accountId]);
      if (Number(oldValue) !== Number(normalized)) {
        await connection.query(
          `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason)
           VALUES (?, ?, ?, ?, ?)`,
          [`provider_wallet:${row.account_code}:${field}`, oldValue, normalized,
            actor, reason ? String(reason).slice(0, 500) : null]
        );
      }
      await connection.commit();
      return { accountCode: row.account_code, field, oldValue, newValue: normalized };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  return { list, setPolicyField, setWalletField, POLICY_FIELDS, WALLET_FIELDS };
}
