import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT_TYPES = new Set(['DELIVERED', 'RESENT', 'DELIVERY_FAILED']);
const SENSITIVE_KEY_RE = /(cdk|code|secret|token|key|recipient|email|phone|mobile|address|cipher|password)/i;
const CDK_SHAPED_VALUE_RE = /(?:PJ-[A-HJ-KM-NP-Z2-9]{5}(?:-[A-HJ-KM-NP-Z2-9]{5}){3}|[A-Z0-9]{3,5}(?:-[A-Z0-9]{3,5}){2,5}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export class CdkDeliveryError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'CdkDeliveryError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requireHmacKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new CdkDeliveryError('recipient reference HMAC key must be exactly 32 bytes', 'INVALID_HMAC_KEY');
  }
  return key;
}

function normalizeCdkId(value) {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) {
    throw new CdkDeliveryError('cdkId must be a UUID', 'INVALID_CDK_ID');
  }
  return id.toLowerCase();
}

function normalizeCdkIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CdkDeliveryError('cdkIds must be a non-empty explicit array', 'INVALID_CDK_SET');
  }
  const ids = value.map(normalizeCdkId);
  if (new Set(ids).size !== ids.length) {
    throw new CdkDeliveryError('cdkIds contains duplicates', 'DUPLICATE_CDK');
  }
  return ids;
}

function normalizeBatchNo(value) {
  const batchNo = String(value || '').trim();
  if (!BATCH_RE.test(batchNo)) {
    throw new CdkDeliveryError('batchNo must contain 1-64 letters, digits, underscores or hyphens', 'INVALID_BATCH');
  }
  return batchNo;
}

function normalizeEventType(value = 'DELIVERED') {
  const type = String(value || '').trim().toUpperCase();
  if (!EVENT_TYPES.has(type)) {
    throw new CdkDeliveryError('unsupported delivery event type', 'INVALID_EVENT_TYPE');
  }
  return type;
}

function normalizeToken(value, { field, required = false, fallback = null, max = 64 } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) throw new CdkDeliveryError(`${field} is required`, `INVALID_${field.toUpperCase()}`);
    return fallback;
  }
  const token = String(value).trim();
  if (token.length > max || (max === 64 && !TOKEN_RE.test(token))) {
    throw new CdkDeliveryError(`${field} is invalid`, `INVALID_${field.toUpperCase()}`);
  }
  return token;
}

function normalizeDate(value, field) {
  const date = value == null ? new Date() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new CdkDeliveryError(`${field} must be a valid Date`, `INVALID_${field.toUpperCase()}`);
  }
  return date;
}

export function hmacRecipientReference(reference, key) {
  requireHmacKey(key);
  const normalized = String(reference || '').trim();
  if (!normalized) {
    throw new CdkDeliveryError('recipientReference is required', 'INVALID_RECIPIENT_REFERENCE');
  }
  return crypto.createHmac('sha256', key).update(normalized, 'utf8').digest('hex');
}

function sanitizeMetadata(metadata) {
  if (metadata == null) return null;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new CdkDeliveryError('metadata must be an object', 'INVALID_METADATA');
  }
  const entries = Object.entries(metadata);
  if (entries.length > 20) {
    throw new CdkDeliveryError('metadata has too many fields', 'INVALID_METADATA');
  }
  const safe = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || SENSITIVE_KEY_RE.test(key)) {
      throw new CdkDeliveryError('metadata contains a sensitive or invalid key', 'SENSITIVE_METADATA');
    }
    if (value == null || typeof value === 'boolean' || typeof value === 'number') {
      safe[key] = value;
    } else if (typeof value === 'string') {
      if (value.length > 255 || CDK_SHAPED_VALUE_RE.test(value)) {
        throw new CdkDeliveryError('metadata contains sensitive-looking plaintext', 'SENSITIVE_METADATA');
      }
      safe[key] = value;
    } else {
      throw new CdkDeliveryError('metadata values must be scalar', 'INVALID_METADATA');
    }
  }
  return JSON.stringify(safe);
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
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

function indexById(rows) {
  return new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
}

async function lockExplicitCdks(connection, cdkIds, batchNo = null) {
  const [rows] = await connection.query(
    `SELECT id, batch_no, status
     FROM cdks
     WHERE id IN (${placeholders(cdkIds)})
     ORDER BY id
     FOR UPDATE`,
    cdkIds
  );
  const byId = indexById(rows);
  const missing = cdkIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new CdkDeliveryError('one or more CDKs were not found', 'CDK_NOT_FOUND', { cdkIds: missing });
  }
  if (batchNo != null) {
    const wrongBatch = cdkIds.filter((id) => String(byId.get(id).batch_no || '') !== batchNo);
    if (wrongBatch.length) {
      throw new CdkDeliveryError('one or more CDKs do not belong to the requested batch', 'CDK_BATCH_MISMATCH', { cdkIds: wrongBatch });
    }
  }
  return cdkIds.map((id) => byId.get(id));
}

function assertDeliveryState(rows, eventType) {
  if (!['DELIVERED', 'RESENT'].includes(eventType)) return;
  const revoked = rows.filter((row) => row.status === 'REVOKED').map((row) => row.id);
  if (revoked.length) {
    throw new CdkDeliveryError('revoked CDKs cannot be delivered', 'CDK_NOT_DELIVERABLE', {
      cdkIds: revoked
    });
  }
}

function buildEventRows(cdkIds, {
  batchNo = null,
  eventType,
  channel,
  recipientReferenceHash,
  actorId,
  metadataJson,
  deliveredAt,
  idFactory = crypto.randomUUID
}) {
  return cdkIds.map((cdkId) => ({
    id: idFactory(), cdkId, batchNo, eventType, channel,
    recipientReferenceHash, actorId, metadataJson, deliveredAt
  }));
}

async function insertEvents(connection, rows) {
  const values = rows.flatMap((row) => [
    row.id, row.cdkId, row.batchNo, row.eventType, row.channel,
    row.recipientReferenceHash, row.actorId, row.metadataJson, row.deliveredAt
  ]);
  const [result] = await connection.query(
    `INSERT INTO cdk_delivery_events
     (id, cdk_id, batch_no, event_type, channel, recipient_reference_hash,
      actor_id, metadata_json, delivered_at)
     VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    values
  );
  if (Number(result.affectedRows) !== rows.length) {
    throw new CdkDeliveryError('not all delivery events were recorded', 'DELIVERY_EVENT_INSERT_FAILED');
  }
}

function normalizeCommon(input, hmacKey) {
  return {
    eventType: normalizeEventType(input.eventType),
    channel: normalizeToken(input.channel, { field: 'channel', fallback: null }),
    recipientReferenceHash: hmacRecipientReference(input.recipientReference, hmacKey),
    actorId: normalizeToken(input.actorId, { field: 'actorId', fallback: 'admin', max: 128 }),
    metadataJson: sanitizeMetadata(input.metadata),
    deliveredAt: normalizeDate(input.deliveredAt, 'deliveredAt'),
    idFactory: input.idFactory
  };
}

export function createCdkDeliveryService({ pool, recipientReferenceHmacKey } = {}) {
  if (!pool) throw new TypeError('pool is required');
  const hmacKey = requireHmacKey(recipientReferenceHmacKey);

  async function recordDelivery(input = {}) {
    const cdkId = normalizeCdkId(input.cdkId);
    const batchNo = input.batchNo == null ? null : normalizeBatchNo(input.batchNo);
    const common = normalizeCommon(input, hmacKey);
    return inTransaction(pool, async (connection) => {
      const [cdk] = await lockExplicitCdks(connection, [cdkId], batchNo);
      assertDeliveryState([cdk], common.eventType);
      const eventBatchNo = batchNo ?? cdk.batch_no ?? null;
      const rows = buildEventRows([cdkId], { ...common, batchNo: eventBatchNo });
      await insertEvents(connection, rows);
      return {
        eventIds: rows.map((row) => row.id),
        cdkIds: [cdkId],
        batchNo: eventBatchNo,
        eventType: common.eventType,
        recipientReferenceHash: common.recipientReferenceHash,
        recordedCount: 1
      };
    });
  }

  async function recordBatchDelivery(input = {}) {
    const batchNo = normalizeBatchNo(input.batchNo);
    const cdkIds = normalizeCdkIds(input.cdkIds);
    const common = normalizeCommon(input, hmacKey);
    return inTransaction(pool, async (connection) => {
      const cdks = await lockExplicitCdks(connection, cdkIds, batchNo);
      assertDeliveryState(cdks, common.eventType);
      const rows = buildEventRows(cdkIds, { ...common, batchNo });
      await insertEvents(connection, rows);
      return {
        eventIds: rows.map((row) => row.id),
        cdkIds,
        batchNo,
        eventType: common.eventType,
        recipientReferenceHash: common.recipientReferenceHash,
        recordedCount: rows.length
      };
    });
  }

  return { recordDelivery, recordBatchDelivery };
}
