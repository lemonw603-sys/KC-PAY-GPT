import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';

function note(value) {
  const text = String(value || '').trim();
  if (text.length < 10) throw new PublicApiError('Route switch note is required', {
    code: 'ROUTE_SWITCH_NOTE_REQUIRED', status: 400
  });
  return text.slice(0, 2000);
}

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
              pa.id AS card_provider_account_id, pa.account_code, pa.read_enabled,
              pa.write_enabled, pa.circuit_state, pa.retry_after_until
       FROM fulfillment_routes fr
       INNER JOIN products p ON p.id = fr.product_id
       LEFT JOIN provider_accounts pa ON pa.id = fr.card_provider_account_id
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

  async function switchRoute({ routeId, actorId, operatorNote, confirmation }) {
    const id = String(routeId || '').trim();
    const actor = String(actorId || '').trim() || 'admin';
    const text = note(operatorNote);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT fr.id, fr.route_code, fr.route_version, fr.accepts_new_orders,
                pa.read_enabled, pa.circuit_state, pa.retry_after_until
         FROM fulfillment_routes fr
         INNER JOIN products p ON p.id = fr.product_id
         INNER JOIN provider_accounts pa ON pa.id = fr.card_provider_account_id
         WHERE fr.id = ? AND p.product_code = 'chatgpt_plus'
         LIMIT 1 FOR UPDATE`, [id]
      );
      const route = rows[0];
      if (!route) throw new PublicApiError('Provider route not found', { code: 'ROUTE_NOT_FOUND', status: 404 });
      const expected = `切换卡台 ${route.route_code}:${route.route_version}`;
      if (String(confirmation || '').trim() !== expected) {
        throw new PublicApiError('Route switch confirmation mismatch', {
          code: 'ROUTE_SWITCH_CONFIRMATION_REQUIRED', status: 400
        });
      }
      if (!route.read_enabled || route.circuit_state !== 'CLOSED'
        || (route.retry_after_until && new Date(route.retry_after_until) > new Date())) {
        throw new PublicApiError('Provider route is not healthy for new orders', {
          code: 'ROUTE_NOT_HEALTHY', status: 409
        });
      }
      const [active] = await connection.query(
        `SELECT id FROM fulfillment_routes
         WHERE product_id = (SELECT product_id FROM fulfillment_routes WHERE id = ?)
           AND accepts_new_orders = 1 AND retired_at IS NULL
         ORDER BY route_version DESC LIMIT 1 FOR UPDATE`, [id]
      );
      const previousId = active[0]?.id || null;
      await connection.query(
        `UPDATE fulfillment_routes SET accepts_new_orders = 0
         WHERE product_id = (SELECT product_id FROM fulfillment_routes WHERE id = ?)`, [id]
      );
      await connection.query(
        `UPDATE fulfillment_routes SET accepts_new_orders = 1 WHERE id = ?`, [id]
      );
      const eventId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO provider_route_switch_events
         (id, route_id, previous_route_id, actor_id, operator_note)
         VALUES (?, ?, ?, ?, ?)`, [eventId, id, previousId === id ? null : previousId, actor, text]
      );
      await connection.commit();
      return { routeId: id, previousRouteId: previousId === id ? null : previousId, eventId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function setDefaultRechargeMethod({ method, actorId, confirmation }) {
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
      const [routes] = await connection.query(
        `SELECT fr.id, fr.executor_kind, fr.accepts_new_orders
         FROM fulfillment_routes fr
         INNER JOIN products p ON p.id = fr.product_id
         WHERE p.product_code = 'chatgpt_plus' AND p.status = 'ACTIVE'
           AND fr.retired_at IS NULL
         ORDER BY fr.route_version DESC, fr.created_at DESC
         FOR UPDATE`
      );
      const candidates = routes.filter((route) => route.executor_kind === selectedMethod);
      if (candidates.length !== 1) {
        throw new PublicApiError('Default recharge route is unavailable', {
          code: 'DEFAULT_RECHARGE_ROUTE_UNAVAILABLE', status: 409
        });
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
      const previous = routes.find((route) => Number(route.accepts_new_orders) === 1) || null;
      if (previous?.id === target.id) {
        await connection.commit();
        return { method: selectedMethod, routeId: target.id, changed: false, eventId: null };
      }
      await connection.query(
        `UPDATE fulfillment_routes fr
         INNER JOIN products p ON p.id = fr.product_id
         SET fr.accepts_new_orders = 0
         WHERE p.product_code = 'chatgpt_plus'`,
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
          `默认充值方式切换为 ${selectedMethod}；仅影响切换后新建订单`]
      );
      await connection.commit();
      return {
        method: selectedMethod,
        routeId: target.id,
        previousRouteId: previous?.id || null,
        changed: true,
        eventId
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { list, switchRoute, setDefaultRechargeMethod };
}
