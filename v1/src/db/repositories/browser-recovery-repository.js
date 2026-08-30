import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';

const HEX_64 = /^[a-f0-9]{64}$/i;
const SAFE_PAYMENT_STATES = new Set(['NOT_STARTED', 'PAYMENT_ARMED']);
const ACTIVE_RUN_STATUSES = new Set(['READY', 'RUNNING', 'HUMAN_REQUIRED']);
const HOSTED_HOSTS = new Set(['pay.openai.com', 'checkout.stripe.com']);
const CHECKOUT_ID_PATTERN = /^(?:cs_(?:live|test)_[A-Za-z0-9_-]+|oaics_[A-Za-z0-9_-]+)$/;
const DESTROY_REASONS = new Set([
  'DEFINITE_PROCESSOR_INVALIDATION',
  'EXPERIMENT_CLEANUP_BEFORE_PAYMENT',
  'RETENTION_EXPIRED_AFTER_TERMINAL_REVIEW'
]);

export class BrowserRecoveryError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'BrowserRecoveryError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BrowserRecoveryError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

function requireDigest(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (!HEX_64.test(normalized)) {
    throw new BrowserRecoveryError(`${name} must be a 64-character hex digest`, 'INVALID_ARGUMENT');
  }
  return normalized;
}

function requireKey(value, name) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new BrowserRecoveryError(`${name} must be a 32-byte Buffer`, 'INVALID_KEY');
  }
  return Buffer.from(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function hashSecret(value) {
  return sha256(required(value, 'secret'));
}

function equalDigest(left, right) {
  if (!HEX_64.test(String(left || '')) || !HEX_64.test(String(right || ''))) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function resourceDigest(key, resourceType, rawKey) {
  return createHmac('sha256', key)
    .update(`${resourceType}:${required(rawKey, 'resourceKey')}`)
    .digest('hex');
}

function parseCheckoutAuthority(rawValue) {
  let url;
  try {
    url = new URL(required(rawValue, 'navigationUrl'));
  } catch {
    throw new BrowserRecoveryError('Checkout authority is malformed', 'INVALID_CHECKOUT_ARTIFACT');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new BrowserRecoveryError('Checkout authority is unsafe', 'INVALID_CHECKOUT_ARTIFACT');
  }
  const host = url.hostname.toLowerCase();
  if (HOSTED_HOSTS.has(host)) {
    const match = url.pathname.match(/^\/c\/pay\/(cs_(?:live|test)_[A-Za-z0-9_-]+)\/?$/);
    if (!match || !url.hash || url.hash.length < 2) {
      throw new BrowserRecoveryError('Hosted Checkout authority is incomplete', 'INVALID_CHECKOUT_ARTIFACT');
    }
    return { kind: 'HOSTED_COMPLETE', checkoutHash: sha256(match[1]), normalizedUrl: url.href };
  }
  if (host === 'chatgpt.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const checkoutId = parts.at(-1);
    if (parts[0] !== 'checkout' || ![2, 3].includes(parts.length)
      || !CHECKOUT_ID_PATTERN.test(checkoutId || '')) {
      throw new BrowserRecoveryError('Internal Checkout authority is invalid', 'INVALID_CHECKOUT_ARTIFACT');
    }
    return { kind: 'INTERNAL_SESSION_BOUND', checkoutHash: sha256(checkoutId), normalizedUrl: url.href };
  }
  throw new BrowserRecoveryError('Checkout host is not approved', 'INVALID_CHECKOUT_ARTIFACT');
}

function artifactAad({ secretRef, runId, accountKeyHmac, kind, expiresAt }) {
  return Buffer.from(JSON.stringify([
    secretRef,
    runId,
    accountKeyHmac,
    kind,
    expiresAt.toISOString()
  ]), 'utf8');
}

async function inTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockRunResources(connection, runId) {
  const [rows] = await connection.query(
    `SELECT br.id AS run_id, br.status AS run_status, br.payment_state,
            br.account_key_hmac, br.worker_id, br.worker_lease_token_hash,
            br.worker_lease_until, br.control_state, br.automation_owner_id,
            rat.id AS attempt_id, rat.order_id, rat.funds_risk_state,
            o.status AS order_status, c.id AS card_id,
            ca.id AS active_artifact_id
     FROM browser_runs br
     INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
     INNER JOIN orders o ON o.id = rat.order_id
     LEFT JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
     LEFT JOIN checkout_artifacts ca
       ON ca.browser_run_id = br.id AND ca.status IN ('ACTIVE', 'REVIEW_REQUIRED')
     WHERE br.id = ?
     FOR UPDATE`,
    [runId]
  );
  if (rows.length !== 1) throw new BrowserRecoveryError('browser run not found', 'RUN_NOT_FOUND');
  if (!rows[0].card_id) throw new BrowserRecoveryError('run order has no card', 'CARD_NOT_READY');
  return rows[0];
}

function assertWorkerLease(row, { ownerId, leaseToken, now }) {
  if (row.worker_id !== ownerId
    || !equalDigest(row.worker_lease_token_hash, hashSecret(leaseToken))) {
    throw new BrowserRecoveryError('run lease is not owned by this worker', 'LEASE_NOT_OWNED');
  }
  if (!row.worker_lease_until || new Date(row.worker_lease_until).getTime() <= now.getTime()) {
    throw new BrowserRecoveryError('run lease expired', 'LEASE_EXPIRED');
  }
}

function assertAutomationControl(row, ownerId) {
  if (row.control_state !== 'AUTOMATION' || row.automation_owner_id !== ownerId) {
    throw new BrowserRecoveryError('automation does not own Browser control', 'CONTROL_NOT_OWNED');
  }
}

function baseResources(row, resourceHmacKey) {
  return [
    { type: 'ACCOUNT', digest: requireDigest(row.account_key_hmac, 'accountKeyHmac') },
    { type: 'ORDER', digest: resourceDigest(resourceHmacKey, 'ORDER', row.order_id) },
    { type: 'CARD', digest: resourceDigest(resourceHmacKey, 'CARD', row.card_id) },
    ...(row.active_artifact_id ? [{
      type: 'CHECKOUT_ARTIFACT',
      digest: resourceDigest(resourceHmacKey, 'CHECKOUT_ARTIFACT', row.active_artifact_id)
    }] : [])
  ];
}

async function acquireResource(connection, {
  runId, ownerId, tokenHash, resource, leaseUntil, now
}) {
  const activeResourceKey = `${resource.type}:${resource.digest}`;
  const [rows] = await connection.query(
    `SELECT id
     FROM execution_resource_leases
     WHERE active_resource_key = ?`,
    [activeResourceKey]
  );
  if (rows.length) {
    const [lockedRows] = await connection.query(
      `SELECT id, browser_run_id, owner_id, lease_token_hash, lease_until, released_at
       FROM execution_resource_leases
       WHERE id = ? FOR UPDATE`,
      [rows[0].id]
    );
    const current = lockedRows[0];
    if (current && !current.released_at) {
      const currentUntil = new Date(current.lease_until).getTime();
      if (current.browser_run_id === runId && current.owner_id === ownerId
        && equalDigest(current.lease_token_hash, tokenHash)) {
        if (currentUntil <= now.getTime()) {
          throw new BrowserRecoveryError('resource lease already expired', 'LEASE_EXPIRED');
        }
        await connection.query(
          `UPDATE execution_resource_leases
           SET lease_until = ?, heartbeat_at = ?
           WHERE id = ? AND released_at IS NULL`,
          [leaseUntil, now, current.id]
        );
        return current.id;
      }
      if (currentUntil > now.getTime()) {
        throw new BrowserRecoveryError('resource is owned by another live worker', 'RESOURCE_BUSY', {
          resourceType: resource.type
        });
      }
      await connection.query(
        `UPDATE execution_resource_leases
         SET released_at = ?, release_reason = 'EXPIRED_TAKEOVER'
         WHERE id = ? AND released_at IS NULL AND lease_until <= ?`,
        [now, current.id, now]
      );
    }
  }
  const leaseId = randomUUID();
  try {
    await connection.query(
      `INSERT INTO execution_resource_leases
       (id, resource_type, resource_key_hmac, browser_run_id, owner_id,
        lease_token_hash, lease_until, acquired_at, heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [leaseId, resource.type, resource.digest, runId, ownerId,
        tokenHash, leaseUntil, now, now]
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new BrowserRecoveryError('resource was claimed concurrently', 'RESOURCE_BUSY', {
        resourceType: resource.type
      });
    }
    throw error;
  }
  return leaseId;
}

async function assertResourceLeases(connection, {
  row, resourceHmacKey, ownerId, tokenHash, now
}) {
  const resources = baseResources(row, resourceHmacKey);
  const [leases] = await connection.query(
    `SELECT resource_type, resource_key_hmac, owner_id, lease_token_hash, lease_until
     FROM execution_resource_leases
     WHERE browser_run_id = ? AND released_at IS NULL
     FOR UPDATE`,
    [row.run_id]
  );
  for (const resource of resources) {
    const lease = leases.find((item) => item.resource_type === resource.type
      && item.resource_key_hmac === resource.digest);
    if (!lease || lease.owner_id !== ownerId
      || !equalDigest(lease.lease_token_hash, tokenHash)) {
      throw new BrowserRecoveryError('required resource lease is not owned', 'RESOURCE_LEASE_NOT_OWNED', {
        resourceType: resource.type
      });
    }
    if (new Date(lease.lease_until).getTime() <= now.getTime()) {
      throw new BrowserRecoveryError('required resource lease expired', 'LEASE_EXPIRED', {
        resourceType: resource.type
      });
    }
  }
  return resources;
}

export function createBrowserRecoveryRepository(pool, {
  artifactKeys,
  currentArtifactKeyVersion,
  resourceHmacKey
}) {
  const resourceKey = requireKey(resourceHmacKey, 'resourceHmacKey');
  if (!(artifactKeys instanceof Map) || artifactKeys.size === 0) {
    throw new BrowserRecoveryError('artifactKeys must be a non-empty Map', 'INVALID_KEY');
  }
  const keys = new Map();
  for (const [version, key] of artifactKeys.entries()) {
    const normalizedVersion = Number(version);
    if (!Number.isInteger(normalizedVersion) || normalizedVersion < 1 || normalizedVersion > 65535) {
      throw new BrowserRecoveryError('artifact key version is invalid', 'INVALID_KEY');
    }
    keys.set(normalizedVersion, requireKey(key, `artifactKeys.${normalizedVersion}`));
  }
  const currentVersion = Number(currentArtifactKeyVersion);
  if (!keys.has(currentVersion)) {
    throw new BrowserRecoveryError('current artifact key version is unavailable', 'INVALID_KEY');
  }

  return {
    async acquireRunResources({
      runId, ownerId, leaseToken, ttlSeconds = 60, now = new Date()
    }) {
      const run = required(runId, 'runId');
      const owner = required(ownerId, 'ownerId');
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 10 || ttlSeconds > 3600) {
        throw new BrowserRecoveryError('ttlSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockRunResources(connection, run);
        assertWorkerLease(row, { ownerId: owner, leaseToken, now });
        assertAutomationControl(row, owner);
        if (!ACTIVE_RUN_STATUSES.has(row.run_status) || !SAFE_PAYMENT_STATES.has(row.payment_state)) {
          throw new BrowserRecoveryError('run cannot acquire mutable resources', 'RECONCILE_ONLY');
        }
        const tokenHash = hashSecret(leaseToken);
        const leaseUntil = new Date(now.getTime() + ttlSeconds * 1000);
        const resources = baseResources(row, resourceKey);
        for (const resource of resources) {
          await acquireResource(connection, {
            runId: run, ownerId: owner, tokenHash, resource, leaseUntil, now
          });
        }
        await connection.query(
          `UPDATE browser_runs SET worker_lease_until = ?, updated_at = ?
           WHERE id = ? AND worker_id = ? AND worker_lease_token_hash = ?`,
          [leaseUntil, now, run, owner, tokenHash]
        );
        return { runId: run, ownerId: owner, leaseUntil, resourceTypes: resources.map((item) => item.type) };
      });
    },

    async heartbeatRunResources({
      runId, ownerId, leaseToken, ttlSeconds = 60, now = new Date()
    }) {
      const run = required(runId, 'runId');
      const owner = required(ownerId, 'ownerId');
      const tokenHash = hashSecret(leaseToken);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 10 || ttlSeconds > 3600) {
        throw new BrowserRecoveryError('ttlSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockRunResources(connection, run);
        assertWorkerLease(row, { ownerId: owner, leaseToken, now });
        const resources = await assertResourceLeases(connection, {
          row, resourceHmacKey: resourceKey, ownerId: owner, tokenHash, now
        });
        const leaseUntil = new Date(now.getTime() + ttlSeconds * 1000);
        const [leaseUpdate] = await connection.query(
          `UPDATE execution_resource_leases
           SET lease_until = ?, heartbeat_at = ?
           WHERE browser_run_id = ? AND owner_id = ? AND lease_token_hash = ?
             AND released_at IS NULL AND lease_until > ?`,
          [leaseUntil, now, run, owner, tokenHash, now]
        );
        if (Number(leaseUpdate.affectedRows) !== resources.length) {
          throw new BrowserRecoveryError('resource lease set changed concurrently', 'RESOURCE_LEASE_CONFLICT');
        }
        const [runUpdate] = await connection.query(
          `UPDATE browser_runs SET worker_lease_until = ?, updated_at = ?
           WHERE id = ? AND worker_id = ? AND worker_lease_token_hash = ?
             AND worker_lease_until > ?`,
          [leaseUntil, now, run, owner, tokenHash, now]
        );
        if (runUpdate.affectedRows !== 1) {
          throw new BrowserRecoveryError('run lease changed concurrently', 'LEASE_CONFLICT');
        }
        return { runId: run, leaseUntil, resourceCount: resources.length };
      });
    },

    async recoverExpiredRun({
      runId, newOwnerId, ttlSeconds = 60, now = new Date()
    }) {
      const run = required(runId, 'runId');
      const owner = required(newOwnerId, 'newOwnerId');
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 10 || ttlSeconds > 3600) {
        throw new BrowserRecoveryError('ttlSeconds must be between 10 and 3600', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockRunResources(connection, run);
        const [paymentOperations] = await connection.query(
          `SELECT id FROM browser_operations
           WHERE browser_run_id = ? AND operation_type = 'PAYMENT_SUBMIT'
             AND status IN ('COMMITTED', 'OUTCOME_UNKNOWN')
           LIMIT 1 FOR UPDATE`,
          [run]
        );
        if (paymentOperations.length || !SAFE_PAYMENT_STATES.has(row.payment_state)
          || row.funds_risk_state === 'UNKNOWN') {
          await connection.query(
            `UPDATE browser_runs
             SET status = 'RECONCILE_ONLY', updated_at = ?
             WHERE id = ? AND status IN ('READY', 'RUNNING', 'HUMAN_REQUIRED', 'RECONCILE_ONLY')`,
            [now, run]
          );
          return { runId: run, recoveryMode: 'RECONCILE_ONLY', leaseToken: null };
        }
        if (row.control_state !== 'AUTOMATION') {
          await connection.query(
            `UPDATE browser_runs
             SET status = 'HUMAN_REQUIRED', updated_at = ?
             WHERE id = ? AND status IN ('READY', 'RUNNING', 'HUMAN_REQUIRED')`,
            [now, run]
          );
          return { runId: run, recoveryMode: 'HUMAN_REQUIRED', leaseToken: null };
        }
        if (row.worker_lease_until && new Date(row.worker_lease_until).getTime() > now.getTime()) {
          throw new BrowserRecoveryError('run lease is still live', 'RESOURCE_BUSY');
        }
        const [liveLeases] = await connection.query(
          `SELECT id FROM execution_resource_leases
           WHERE browser_run_id = ? AND released_at IS NULL AND lease_until > ?
           FOR UPDATE`,
          [run, now]
        );
        if (liveLeases.length) {
          throw new BrowserRecoveryError('resource lease is still live', 'RESOURCE_BUSY');
        }
        await connection.query(
          `UPDATE execution_resource_leases
           SET released_at = ?, release_reason = 'EXPIRED_TAKEOVER'
           WHERE browser_run_id = ? AND released_at IS NULL AND lease_until <= ?`,
          [now, run, now]
        );

        const leaseToken = randomBytes(32).toString('hex');
        const tokenHash = hashSecret(leaseToken);
        const leaseUntil = new Date(now.getTime() + ttlSeconds * 1000);
        const [runUpdate] = await connection.query(
          `UPDATE browser_runs
           SET status = 'RUNNING', worker_id = ?, worker_lease_token_hash = ?,
               worker_lease_until = ?, automation_owner_id = ?, updated_at = ?
           WHERE id = ? AND worker_lease_until <= ?
             AND payment_state IN ('NOT_STARTED', 'PAYMENT_ARMED')`,
          [owner, tokenHash, leaseUntil, owner, now, run, now]
        );
        if (runUpdate.affectedRows !== 1) {
          throw new BrowserRecoveryError('run changed during takeover', 'LEASE_CONFLICT');
        }
        const resources = baseResources(row, resourceKey);
        for (const resource of resources) {
          await acquireResource(connection, {
            runId: run, ownerId: owner, tokenHash, resource, leaseUntil, now
          });
        }
        return {
          runId: run,
          recoveryMode: row.active_artifact_id ? 'RESUME_EXISTING_ARTIFACT' : 'RESUMABLE',
          leaseToken,
          leaseUntil,
          resourceTypes: resources.map((item) => item.type)
        };
      });
    },

    async storeCheckoutArtifact({
      runId,
      ownerId,
      leaseToken,
      navigationUrl,
      artifactId = randomUUID(),
      ttlSeconds = 1200,
      now = new Date()
    }) {
      const run = required(runId, 'runId');
      const owner = required(ownerId, 'ownerId');
      const parsed = parseCheckoutAuthority(navigationUrl);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
        throw new BrowserRecoveryError('artifact ttlSeconds must be between 60 and 3600', 'INVALID_ARGUMENT');
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockRunResources(connection, run);
        assertWorkerLease(row, { ownerId: owner, leaseToken, now });
        assertAutomationControl(row, owner);
        if (!ACTIVE_RUN_STATUSES.has(row.run_status) || !SAFE_PAYMENT_STATES.has(row.payment_state)) {
          throw new BrowserRecoveryError('run cannot create a Checkout artifact', 'RECONCILE_ONLY');
        }
        if (row.active_artifact_id) {
          throw new BrowserRecoveryError('run already owns an active Checkout artifact', 'ACTIVE_CHECKOUT_EXISTS');
        }
        const tokenHash = hashSecret(leaseToken);
        await assertResourceLeases(connection, {
          row, resourceHmacKey: resourceKey, ownerId: owner, tokenHash, now
        });

        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
        const secretRef = `vault://${artifactId}`;
        const aad = artifactAad({
          secretRef, runId: run, accountKeyHmac: row.account_key_hmac,
          kind: parsed.kind, expiresAt
        });
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', keys.get(currentVersion), iv);
        cipher.setAAD(aad);
        const ciphertext = Buffer.concat([
          cipher.update(parsed.normalizedUrl, 'utf8'),
          cipher.final()
        ]);
        const authTag = cipher.getAuthTag();
        await connection.query(
          `INSERT INTO browser_artifact_secrets
           (secret_ref, browser_run_id, key_version, iv, auth_tag, ciphertext,
            expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [secretRef, run, currentVersion, iv, authTag, ciphertext, expiresAt, now]
        );
        await connection.query(
          `INSERT INTO checkout_artifacts
           (id, browser_run_id, account_key_hmac, artifact_kind, status,
            secret_ref, url_hash, checkout_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
          [artifactId, run, row.account_key_hmac, parsed.kind, secretRef,
            sha256(parsed.normalizedUrl), parsed.checkoutHash, now, expiresAt]
        );
        const artifactResource = {
          type: 'CHECKOUT_ARTIFACT',
          digest: resourceDigest(resourceKey, 'CHECKOUT_ARTIFACT', artifactId)
        };
        const runLeaseUntil = new Date(row.worker_lease_until);
        await acquireResource(connection, {
          runId: run,
          ownerId: owner,
          tokenHash,
          resource: artifactResource,
          leaseUntil: runLeaseUntil,
          now
        });
        return {
          artifactId,
          secretRef,
          kind: parsed.kind,
          urlHash: sha256(parsed.normalizedUrl),
          checkoutHash: parsed.checkoutHash,
          expiresAt
        };
      });
    },

    async revealCheckoutArtifact({ runId, artifactId, ownerId, leaseToken, now = new Date() }) {
      const run = required(runId, 'runId');
      const artifact = required(artifactId, 'artifactId');
      const owner = required(ownerId, 'ownerId');
      return inTransaction(pool, async (connection) => {
        const row = await lockRunResources(connection, run);
        assertWorkerLease(row, { ownerId: owner, leaseToken, now });
        assertAutomationControl(row, owner);
        if (!SAFE_PAYMENT_STATES.has(row.payment_state)) {
          throw new BrowserRecoveryError('Checkout authority is unavailable after submission', 'RECONCILE_ONLY');
        }
        const tokenHash = hashSecret(leaseToken);
        await assertResourceLeases(connection, {
          row, resourceHmacKey: resourceKey, ownerId: owner, tokenHash, now
        });
        const [records] = await connection.query(
          `SELECT ca.id, ca.account_key_hmac, ca.artifact_kind, ca.status,
                  ca.secret_ref, ca.url_hash, ca.expires_at,
                  bas.key_version, bas.iv, bas.auth_tag, bas.ciphertext,
                  bas.destroyed_at
           FROM checkout_artifacts ca
           INNER JOIN browser_artifact_secrets bas ON bas.secret_ref = ca.secret_ref
           WHERE ca.id = ? AND ca.browser_run_id = ?
           FOR UPDATE`,
          [artifact, run]
        );
        if (records.length !== 1) {
          throw new BrowserRecoveryError('Checkout artifact not found', 'ARTIFACT_NOT_FOUND');
        }
        const record = records[0];
        if (record.status !== 'ACTIVE' || record.destroyed_at || !record.ciphertext) {
          throw new BrowserRecoveryError('Checkout artifact is not active', 'ARTIFACT_NOT_ACTIVE');
        }
        const expiresAt = new Date(record.expires_at);
        if (expiresAt.getTime() <= now.getTime()) {
          await connection.query(
            `UPDATE checkout_artifacts SET status = 'REVIEW_REQUIRED'
             WHERE id = ? AND status = 'ACTIVE'`,
            [artifact]
          );
          return {
            artifactId: artifact,
            navigationUrl: null,
            reviewRequired: true,
            reasonCode: 'EXPIRY_IS_NOT_INVALIDATION_PROOF'
          };
        }
        const key = keys.get(Number(record.key_version));
        if (!key) throw new BrowserRecoveryError('artifact key version is unavailable', 'ARTIFACT_KEY_UNAVAILABLE');
        const aad = artifactAad({
          secretRef: record.secret_ref,
          runId: run,
          accountKeyHmac: record.account_key_hmac,
          kind: record.artifact_kind,
          expiresAt
        });
        let plaintext;
        try {
          const decipher = createDecipheriv('aes-256-gcm', key, record.iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(record.auth_tag);
          plaintext = Buffer.concat([
            decipher.update(record.ciphertext),
            decipher.final()
          ]).toString('utf8');
        } catch {
          throw new BrowserRecoveryError('Checkout artifact authentication failed', 'ARTIFACT_AUTH_FAILED');
        }
        if (!equalDigest(record.url_hash, sha256(plaintext))) {
          throw new BrowserRecoveryError('Checkout artifact hash mismatch', 'ARTIFACT_HASH_MISMATCH');
        }
        await connection.query(
          `UPDATE checkout_artifacts
           SET opened_at = COALESCE(opened_at, ?)
           WHERE id = ? AND status = 'ACTIVE'`,
          [now, artifact]
        );
        return { artifactId: artifact, navigationUrl: plaintext, expiresAt };
      });
    },

    async destroyCheckoutArtifact({
      runId, artifactId, ownerId, leaseToken, reasonCode, now = new Date()
    }) {
      const run = required(runId, 'runId');
      const artifact = required(artifactId, 'artifactId');
      const owner = required(ownerId, 'ownerId');
      const reason = required(reasonCode, 'reasonCode');
      if (!DESTROY_REASONS.has(reason)) {
        throw new BrowserRecoveryError('artifact destruction reason is not deterministic', 'INVALID_DESTROY_REASON');
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockRunResources(connection, run);
        assertWorkerLease(row, { ownerId: owner, leaseToken, now });
        assertAutomationControl(row, owner);
        if (!SAFE_PAYMENT_STATES.has(row.payment_state)) {
          throw new BrowserRecoveryError('artifact cannot be destroyed after submission', 'RECONCILE_ONLY');
        }
        const tokenHash = hashSecret(leaseToken);
        await assertResourceLeases(connection, {
          row, resourceHmacKey: resourceKey, ownerId: owner, tokenHash, now
        });
        const [records] = await connection.query(
          `SELECT secret_ref FROM checkout_artifacts
           WHERE id = ? AND browser_run_id = ? AND status IN ('ACTIVE', 'REVIEW_REQUIRED')
           FOR UPDATE`,
          [artifact, run]
        );
        if (records.length !== 1) {
          throw new BrowserRecoveryError('Checkout artifact not found', 'ARTIFACT_NOT_FOUND');
        }
        await connection.query(
          `UPDATE browser_artifact_secrets
           SET iv = NULL, auth_tag = NULL, ciphertext = NULL, destroyed_at = ?
           WHERE secret_ref = ? AND destroyed_at IS NULL`,
          [now, records[0].secret_ref]
        );
        await connection.query(
          `UPDATE checkout_artifacts
           SET status = 'INVALIDATED', invalidated_at = ?, destroyed_at = ?
           WHERE id = ?`,
          [now, now, artifact]
        );
        const artifactDigest = resourceDigest(resourceKey, 'CHECKOUT_ARTIFACT', artifact);
        await connection.query(
          `UPDATE execution_resource_leases
           SET released_at = ?, release_reason = ?
           WHERE browser_run_id = ? AND resource_type = 'CHECKOUT_ARTIFACT'
             AND resource_key_hmac = ? AND owner_id = ?
             AND lease_token_hash = ? AND released_at IS NULL`,
          [now, reason, run, artifactDigest, owner, tokenHash]
        );
        return { artifactId: artifact, destroyed: true, reasonCode: reason };
      });
    }
  };
}
