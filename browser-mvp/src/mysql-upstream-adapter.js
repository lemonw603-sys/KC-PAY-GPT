import { createHash } from 'node:crypto';

import { projectUpstreamBrowserJob } from './shared-contract-adapter.js';

/**
 * Read-only SQL contract for the Browser boundary.
 *
 * The view is intentionally not created here: its schema belongs to the
 * shared/non-Browser owner and must be frozen there first. Until that happens,
 * a real MySQL connection fails closed with ER_NO_SUCH_TABLE rather than
 * guessing a mapping from tasks/provider_calls or reading card credentials.
 */
export const BROWSER_UPSTREAM_PROJECTION_SQL = `
SELECT
  order_id,
  order_status,
  attempt_id,
  attempt_status,
  profile_id,
  card_ref,
  provider_card_ref,
  card_route_ref,
  card_provider_account_ref,
  card_inventory_status,
  card_readiness_status,
  card_readiness_digest,
  card_readiness_observed_at,
  card_readiness_valid_until,
  route_ref,
  route_card_provider_ref,
  route_executor_kind,
  route_status,
  session_ref,
  audit_ref
FROM browser_upstream_ready_projection
WHERE attempt_id = ?
LIMIT 1`;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function dateMs(value, name) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  if (!Number.isFinite(ms)) throw new Error(`${name} must be a valid timestamp`);
  return ms;
}

function rowToProjection(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Browser upstream projection row is invalid');
  }
  for (const key of ['card_credentials_ciphertext', 'card_number_ciphertext', 'pan', 'cvv', 'session_ciphertext', 'access_token', 'api_key']) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      throw new Error(`forbidden upstream column returned: ${key}`);
    }
  }
  // Only aliases from the read-only view are copied. No wildcard SELECT and
  // no card/session credential columns are accepted at this boundary.
  const projection = {
    order: { id: required(row.order_id, 'order_id'), status: required(row.order_status, 'order_status') },
    attempt: { id: required(row.attempt_id, 'attempt_id'), status: required(row.attempt_status, 'attempt_status') },
    profile: { id: required(row.profile_id, 'profile_id') },
    card: {
      ref: required(row.card_ref, 'card_ref'),
      ...(row.provider_card_ref == null ? {} : { providerCardRef: required(row.provider_card_ref, 'provider_card_ref') }),
      routeRef: required(row.card_route_ref, 'card_route_ref'),
      providerAccountRef: required(row.card_provider_account_ref, 'card_provider_account_ref'),
      inventoryStatus: required(row.card_inventory_status, 'card_inventory_status'),
      readiness: {
        status: required(row.card_readiness_status, 'card_readiness_status'),
        evidenceDigest: required(row.card_readiness_digest, 'card_readiness_digest'),
        observedAt: dateMs(row.card_readiness_observed_at, 'card_readiness_observed_at'),
        validUntil: dateMs(row.card_readiness_valid_until, 'card_readiness_valid_until'),
      },
    },
    route: {
      ref: required(row.route_ref, 'route_ref'),
      cardProviderRef: required(row.route_card_provider_ref, 'route_card_provider_ref'),
      executorKind: required(row.route_executor_kind, 'route_executor_kind'),
      status: required(row.route_status, 'route_status'),
    },
    ...(row.session_ref == null ? {} : { sessionRef: required(row.session_ref, 'session_ref') }),
    ...(row.audit_ref == null ? {} : { auditRef: required(row.audit_ref, 'audit_ref') }),
    fundsGate: { status: 'NOT_REQUESTED' },
  };
  return projection;
}

/**
 * Builds a read-only adapter over a mysql2-like pool. The adapter performs
 * exactly one bounded SELECT per load and then delegates all safety checks to
 * projectUpstreamBrowserJob(). It has no write method by design.
 */
export function createMysqlUpstreamProjectionAdapter({ db, sql = BROWSER_UPSTREAM_PROJECTION_SQL } = {}) {
  if (!db || (typeof db.execute !== 'function' && typeof db.query !== 'function')) {
    throw new TypeError('db must expose execute(sql, params) or query(sql, params)');
  }
  const runQuery = db.execute?.bind(db) || db.query.bind(db);
  return Object.freeze({
    async load({ attemptId, now = Date.now(), manifest } = {}) {
      const id = required(attemptId, 'attemptId');
      const [rows] = await runQuery(sql, [id]);
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error(rows?.length === 0 ? 'Browser upstream projection not found' : 'Browser upstream projection is ambiguous');
      }
      const projection = rowToProjection(rows[0]);
      const projected = projectUpstreamBrowserJob(projection, { now, manifest });
      return {
        projection,
        job: projected,
        sourceDigest: sha256(JSON.stringify(rows[0])),
      };
    },
  });
}

export { rowToProjection };
