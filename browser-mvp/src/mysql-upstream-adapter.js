import { createHash } from 'node:crypto';

import { projectUpstreamBrowserJob } from './shared-contract-adapter.js';

/**
 * One bounded read of the already-created shared Browser run. This replaces
 * the retired browser_upstream_ready_projection view and never invents
 * PENDING/OBSERVING, AVAILABLE, readiness TTL, or an independent audit_ref.
 *
 * Session ciphertext and card credentials are intentionally obtained by
 * separate controlled runtime providers and never selected into this job.
 */
export const BROWSER_UPSTREAM_PROJECTION_SQL = `
SELECT
  br.id AS run_id,
  br.status AS run_status,
  br.payment_state,
  br.executor_profile_id AS profile_id,
  rat.id AS attempt_id,
  rat.status AS attempt_status,
  rat.funds_risk_state,
  rat.executor_kind AS attempt_executor_kind,
  rat.executor_profile_id AS attempt_profile_id,
  rat.fulfillment_route_id AS attempt_fulfillment_route_id,
  o.id AS order_id,
  o.status AS order_status,
  o.fulfillment_route_id AS order_fulfillment_route_id,
  c.id AS card_id,
  c.order_id AS card_order_id,
  c.provider_card_id AS provider_card_ref,
  c.provider_account_id AS card_provider_account_id,
  ccl.id AS card_consumption_id,
  ccl.status AS card_consumption_status,
  ccl.recharge_attempt_id AS card_consumption_attempt_id,
  ccl.order_id AS card_consumption_order_id,
  ccl.card_id AS card_consumption_card_id,
  fr.id AS route_id,
  fr.executor_kind AS route_executor_kind,
  fr.card_provider_account_id AS route_card_provider_account_id
FROM browser_runs br
INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
INNER JOIN orders o ON o.id = rat.order_id
INNER JOIN cards c ON c.order_id = o.id
LEFT JOIN card_consumption_ledger ccl ON ccl.recharge_attempt_id = rat.id
INNER JOIN fulfillment_routes fr ON fr.id = rat.fulfillment_route_id
WHERE br.id = ?
LIMIT 1`;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function rowToProjection(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Browser shared runtime row is invalid');
  }
  for (const key of [
    'card_credentials_ciphertext', 'card_number_ciphertext', 'pan', 'cvv', 'cvc',
    'session_ciphertext', 'session_ref', 'access_token', 'api_key', 'audit_ref',
  ]) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      throw new Error(`forbidden shared runtime column returned: ${key}`);
    }
  }
  return {
    order: {
      id: required(row.order_id, 'order_id'),
      status: required(row.order_status, 'order_status'),
      fulfillmentRouteId: required(row.order_fulfillment_route_id, 'order_fulfillment_route_id'),
    },
    attempt: {
      id: required(row.attempt_id, 'attempt_id'),
      status: required(row.attempt_status, 'attempt_status'),
      fundsRiskState: required(row.funds_risk_state, 'funds_risk_state'),
      executorKind: required(row.attempt_executor_kind, 'attempt_executor_kind'),
      executorProfileId: required(row.attempt_profile_id, 'attempt_profile_id'),
      fulfillmentRouteId: required(row.attempt_fulfillment_route_id, 'attempt_fulfillment_route_id'),
    },
    profile: { id: required(row.profile_id, 'profile_id') },
    run: {
      id: required(row.run_id, 'run_id'),
      attemptId: required(row.attempt_id, 'attempt_id'),
      status: required(row.run_status, 'run_status'),
      paymentState: required(row.payment_state, 'payment_state'),
    },
    card: {
      id: required(row.card_id, 'card_id'),
      orderId: required(row.card_order_id, 'card_order_id'),
      ...(row.provider_card_ref == null
        ? {}
        : { providerCardRef: required(row.provider_card_ref, 'provider_card_ref') }),
      providerAccountId: required(row.card_provider_account_id, 'card_provider_account_id'),
    },
    cardConsumption: {
      id: required(row.card_consumption_id, 'card_consumption_id'),
      status: required(row.card_consumption_status, 'card_consumption_status'),
      attemptId: required(row.card_consumption_attempt_id, 'card_consumption_attempt_id'),
      orderId: required(row.card_consumption_order_id, 'card_consumption_order_id'),
      cardId: required(row.card_consumption_card_id, 'card_consumption_card_id'),
    },
    route: {
      id: required(row.route_id, 'route_id'),
      executorKind: required(row.route_executor_kind, 'route_executor_kind'),
      cardProviderAccountId: required(row.route_card_provider_account_id, 'route_card_provider_account_id'),
    },
  };
}

/**
 * Builds a read-only adapter over a mysql2-like pool. It runs after beginRun(),
 * reads by browser_run.id exactly once, and delegates formal state/binding
 * checks to projectUpstreamBrowserJob().
 */
export function createMysqlUpstreamProjectionAdapter({ db, sql = BROWSER_UPSTREAM_PROJECTION_SQL } = {}) {
  if (!db || (typeof db.execute !== 'function' && typeof db.query !== 'function')) {
    throw new TypeError('db must expose execute(sql, params) or query(sql, params)');
  }
  const runQuery = db.execute?.bind(db) || db.query.bind(db);
  return Object.freeze({
    async load({ runId, manifest, observation, sessionRef = null } = {}) {
      const id = required(runId, 'runId');
      const [rows] = await runQuery(sql, [id]);
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error(rows?.length === 0 ? 'Browser shared runtime not found' : 'Browser shared runtime is ambiguous');
      }
      const projection = {
        ...rowToProjection(rows[0]),
        ...(observation == null ? {} : { observation }),
      };
      const job = projectUpstreamBrowserJob(projection, { manifest, sessionRef });
      return { projection, job, sourceDigest: sha256(JSON.stringify(rows[0])) };
    },
  });
}
