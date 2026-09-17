import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { runCardSourceSwitchChecks } from './card-source-selection-service.js';

function rechargeMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  if (!['API', 'BROWSER'].includes(method)) {
    throw new PublicApiError('Default recharge method must be API or BROWSER', {
      code: 'INVALID_DEFAULT_RECHARGE_METHOD', status: 400
    });
  }
  return method;
}

export function createProviderRouteAdminService({ pool }) {
  async function list() {
    const [rows] = await pool.query(
      `SELECT fr.id, fr.route_code, fr.route_version, fr.executor_kind,
              fr.accepts_new_orders, fr.retired_at,
              css.provider_account_id AS card_provider_account_id, pa.account_code, pa.read_enabled,
              pa.write_enabled, pa.circuit_state, pa.retry_after_until
       FROM fulfillment_routes fr
       INNER JOIN products p ON p.id = fr.product_id
       LEFT JOIN card_source_selections css ON css.product_id = p.id AND css.executor_kind = fr.executor_kind
       LEFT JOIN provider_accounts pa ON pa.id = css.provider_account_id
       WHERE p.product_code = 'chatgpt_plus'
       ORDER BY fr.route_version DESC, fr.created_at DESC`
    );
    return { routes: rows.map((row) => ({
      id: row.id,
      routeCode: row.route_code,
      routeVersion: Number(row.route_version),
      executorKind: row.executor_kind,
      acceptsNewOrders: Boolean(row.accepts_new_orders),
      retiredAt: row.retired_at?.toISOString?.() || row.retired_at || null,
      cardProviderAccountId: row.card_provider_account_id || null,
      accountCode: row.account_code || null,
      readEnabled: Boolean(row.read_enabled),
      writeEnabled: Boolean(row.write_enabled),
      circuitState: row.circuit_state || null,
      retryAfterUntil: row.retry_after_until?.toISOString?.() || row.retry_after_until || null
    })) };
  }

  /**
   * 切 Plus 默认充值方式（只翻 accepts_new_orders，不动卡台——卡台在选择表里各选各的）。
   *
   * D-246 面一 C1 ③：切之前跑四项校验，不过即拒并说原因：
   *   ROUTE_UNIQUE 目标执行器的路线恰 1 条 · SOURCE_HEALTHY 目标执行器的卡台健康且有该能力 ·
   *   TARGET_POOL_AVAILABLE 目标卡台按 Plus 门槛可分配 > 0 · VERSION_MATCH 调用方看到的当前方式与实际一致。
   * 之前切 API 什么都不查、切 Browser 只查 dispatch 开关 + profile + 心跳；Browser 那三项仍保留。
   */
  async function setDefaultRechargeMethod({ method, actorId, confirmation, expectedCurrentMethod }) {
    const selectedMethod = rechargeMethod(method);
    const actor = String(actorId || '').trim() || 'admin';
    const expected = `切换默认充值方式为 ${selectedMethod}`;
    if (String(confirmation || '').trim() !== expected) {
      throw new PublicApiError('Default recharge method confirmation mismatch', {
        code: 'DEFAULT_RECHARGE_METHOD_CONFIRMATION_REQUIRED', status: 400
      });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query(
        `SELECT id, legacy_plan_type FROM products WHERE product_code = 'chatgpt_plus' AND status = 'ACTIVE' LIMIT 1 FOR UPDATE`
      );
      const product = products[0];
      if (!product) throw new PublicApiError('product unavailable', { code: 'PRODUCT_UNAVAILABLE', status: 409 });
      const [routes] = await connection.query(
        `SELECT fr.id, fr.executor_kind, fr.accepts_new_orders
         FROM fulfillment_routes fr
         WHERE fr.product_id = ? AND fr.retired_at IS NULL
         ORDER BY fr.route_version DESC, fr.created_at DESC
         FOR UPDATE`, [product.id]
      );
      const candidates = routes.filter((route) => route.executor_kind === selectedMethod);
      if (candidates.length !== 1) {
        throw new PublicApiError('Default recharge route is unavailable', {
          code: 'DEFAULT_RECHARGE_ROUTE_UNAVAILABLE', status: 409
        });
      }
      const [selections] = await connection.query(
        `SELECT provider_account_id, version FROM card_source_selections
          WHERE product_id = ? AND executor_kind = ? LIMIT 1 FOR SHARE`, [product.id, selectedMethod]
      );
      if (!selections[0]) {
        throw new PublicApiError('card source selection row is missing', { code: 'CARD_SOURCE_SELECTION_MISSING', status: 409 });
      }
      const previous = routes.find((route) => Number(route.accepts_new_orders) === 1) || null;
      const currentMethod = previous?.executor_kind || null;
      const checkResult = await runCardSourceSwitchChecks(connection, {
        productId: product.id, productCode: product.legacy_plan_type || 'plus', executorKind: selectedMethod,
        targetAccountId: selections[0].provider_account_id,
        expectedVersion: selections[0].version, currentVersion: selections[0].version
      });
      const expectedMethod = expectedCurrentMethod == null ? null : String(expectedCurrentMethod).trim().toUpperCase();
      const methodOk = expectedMethod != null && expectedMethod === (currentMethod || 'NONE');
      const checks = checkResult.checks.map((item) => (item.code === 'VERSION_MATCH' ? {
        code: 'VERSION_MATCH', ok: methodOk,
        detail: methodOk ? `当前默认方式 ${currentMethod || '无'}` : `调用方看到的当前方式 ${expectedMethod ?? '（未提供）'}，实际 ${currentMethod || '无'}；请刷新后再切`
      } : item));
      if (!checks.every((item) => item.ok)) {
        const error = new PublicApiError('Default recharge method switch rejected', {
          code: 'DEFAULT_RECHARGE_METHOD_REJECTED', status: 409
        });
        error.checks = checks;
        throw error;
      }
      if (selectedMethod === 'BROWSER') {
        const [settings] = await connection.query(
          `SELECT setting_key, setting_value FROM app_settings
           WHERE setting_key IN ('browser_dispatch_enabled', 'browser_worker_heartbeat_at')
           FOR UPDATE`
        );
        const [profiles] = await connection.query(
          `SELECT id FROM executor_profiles
           WHERE executor_kind = 'BROWSER' AND status = 'ACTIVE'
           ORDER BY profile_version DESC, created_at DESC LIMIT 1 FOR SHARE`
        );
        const values = new Map(settings.map((row) => [row.setting_key, row.setting_value]));
        const heartbeatAt = Date.parse(values.get('browser_worker_heartbeat_at') || '');
        const workerFresh = Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt <= 60_000;
        if (values.get('browser_dispatch_enabled') !== 'true'
          || profiles.length !== 1 || !workerFresh) {
          throw new PublicApiError('Browser recharge is not ready', {
            code: 'BROWSER_RECHARGE_NOT_READY', status: 409
          });
        }
      }
      const target = candidates[0];
      if (previous?.id === target.id) {
        await connection.commit();
        return { method: selectedMethod, routeId: target.id, changed: false, eventId: null, checks };
      }
      await connection.query(
        `UPDATE fulfillment_routes SET accepts_new_orders = 0 WHERE product_id = ?`, [product.id]
      );
      const [updated] = await connection.query(
        `UPDATE fulfillment_routes SET accepts_new_orders = 1
         WHERE id = ? AND retired_at IS NULL`, [target.id]
      );
      if (updated.affectedRows !== 1) {
        throw new PublicApiError('Default recharge route changed concurrently', {
          code: 'DEFAULT_RECHARGE_ROUTE_CONFLICT', status: 409
        });
      }
      const eventId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO provider_route_switch_events
         (id, route_id, previous_route_id, actor_id, operator_note)
         VALUES (?, ?, ?, ?, ?)`,
        [eventId, target.id, previous?.id || null, actor,
          `默认充值方式切换为 ${selectedMethod}；仅影响切换后新建订单；四项校验通过`]
      );
      await connection.commit();
      return {
        method: selectedMethod,
        routeId: target.id,
        previousRouteId: previous?.id || null,
        changed: true,
        eventId,
        checks
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { list, setDefaultRechargeMethod };
}
