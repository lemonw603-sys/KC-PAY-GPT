import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { eligibleInventoryCardSql } from './card-inventory-eligibility.js';
import { cardProviderAccountIsHealthy, readCardProviderAccount } from './provider-route-service.js';

/**
 * 「产品 × 执行器 → 卡台」选择表（D-246 面一 C1）。
 *
 * 唯一真相在 card_source_selections。intake 建单时从这里取冻结卡台；切路线 / 切卡台
 * 两个端点都先跑同一套四项校验（目标路线唯一 / 目标卡池可分配 > 0 / 卡台健康 / 版本对），
 * 不过即拒并把每一项的结果原样交回，让后台能说清楚「为什么不让切」。
 * API 行 `locked=1`：后台不给控件、端点也拒绝（D-253：ZZSHU 按 BIN 白名单，API 固定 hnskj）。
 */

export const EXECUTOR_KINDS = Object.freeze(['API', 'BROWSER']);

export function normalizeExecutorKind(value) {
  const kind = String(value || '').trim().toUpperCase();
  if (!EXECUTOR_KINDS.includes(kind)) {
    throw new PublicApiError('executorKind must be API or BROWSER', { code: 'INVALID_EXECUTOR_KIND', status: 400 });
  }
  return kind;
}

/** 等待中、还没有任何资金/分配痕迹、可以安全改冻结卡台的订单。 */
export function safeWaitingPredicate(alias = 'o') {
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

/** 产品的最低卡余额门槛：Plus 用全局默认，Pro 用 `minimum_required_card_balance:<plan>`，缺省回落到默认。 */
export function minimumBalanceSql(productCode) {
  const plan = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(plan)) throw new TypeError('Invalid product code');
  return `COALESCE(
    (SELECT CAST(setting_value AS DECIMAL(18,6)) FROM app_settings WHERE setting_key = 'minimum_required_card_balance:${plan}' LIMIT 1),
    (SELECT CAST(setting_value AS DECIMAL(18,6)) FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1),
    999999999)`;
}

/** 某台 × 某产品此刻按正式资格规则可分配的张数（规则只有一份，不抄）。 */
export async function countEligibleCards(queryable, { providerAccountId, productCode = 'plus' }) {
  const [[row]] = await queryable.query(
    `SELECT COUNT(*) AS count FROM cards
      WHERE ${eligibleInventoryCardSql('cards', minimumBalanceSql(productCode), { productCode })}
        AND cards.provider_account_id = ?`,
    [String(providerAccountId)]
  );
  return Number(row?.count || 0);
}

function mapSelection(row) {
  return {
    productId: row.product_id,
    productCode: row.product_code,
    planType: row.legacy_plan_type,
    executorKind: row.executor_kind,
    providerAccountId: row.provider_account_id,
    locked: Number(row.locked) === 1,
    version: Number(row.version),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || null
  };
}

export async function listCardSourceSelections(queryable) {
  const [rows] = await queryable.query(
    `SELECT s.product_id, p.product_code, p.legacy_plan_type, s.executor_kind, s.provider_account_id,
            s.locked, s.version, s.updated_by, s.updated_at
       FROM card_source_selections s INNER JOIN products p ON p.id = s.product_id
      ORDER BY p.product_code, s.executor_kind`
  );
  return rows.map(mapSelection);
}

async function readSelectionRow(connection, { productId, executorKind, forUpdate = false }) {
  const [rows] = await connection.query(
    `SELECT s.product_id, p.product_code, p.legacy_plan_type, s.executor_kind, s.provider_account_id,
            s.locked, s.version, s.updated_by, s.updated_at
       FROM card_source_selections s INNER JOIN products p ON p.id = s.product_id
      WHERE s.product_id = ? AND s.executor_kind = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [productId, executorKind]
  );
  return rows[0] ? mapSelection(rows[0]) : null;
}

/**
 * 四项校验。返回 { ok, checks }，每项 { code, ok, detail }。
 * 不抛错：调用方（切卡台 / 切路线）决定怎么拒、拒了怎么说。
 */
export async function runCardSourceSwitchChecks(connection, {
  productId, productCode, executorKind, targetAccountId, expectedVersion, currentVersion, now = Date.now()
}) {
  const checks = [];
  const [routes] = await connection.query(
    `SELECT id FROM fulfillment_routes
      WHERE product_id = ? AND executor_kind = ? AND retired_at IS NULL`,
    [productId, executorKind]
  );
  checks.push({
    code: 'ROUTE_UNIQUE', ok: routes.length === 1,
    detail: routes.length === 1 ? `路线唯一（${routes[0].id}）` : `该产品的 ${executorKind} 路线有 ${routes.length} 条，应恰好 1 条`
  });

  const target = await readCardProviderAccount(connection, targetAccountId);
  const capabilityOk = Boolean(target && (executorKind === 'API' ? target.supportsApiRecharge : target.supportsBrowserRecharge));
  const healthy = Boolean(target && cardProviderAccountIsHealthy(target, { now }));
  checks.push({
    code: 'SOURCE_HEALTHY', ok: capabilityOk && healthy,
    detail: !target ? '目标卡台不存在'
      : !capabilityOk ? `目标卡台不支持 ${executorKind} 充值`
        : !healthy ? `目标卡台不健康：circuit=${target.circuitState}${target.retryAfterUntil ? `，retry_after=${target.retryAfterUntil}` : ''}${!target.operationalEnabled ? '，运营已停用' : ''}${target.supportsApiSync && !target.readEnabled ? '，只读未启用' : ''}`
          : `目标卡台 ${target.displayName} 健康`
  });

  const available = target ? await countEligibleCards(connection, { providerAccountId: target.id, productCode }) : 0;
  checks.push({
    code: 'TARGET_POOL_AVAILABLE', ok: available > 0,
    detail: `目标卡台按 ${productCode} 门槛可分配 ${available} 张`
  });

  const expected = Number(expectedVersion);
  const versionOk = Number.isInteger(expected) && expected === Number(currentVersion);
  checks.push({
    code: 'VERSION_MATCH', ok: versionOk,
    detail: versionOk ? `版本 ${currentVersion}` : `调用方看到的版本 ${expectedVersion ?? '（未提供）'}，当前 ${currentVersion}；请刷新后再切`
  });
  return { ok: checks.every((item) => item.ok), checks, target, available };
}

export function createCardSourceSelectionService({ pool } = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('pool is required');

  async function list() {
    return { selections: await listCardSourceSelections(pool) };
  }

  async function switchSelection({
    productCode, executorKind, providerAccountId, expectedVersion, takeoverWaiting = false, actorId = 'admin'
  } = {}) {
    const kind = normalizeExecutorKind(executorKind);
    const targetId = String(providerAccountId || '').trim();
    if (!targetId || targetId.length > 36) throw new PublicApiError('card source is required', { code: 'CARD_SOURCE_REQUIRED', status: 400 });
    const code = String(productCode || 'chatgpt_plus').trim();
    const actor = String(actorId || 'admin').trim().slice(0, 128) || 'admin';
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query(
        `SELECT id, product_code, legacy_plan_type FROM products
          WHERE (product_code = ? OR legacy_plan_type = ?) AND status = 'ACTIVE' LIMIT 1 FOR UPDATE`,
        [code, code]
      );
      const product = products[0];
      if (!product) throw new PublicApiError('product unavailable', { code: 'PRODUCT_UNAVAILABLE', status: 409 });
      const current = await readSelectionRow(connection, { productId: product.id, executorKind: kind, forUpdate: true });
      if (!current) throw new PublicApiError('card source selection row is missing', { code: 'CARD_SOURCE_SELECTION_MISSING', status: 409 });
      if (current.locked) {
        throw new PublicApiError(`${kind} card source is fixed and cannot be switched`, { code: 'CARD_SOURCE_SELECTION_LOCKED', status: 409 });
      }
      const result = await runCardSourceSwitchChecks(connection, {
        productId: product.id, productCode: product.legacy_plan_type || 'plus', executorKind: kind,
        targetAccountId: targetId, expectedVersion, currentVersion: current.version
      });
      if (!result.ok) {
        const error = new PublicApiError('card source switch rejected', { code: 'CARD_SOURCE_SWITCH_REJECTED', status: 409 });
        error.checks = result.checks;
        throw error;
      }
      const nextVersion = current.version + 1;
      const [updated] = await connection.query(
        `UPDATE card_source_selections
            SET provider_account_id = ?, version = ?, updated_by = ?
          WHERE product_id = ? AND executor_kind = ? AND version = ?`,
        [targetId, nextVersion, actor, product.id, kind, current.version]
      );
      if (Number(updated.affectedRows) !== 1) {
        throw new PublicApiError('card source selection changed concurrently', { code: 'CARD_SOURCE_SELECTION_CONFLICT', status: 409 });
      }
      let actualTakeover = 0;
      if (takeoverWaiting) {
        const [taken] = await connection.query(
          `UPDATE orders o
             INNER JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
              SET o.frozen_card_provider_account_id = ?, o.version = o.version + 1,
                  o.updated_at = CURRENT_TIMESTAMP(3)
            WHERE o.product_id = ? AND fr.executor_kind = ? AND ${safeWaitingPredicate('o')}`,
          [targetId, product.id, kind]
        );
        actualTakeover = Number(taken.affectedRows || 0);
      }
      const eventId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO card_source_selection_events
           (id, product_id, executor_kind, previous_provider_account_id, provider_account_id, version,
            checks_json, waiting_takeover_requested, actual_takeover_count, actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, product.id, kind, current.providerAccountId, targetId, nextVersion,
          JSON.stringify(result.checks), takeoverWaiting ? 1 : 0, actualTakeover, actor]
      );
      await connection.commit();
      return {
        eventId, productCode: product.product_code, executorKind: kind,
        previousProviderAccountId: current.providerAccountId, providerAccountId: targetId,
        changed: current.providerAccountId !== targetId, version: nextVersion,
        actualTakeoverCount: actualTakeover, checks: result.checks
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { list, switchSelection };
}
