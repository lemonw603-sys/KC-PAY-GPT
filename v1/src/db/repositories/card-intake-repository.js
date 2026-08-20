import crypto from 'node:crypto';

const ACTIVE_BATCH_STATUSES = ['DISCOVERING', 'VALIDATING'];

function jsonValue(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function mapBatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerAccountId: row.provider_account_id,
    status: row.status,
    requestedBy: row.requested_by,
    baselineWatermark: row.baseline_watermark,
    baselineHash: row.baseline_hash,
    baseline: parseJson(row.baseline_json),
    discoveredCount: Number(row.discovered_count || 0),
    acceptedCount: Number(row.accepted_count || 0),
    reviewCount: Number(row.review_count || 0),
    failedCount: Number(row.failed_count || 0)
  };
}

function mapDiscovery(row) {
  if (!row) return null;
  return {
    id: row.id,
    intakeBatchId: row.intake_batch_id,
    providerAccountId: row.provider_account_id,
    externalCardId: row.external_card_id,
    cardId: row.card_id,
    intakeStatus: row.intake_status,
    validationAttempts: Number(row.validation_attempts || 0),
    firstSnapshotHash: row.first_snapshot_hash,
    secondSnapshotHash: row.second_snapshot_hash,
    details: parseJson(row.details_json),
    failureCode: row.failure_code,
    failureReason: row.failure_reason
  };
}

async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createCardIntakeRepository({ pool, idFactory = crypto.randomUUID } = {}) {
  if (!pool?.query || !pool?.getConnection) throw new Error('Card intake repository requires a MySQL pool');

  async function createBatch({ providerAccountId, requestedBy = 'admin', baselineHash,
    baselineWatermark = null, baseline = null }) {
    return withTransaction(pool, async (connection) => {
      const [accounts] = await connection.query(
        'SELECT id FROM provider_accounts WHERE id = ? FOR UPDATE', [providerAccountId]
      );
      if (!accounts.length) {
        const error = new Error('Provider account does not exist');
        error.code = 'PROVIDER_ACCOUNT_NOT_FOUND';
        throw error;
      }
      const [active] = await connection.query(
        `SELECT * FROM card_intake_batches
         WHERE provider_account_id = ? AND status IN ('DISCOVERING','VALIDATING')
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [providerAccountId]
      );
      if (active[0]) return { created: false, batch: mapBatch(active[0]) };

      const id = idFactory();
      await connection.query(
        `INSERT INTO card_intake_batches
         (id, provider_account_id, status, requested_by, baseline_watermark,
          baseline_hash, baseline_json)
         VALUES (?, ?, 'DISCOVERING', ?, ?, ?, ?)`,
        [id, providerAccountId, requestedBy, baselineWatermark, baselineHash, jsonValue(baseline)]
      );
      return {
        created: true,
        batch: { id, providerAccountId, status: 'DISCOVERING', requestedBy,
          baselineWatermark, baselineHash, baseline, discoveredCount: 0,
          acceptedCount: 0, reviewCount: 0, failedCount: 0 }
      };
    });
  }

  async function setBatchStatus(batchId, status) {
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status);
    await pool.query(
      `UPDATE card_intake_batches SET status = ?,
         completed_at = ${terminal ? 'COALESCE(completed_at, CURRENT_TIMESTAMP(3))' : 'NULL'}
       WHERE id = ?`,
      [status, batchId]
    );
  }

  async function findExistingExternalIds(providerAccountId, externalIds) {
    const result = new Map();
    for (let offset = 0; offset < externalIds.length; offset += 500) {
      const ids = externalIds.slice(offset, offset + 500);
      if (!ids.length) continue;
      const [rows] = await pool.query(
        `SELECT id, external_card_id FROM cards
         WHERE provider_account_id = ? AND external_card_id IN (${ids.map(() => '?').join(',')})`,
        [providerAccountId, ...ids]
      );
      for (const row of rows) result.set(String(row.external_card_id), row.id);
    }
    return result;
  }

  async function addDiscovery({ batchId, providerAccountId, externalCardId, details = null }) {
    return withTransaction(pool, async (connection) => {
      const [existing] = await connection.query(
        `SELECT id FROM cards WHERE provider_account_id = ?
         AND BINARY external_card_id = BINARY ? LIMIT 1 FOR UPDATE`,
        [providerAccountId, externalCardId]
      );
      if (existing[0]) return { kind: 'existing', cardId: existing[0].id };

      const id = idFactory();
      const [insert] = await connection.query(
        `INSERT IGNORE INTO card_discoveries
         (id, intake_batch_id, provider_account_id, external_card_id,
          intake_status, details_json)
         VALUES (?, ?, ?, ?, 'QUARANTINED', ?)`,
        [id, batchId, providerAccountId, externalCardId, jsonValue(details)]
      );
      const [rows] = await connection.query(
        `SELECT * FROM card_discoveries WHERE intake_batch_id = ?
         AND provider_account_id = ? AND BINARY external_card_id = BINARY ? LIMIT 1`,
        [batchId, providerAccountId, externalCardId]
      );
      return { kind: insert.affectedRows ? 'discovered' : 'duplicate', discovery: mapDiscovery(rows[0]) };
    });
  }

  async function getDiscovery(discoveryId, { forUpdate = false, connection = pool } = {}) {
    const [rows] = await connection.query(
      `SELECT * FROM card_discoveries WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [discoveryId]
    );
    return mapDiscovery(rows[0]);
  }

  async function listDiscoveries(batchId, { statuses = ['QUARANTINED'], limit = 1000 } = {}) {
    if (!statuses.length) return [];
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const [rows] = await pool.query(
      `SELECT * FROM card_discoveries WHERE intake_batch_id = ?
       AND intake_status IN (${statuses.map(() => '?').join(',')})
       ORDER BY first_seen_at, id LIMIT ${safeLimit}`,
      [batchId, ...statuses]
    );
    return rows.map(mapDiscovery);
  }

  async function listBatches({ limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const [rows] = await pool.query(
      `SELECT * FROM card_intake_batches
       ORDER BY created_at DESC LIMIT ${safeLimit}`
    );
    return rows.map(mapBatch);
  }

  async function recordValidationSnapshot(discoveryId, { snapshotHash, details,
    rulesPassed, ownershipCertain }) {
    return withTransaction(pool, async (connection) => {
      const discovery = await getDiscovery(discoveryId, { forUpdate: true, connection });
      if (!discovery) throw Object.assign(new Error('Card discovery not found'), { code: 'DISCOVERY_NOT_FOUND' });
      if (['ACCEPTED', 'EXISTING', 'FAILED'].includes(discovery.intakeStatus)) {
        return { discovery, stable: discovery.firstSnapshotHash === discovery.secondSnapshotHash };
      }
      const stable = Boolean(discovery.firstSnapshotHash && discovery.firstSnapshotHash === snapshotHash);
      const firstHash = stable ? discovery.firstSnapshotHash : snapshotHash;
      const secondHash = stable ? snapshotHash : null;
      const status = stable
        ? (rulesPassed && ownershipCertain ? 'VALIDATED' : 'REVIEW_REQUIRED')
        : 'QUARANTINED';
      await connection.query(
        `UPDATE card_discoveries SET intake_status = ?,
           validation_attempts = validation_attempts + 1,
           first_snapshot_hash = ?, second_snapshot_hash = ?, details_json = ?,
           failure_code = NULL, failure_reason = NULL,
           validated_at = IF(? IS NULL, NULL, CURRENT_TIMESTAMP(3))
         WHERE id = ?`,
        [status, firstHash, secondHash, jsonValue(details), secondHash, discoveryId]
      );
      return {
        discovery: { ...discovery, intakeStatus: status,
          validationAttempts: discovery.validationAttempts + 1,
          firstSnapshotHash: firstHash, secondSnapshotHash: secondHash, details },
        stable
      };
    });
  }

  async function markDiscoveryFailed(discoveryId, code, reason) {
    await pool.query(
      `UPDATE card_discoveries SET intake_status = 'FAILED',
         failure_code = ?, failure_reason = ?, validation_attempts = validation_attempts + 1
       WHERE id = ? AND intake_status NOT IN ('ACCEPTED','EXISTING')`,
      [String(code || 'CARD_VALIDATION_FAILED').slice(0, 64), String(reason || 'Card validation failed').slice(0, 1000), discoveryId]
    );
  }

  async function acceptDiscovery(discoveryId, card, { manual = false } = {}) {
    return withTransaction(pool, async (connection) => {
      const discovery = await getDiscovery(discoveryId, { forUpdate: true, connection });
      if (!discovery) throw Object.assign(new Error('Card discovery not found'), { code: 'DISCOVERY_NOT_FOUND' });
      const validation = discovery.details?.validation || {};
      const stable = discovery.validationAttempts >= 2
        && discovery.firstSnapshotHash && discovery.firstSnapshotHash === discovery.secondSnapshotHash;
      if (!stable || validation.rulesPassed !== true) {
        throw Object.assign(new Error('Discovery has not passed two stable technical validations'),
          { code: 'CARD_VALIDATION_REQUIRED' });
      }
      if (discovery.intakeStatus === 'REVIEW_REQUIRED' && !manual) {
        throw Object.assign(new Error('Discovery requires explicit operator acceptance'),
          { code: 'CARD_REVIEW_REQUIRED' });
      }
      if (!['VALIDATED', 'REVIEW_REQUIRED', 'ACCEPTED', 'EXISTING'].includes(discovery.intakeStatus)) {
        throw Object.assign(new Error('Discovery is not eligible for acceptance'),
          { code: 'CARD_INTAKE_NOT_ACCEPTABLE' });
      }

      const [existing] = await connection.query(
        `SELECT id, inventory_status FROM cards WHERE provider_account_id = ?
         AND BINARY external_card_id = BINARY ? LIMIT 1 FOR UPDATE`,
        [discovery.providerAccountId, discovery.externalCardId]
      );
      if (existing[0]) {
        await connection.query(
          `UPDATE card_discoveries SET card_id = ?, intake_status = 'EXISTING',
             validated_at = COALESCE(validated_at, CURRENT_TIMESTAMP(3)) WHERE id = ?`,
          [existing[0].id, discoveryId]
        );
        return { kind: 'existing', cardId: existing[0].id, inventoryStatus: existing[0].inventory_status };
      }

      const cardId = card.id || idFactory();
      await connection.query(
        `INSERT INTO cards
         (id, provider_account_id, order_id, inventory_status, intake_status,
          provider_card_id, external_card_id, card_type_id, last4, status,
          funded_amount, current_balance, currency, refund_status,
          card_credentials_ciphertext, card_number_ciphertext, pan_hmac,
          sync_tier, next_sync_at, last_successful_sync_at, last_synced_at)
         VALUES (?, ?, NULL, ?, 'ACCEPTED', ?, ?, ?, ?, ?, ?, ?, ?, 'MONITORING',
                 ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id = id`,
        [cardId, discovery.providerAccountId, card.inventoryStatus,
          discovery.externalCardId, discovery.externalCardId, card.cardTypeId,
          card.last4, card.status, card.fundedAmount, card.currentBalance,
          card.currency, card.credentialsCiphertext, card.cardNumberCiphertext,
          card.panHmac, card.syncTier || 'INVENTORY', card.nextSyncAt || null]
      );
      const [inserted] = await connection.query(
        `SELECT id, inventory_status FROM cards WHERE provider_account_id = ?
         AND BINARY external_card_id = BINARY ? LIMIT 1`,
        [discovery.providerAccountId, discovery.externalCardId]
      );
      const actualId = inserted[0].id;
      const kind = actualId === cardId ? 'accepted' : 'existing';
      await connection.query(
        `UPDATE card_discoveries SET card_id = ?, intake_status = ?,
           validated_at = COALESCE(validated_at, CURRENT_TIMESTAMP(3)) WHERE id = ?`,
        [actualId, kind === 'accepted' ? 'ACCEPTED' : 'EXISTING', discoveryId]
      );
      return { kind, cardId: actualId, inventoryStatus: inserted[0].inventory_status };
    });
  }

  async function refreshBatchStats(batchId) {
    await pool.query(
      `UPDATE card_intake_batches b SET
         discovered_count = (SELECT COUNT(*) FROM card_discoveries d WHERE d.intake_batch_id = b.id),
         accepted_count = (SELECT COUNT(*) FROM card_discoveries d WHERE d.intake_batch_id = b.id AND d.intake_status = 'ACCEPTED'),
         review_count = (SELECT COUNT(*) FROM card_discoveries d WHERE d.intake_batch_id = b.id AND d.intake_status = 'REVIEW_REQUIRED'),
         failed_count = (SELECT COUNT(*) FROM card_discoveries d WHERE d.intake_batch_id = b.id AND d.intake_status = 'FAILED')
       WHERE b.id = ?`, [batchId]
    );
    const [rows] = await pool.query('SELECT * FROM card_intake_batches WHERE id = ? LIMIT 1', [batchId]);
    return mapBatch(rows[0]);
  }

  async function finalizeBatchIfSettled(batchId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS pending FROM card_discoveries
       WHERE intake_batch_id = ? AND intake_status IN ('QUARANTINED','VALIDATED')`, [batchId]
    );
    if (Number(rows[0]?.pending || 0) === 0) await setBatchStatus(batchId, 'COMPLETED');
    else await setBatchStatus(batchId, 'VALIDATING');
    return refreshBatchStats(batchId);
  }

  return {
    activeBatchStatuses: [...ACTIVE_BATCH_STATUSES],
    createBatch,
    setBatchStatus,
    findExistingExternalIds,
    addDiscovery,
    getDiscovery,
    listBatches,
    listDiscoveries,
    recordValidationSnapshot,
    markDiscoveryFailed,
    acceptDiscovery,
    refreshBatchStats,
    finalizeBatchIfSettled
  };
}
