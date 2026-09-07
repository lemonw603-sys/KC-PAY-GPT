import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../security/secret-box.js';
import { mapCardCredentials } from '../providers/hnskj-card.js';
import {
  CARD_STOCK_RISK_CONFIRM_THRESHOLD,
  CARD_PROVIDER_STATUS_MAX_AGE_MS,
  readProviderSnapshot,
  snapshotIsFresh
} from './card-provider-snapshot-service.js';
import { cardCatalogIsFresh, readCardCatalogSnapshot } from './card-catalog-snapshot-service.js';
import { eligibleInventoryCardSql } from './card-inventory-eligibility.js';

const ACTIVE = new Set(['active', 'available', 'usable', 'ready']);
const FAILED = new Set(['failed', 'failure', 'invalid', 'inactive', 'closed', 'cancelled', 'canceled']);
const LEGACY_HNSKJ_ACCOUNT_ID = '00000000-0000-4000-8000-000000000101';

function cardData(envelope) {
  return envelope?.data?.card ?? envelope?.data ?? {};
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

export function mapStockCard(envelope, {
  providerCardId,
  cardTypeId = null,
  fundedAmount = null,
  minimumRequiredBalance = null
} = {}) {
  const data = cardData(envelope);
  const id = firstValue(data, ['id', 'cardId', 'card_id']) ?? providerCardId;
  const typeId = firstValue(data, ['cardTypeId', 'card_type_id', 'cardBinId', 'card_bin_id']) ?? cardTypeId;
  const status = String(firstValue(data, ['status', 'cardStatus', 'card_status']) || 'provisioning').toLowerCase();
  const rawBalance = firstValue(data, ['cardBalance', 'currentBalance', 'current_balance', 'balance']);
  const currentBalance = rawBalance == null ? null : Number(rawBalance);
  if (!id || !typeId) throw new Error('Card stock record lacks provider card ID or card type ID');
  if (currentBalance != null && (!Number.isFinite(currentBalance) || currentBalance < 0)) {
    throw new Error('Card stock record has an invalid balance');
  }
  let credentials = null;
  try {
    credentials = mapCardCredentials(envelope);
  } catch {
    credentials = null;
  }
  const requiredBalance = minimumRequiredBalance == null
    ? Math.max(0, Number(fundedAmount) || 0)
    : Math.max(0, Number(minimumRequiredBalance) || 0);
  const active = ACTIVE.has(status);
  const ready = active && credentials !== null && currentBalance != null
    && currentBalance >= requiredBalance;
  return {
    providerCardId: String(id),
    cardTypeId: String(typeId),
    status,
    fundedAmount: fundedAmount == null ? null : String(fundedAmount),
    currentBalance: currentBalance == null ? null : String(currentBalance),
    currency: String(firstValue(data, ['currency', 'cardCurrency', 'card_currency']) || 'USD').toUpperCase(),
    last4: credentials?.cardNumber.slice(-4) || null,
    credentials,
    ready,
    depleted: active && credentials !== null && currentBalance != null
      && requiredBalance > 0 && currentBalance < requiredBalance,
    failed: FAILED.has(status)
  };
}

function decryptCardNumber(row, key) {
  try {
    if (row.card_number_ciphertext) return decryptSecret(row.card_number_ciphertext, key);
    if (!row.card_credentials_ciphertext) return null;
    return JSON.parse(decryptSecret(row.card_credentials_ciphertext, key)).cardNumber || null;
  } catch {
    return null;
  }
}

export function classifyStockCardOperationalState(card) {
  if (card.effectiveInventoryStatus === 'RETIRED') {
    return { category: 'RETIRED', reason: '已永久停用，不参与分配' };
  }
  if (card.isAllocatable) {
    return { category: 'READY', reason: card.usedCapacity > 0
      ? `可继续分配 Plus（已用 ${card.usedCapacity}/${card.maxCapacity} 次）`
      : '可直接分配 Plus' };
  }
  if (card.assigned || card.effectiveInventoryStatus === 'ASSIGNED') {
    return {
      category: 'IN_USE',
      reason: card.publicNo ? `已绑定订单 ${card.publicNo}` : '已绑定订单'
    };
  }
  if (card.effectiveInventoryStatus === 'PRODUCT_ONLY') {
    return {
      category: 'BLOCKED',
      reason: card.allocationProductCode ? `仅限 ${card.allocationProductCode}` : '仅限其他产品'
    };
  }
  if (['MISMATCH', 'REVIEW_REQUIRED'].includes(card.reconciliationStatus)) {
    return { category: 'BLOCKED', reason: '需要人工核对同步结果' };
  }
  if (['SYNCING', 'STALE'].includes(card.reconciliationStatus)) {
    return { category: 'BLOCKED', reason: '等待只读同步' };
  }
  if (card.effectiveInventoryStatus === 'DEPLETED') {
    return { category: 'BLOCKED', reason: '余额不足，充值后可重新判定' };
  }
  if (card.effectiveInventoryStatus === 'PROVISIONING') {
    return { category: 'BLOCKED', reason: '卡片资料或余额准备中' };
  }
  if (card.effectiveInventoryStatus === 'HELD_FOR_REVIEW') {
    return { category: 'BLOCKED', reason: '需要人工核对' };
  }
  if (card.effectiveInventoryStatus === 'FAILED') {
    return { category: 'BLOCKED', reason: '卡台当前状态不可用' };
  }
  return { category: 'BLOCKED', reason: '当前不满足 Plus 安全分配条件' };
}

export function summarizeStockCardOperationalState(cards = []) {
  const summary = { ready: 0, inUse: 0, retired: 0, blocked: 0 };
  for (const card of cards) {
    // Product-specific cards (for example the Claude-only card) are shown
    // for traceability but are not Plus inventory and must not inflate the
    // Plus "暂不可用" count.
    if (card.effectiveInventoryStatus === 'PRODUCT_ONLY') continue;
    if (card.category === 'READY') summary.ready += 1;
    else if (card.category === 'IN_USE') summary.inUse += 1;
    else if (card.category === 'RETIRED') summary.retired += 1;
    else summary.blocked += 1;
  }
  return summary;
}

export function createCardStockService({ pool, sessionEncryptionKey, panHmacKey = null,
  providerAccountId = LEGACY_HNSKJ_ACCOUNT_ID }) {
  async function recordStateEvent(connection, { cardId, previous, current, source = 'provider_sync' }) {
    const changed = !previous
      || previous.status !== current.status
      || previous.inventoryStatus !== current.inventoryStatus
      || String(previous.currentBalance ?? '') !== String(current.currentBalance ?? '')
      || previous.currency !== current.currency;
    if (!changed) return;
    await connection.query(
      `INSERT INTO card_state_events
       (card_id, event_type, source, previous_json, current_json)
       VALUES (?, ?, ?, ?, ?)`,
      [cardId, previous ? 'CARD_STATE_CHANGED' : 'CARD_DISCOVERED', source,
        previous ? JSON.stringify(previous) : null, JSON.stringify(current)]
    );
  }

  async function refreshLowStockAlert(connection) {
    const [thresholdRows] = await connection.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN ('card_stock_low_threshold', 'card_auto_replenishment_enabled')`
    );
    const [stockRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM cards
       WHERE ${eligibleInventoryCardSql('cards', `COALESCE((SELECT CAST(setting_value AS DECIMAL(18,6))
           FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1), 999999999)`)}
         AND provider_account_id = ?
        `,
      [providerAccountId]
    );
    const threshold = Math.max(0, Number(thresholdRows.find((row) => row.setting_key === 'card_stock_low_threshold')?.setting_value || 5));
    const autoReplenishmentEnabled = thresholdRows.some((row) => row.setting_key === 'card_auto_replenishment_enabled' && row.setting_value === 'true');
    const available = Number(stockRows[0]?.count || 0);
    const key = `card-stock-low:${providerAccountId}:plus`;
    // threshold 0 means the reminder is switched off; "0 left, threshold 0" was pure noise.
    if (threshold > 0 && available <= threshold && !autoReplenishmentEnabled) {
      await connection.query(
        `INSERT INTO operator_alerts
         (id, alert_type, dedupe_key, severity, title, message, status)
         VALUES (UUID(), 'CARD_STOCK_LOW', ?, 'warning', '可用卡库存偏低', ?, 'OPEN')
         ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
           message = VALUES(message),
           status = IF(status = 'RESOLVED', 'OPEN', status),
           acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
        [key, `Plus 可直接分配卡剩余 ${available} 张，阈值为 ${threshold}。`]
      );
    } else {
      await connection.query(
        `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = CURRENT_TIMESTAMP(3)
         WHERE dedupe_key = ? AND status = 'OPEN'`,
        [key]
      );
    }
    return { available, threshold, low: threshold > 0 && available <= threshold && !autoReplenishmentEnabled };
  }

  async function register(card) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query(
        `SELECT c.id, c.order_id, c.status, c.inventory_status, c.current_balance, c.currency,
                EXISTS (SELECT 1 FROM card_assignment_history h
                  WHERE h.card_id = c.id AND h.status='ACTIVE') AS has_active_assignment
         FROM cards c
         WHERE c.provider_account_id = ? AND BINARY c.external_card_id = BINARY ?
         FOR UPDATE`,
        [providerAccountId, card.providerCardId]
      );
      const previous = existing[0] ? {
        status: existing[0].status,
        inventoryStatus: existing[0].inventory_status,
        currentBalance: existing[0].current_balance == null ? null : String(existing[0].current_balance),
        currency: existing[0].currency
      } : null;
      const normalizedPan = String(card.credentials?.cardNumber || '').replace(/[\s-]/g, '');
      const panHmac = Buffer.isBuffer(panHmacKey) && /^\d{12,19}$/.test(normalizedPan)
        ? crypto.createHmac('sha256', panHmacKey).update(normalizedPan).digest('hex') : null;
      if (existing[0]?.has_active_assignment) {
        const credentialsCiphertext = card.credentials
          ? encryptSecret(JSON.stringify(card.credentials), sessionEncryptionKey)
          : null;
        const cardNumberCiphertext = card.credentials?.cardNumber
          ? encryptSecret(card.credentials.cardNumber, sessionEncryptionKey)
          : null;
        await connection.query(
          `UPDATE cards SET last4 = COALESCE(?, last4), status = ?, current_balance = ?, currency = ?,
             inventory_status = 'ASSIGNED',
             card_credentials_ciphertext = COALESCE(?, card_credentials_ciphertext),
             card_number_ciphertext = COALESCE(?, card_number_ciphertext),
             pan_hmac = COALESCE(?, pan_hmac),
             pan_hmac_version = CASE WHEN ? IS NULL THEN pan_hmac_version ELSE 1 END,
             last_synced_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [card.last4, card.status, card.currentBalance, card.currency,
            credentialsCiphertext, cardNumberCiphertext, panHmac, panHmac, existing[0].id]
        );
        await recordStateEvent(connection, {
          cardId: existing[0].id,
          previous,
          current: {
            status: card.status, inventoryStatus: 'ASSIGNED',
            currentBalance: card.currentBalance, currency: card.currency
          }
        });
        await connection.commit();
        return { providerCardId: card.providerCardId, inventoryStatus: 'ASSIGNED', alreadyAssigned: true };
      }
      const inventoryStatus = card.failed ? 'FAILED'
        : card.depleted ? 'DEPLETED'
          : card.ready ? 'AVAILABLE' : 'PROVISIONING';
      const credentialsCiphertext = card.credentials
        ? encryptSecret(JSON.stringify(card.credentials), sessionEncryptionKey)
        : null;
      const cardNumberCiphertext = card.credentials?.cardNumber
        ? encryptSecret(card.credentials.cardNumber, sessionEncryptionKey)
        : null;
      if (existing.length) {
        await connection.query(
          `UPDATE cards SET card_type_id = ?, last4 = ?, status = ?, funded_amount = COALESCE(?, funded_amount),
             current_balance = ?, currency = ?, inventory_status = ?,
             card_credentials_ciphertext = COALESCE(?, card_credentials_ciphertext),
             card_number_ciphertext = COALESCE(?, card_number_ciphertext),
             pan_hmac = COALESCE(?, pan_hmac),
             pan_hmac_version = CASE WHEN ? IS NULL THEN pan_hmac_version ELSE 1 END,
             last_synced_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
          [card.cardTypeId, card.last4, card.status, card.fundedAmount, card.currentBalance,
            card.currency, inventoryStatus, credentialsCiphertext, cardNumberCiphertext,
            panHmac, panHmac, existing[0].id]
        );
      } else {
        await connection.query(
          `INSERT INTO cards
           (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
            funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
            card_number_ciphertext, pan_hmac, pan_hmac_version, provider_account_id, external_card_id,
            intake_status, sync_tier,
            last_synced_at)
           VALUES (UUID(), NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'MONITORING', ?, ?, ?, 1, ?, ?,
             'ACCEPTED', 'INVENTORY', CURRENT_TIMESTAMP(3))`,
          [inventoryStatus, card.providerCardId, card.cardTypeId, card.last4, card.status,
            card.fundedAmount, card.currentBalance, card.currency, credentialsCiphertext,
            cardNumberCiphertext, panHmac, providerAccountId, card.providerCardId]
        );
      }
      const cardId = existing[0]?.id || (await connection.query(
        `SELECT id FROM cards
         WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ? LIMIT 1`,
        [providerAccountId, card.providerCardId]
      ))[0][0].id;
      await recordStateEvent(connection, {
        cardId,
        previous,
        current: {
          status: card.status, inventoryStatus,
          currentBalance: card.currentBalance, currency: card.currency
        }
      });
      const stock = await refreshLowStockAlert(connection);
      await connection.commit();
      return { providerCardId: card.providerCardId, inventoryStatus, ...stock };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function status() {
    const [[thresholdRows], [rows], [settings], [cards], [overrideRows], providerSnapshot, catalogSnapshot] = await Promise.all([
      pool.query(
        `SELECT setting_key, setting_value FROM app_settings
         WHERE setting_key IN ('card_stock_low_threshold','card_auto_replenishment_enabled')`
      ),
      pool.query(
        `SELECT card_type_id,
                SUM(${eligibleInventoryCardSql('cards', `COALESCE((SELECT CAST(setting_value AS DECIMAL(18,6))
                    FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1), 999999999)`)}) AS available,
                SUM(inventory_status = 'PROVISIONING' AND NOT EXISTS (
                  SELECT 1 FROM card_assignment_history stock_assignment
                  WHERE stock_assignment.card_id=cards.id AND stock_assignment.status='ACTIVE')) AS provisioning,
                SUM(EXISTS (SELECT 1 FROM card_assignment_history stock_assignment
                  WHERE stock_assignment.card_id=cards.id AND stock_assignment.status='ACTIVE')) AS assigned,
                SUM(inventory_status = 'DEPLETED' AND NOT EXISTS (
                  SELECT 1 FROM card_assignment_history stock_assignment
                  WHERE stock_assignment.card_id=cards.id AND stock_assignment.status='ACTIVE')) AS depleted,
                SUM(inventory_status = 'HELD_FOR_REVIEW' AND NOT EXISTS (
                  SELECT 1 FROM card_assignment_history stock_assignment
                  WHERE stock_assignment.card_id=cards.id AND stock_assignment.status='ACTIVE')) AS held
         FROM cards GROUP BY card_type_id ORDER BY card_type_id`
      ),
      pool.query(`SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key IN ('default_card_type_id','default_open_card_amount','card_max_successful_payments','default_minimum_required_card_balance')`),
      pool.query(`SELECT c.provider_account_id, pa.provider_code, pa.account_code,
          c.provider_card_id, c.card_type_id, c.last4, c.status, c.inventory_status,
          c.funded_amount, c.current_balance, c.currency, c.sync_tier, active_assignment.order_id AS active_order_id,
          co.allocation_policy, co.product_code AS allocation_product_code,
          co.reason AS allocation_reason,
          (${eligibleInventoryCardSql('c', `COALESCE((SELECT CAST(setting_value AS DECIMAL(18,6))
              FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1), 999999999)`)}) AS is_allocatable,
          c.card_credentials_ciphertext, c.card_number_ciphertext, c.last_synced_at,
          c.last_transaction_synced_at, o.public_no,
          (SELECT COUNT(*) FROM card_transactions ct WHERE ct.card_id = c.id) AS transaction_count,
          (SELECT COUNT(*) FROM card_consumption_ledger usage_rows
            WHERE usage_rows.card_id=c.id AND usage_rows.status IN ('RESERVED','CONSUMED','RECONCILIATION')) AS used_capacity,
          (SELECT MAX(ct.last_seen_at) FROM card_transactions ct WHERE ct.card_id = c.id) AS latest_transaction_at,
          (SELECT csj.status FROM card_sync_jobs csj WHERE csj.card_id = c.id
            ORDER BY csj.created_at DESC LIMIT 1) AS sync_status,
          (SELECT csj.error_message FROM card_sync_jobs csj WHERE csj.card_id = c.id
            ORDER BY csj.created_at DESC LIMIT 1) AS sync_error
        FROM cards c
        LEFT JOIN provider_accounts pa ON pa.id = c.provider_account_id
        LEFT JOIN card_assignment_history active_assignment
          ON active_assignment.card_id=c.id AND active_assignment.status='ACTIVE'
        LEFT JOIN orders o ON o.id = active_assignment.order_id
        LEFT JOIN card_operational_overrides co
          ON co.provider_account_id = c.provider_account_id
         AND BINARY co.external_card_id = BINARY c.external_card_id
        ORDER BY c.created_at DESC LIMIT 200`),
      pool.query(`SELECT provider_account_id, external_card_id, allocation_policy,
                         product_code, reason
                    FROM card_operational_overrides
                   WHERE allocation_policy IN ('RETIRED', 'PRODUCT_ONLY')
                   ORDER BY external_card_id`),
      readProviderSnapshot(pool),
      readCardCatalogSnapshot(pool)
    ]);
    const threshold = Math.max(0, Number(thresholdRows.find(
      (row) => row.setting_key === 'card_stock_low_threshold'
    )?.setting_value || 5));
    const autoReplenishmentEnabled = thresholdRows.some(
      (row) => row.setting_key === 'card_auto_replenishment_enabled' && row.setting_value === 'true'
    );
    const settingMap = new Map(settings.map((row) => [row.setting_key, row.setting_value]));
    const defaultCardTypeId = String(settingMap.get('default_card_type_id') || '');
    const maxSuccessfulPayments = Math.min(4, Math.max(1,
      Number(settingMap.get('card_max_successful_payments') || 3)));
    const minimumRequiredCardBalance = String(settingMap.get('default_minimum_required_card_balance') || '');
    const selectedCardType = providerSnapshot?.cardTypes?.find(
      (item) => String(item.id) === defaultCardTypeId
    ) || null;
    const mismatchIds = new Set([
      ...(catalogSnapshot?.providerOnlyActiveIds || []),
      ...(catalogSnapshot?.localMissingProviderIds || []),
      ...(catalogSnapshot?.statusConflictIds || [])
    ].map(String));
    const mappedCards = cards.map((row) => {
      const card = {
        providerAccountId: row.provider_account_id,
        providerCode: row.provider_code || null,
        providerAccountCode: row.account_code || null,
        providerLabel: row.provider_code === 'manual_excel' ? '备用卡台' : (row.provider_code === 'hnskj' ? 'HNSKJ 卡台' : (row.provider_code || '未知卡台')),
        providerCardId: String(row.provider_card_id),
        cardTypeId: String(row.card_type_id),
        cardNumber: decryptCardNumber(row, sessionEncryptionKey),
        last4: row.last4,
        status: row.status,
        inventoryStatus: row.inventory_status,
        effectiveInventoryStatus: row.allocation_policy === 'RETIRED' ? 'RETIRED'
          : row.allocation_policy === 'PRODUCT_ONLY' ? 'PRODUCT_ONLY' : row.inventory_status,
        allocationPolicy: row.allocation_policy || 'NORMAL',
        allocationProductCode: row.allocation_product_code || null,
        allocationReason: row.allocation_reason || null,
        isAllocatable: Boolean(row.is_allocatable),
        fundedAmount: row.funded_amount == null ? null : String(row.funded_amount),
        currentBalance: row.current_balance == null ? null : String(row.current_balance),
        currency: row.currency,
        assigned: Boolean(row.active_order_id),
        usedCapacity: Number(row.used_capacity || 0),
        maxCapacity: maxSuccessfulPayments,
        publicNo: row.public_no || null,
        transactionCount: Number(row.transaction_count || 0),
        latestTransactionAt: row.latest_transaction_at instanceof Date
          ? row.latest_transaction_at.toISOString() : row.latest_transaction_at || null,
        lastTransactionSyncedAt: row.last_transaction_synced_at instanceof Date
          ? row.last_transaction_synced_at.toISOString() : row.last_transaction_synced_at || null,
        syncStatus: row.sync_status || null,
        syncError: row.sync_error || null,
        reconciliationStatus: row.sync_tier === 'MANUAL_IMPORT' ? 'MANUAL_SNAPSHOT'
          : mismatchIds.has(String(row.provider_card_id)) ? 'MISMATCH'
          : ['PENDING', 'RUNNING'].includes(row.sync_status) ? 'SYNCING'
          : row.sync_status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED'
            : !row.last_transaction_synced_at ? 'STALE' : 'OK',
        lastSyncedAt: row.last_synced_at instanceof Date
          ? row.last_synced_at.toISOString() : row.last_synced_at || null
      };
      return { ...card, ...classifyStockCardOperationalState(card) };
    });
    const localIds = new Set(mappedCards.map((card) => `${card.providerAccountId}:${card.providerCardId}`));
    const overrideCards = overrideRows
      .filter((row) => !localIds.has(`${row.provider_account_id}:${row.external_card_id}`))
      .map((row) => ({
        providerAccountId: row.provider_account_id,
        providerCode: null,
        providerAccountCode: null,
        providerLabel: '外部卡台记录',
        providerCardId: String(row.external_card_id),
        cardTypeId: null,
        cardNumber: null,
        last4: null,
        status: 'external-only',
        inventoryStatus: null,
        effectiveInventoryStatus: row.allocation_policy,
        allocationPolicy: row.allocation_policy,
        allocationProductCode: row.product_code || null,
        allocationReason: row.reason || null,
        isAllocatable: false,
        fundedAmount: null,
        currentBalance: null,
        currency: null,
        assigned: false,
        publicNo: null,
        transactionCount: 0,
        latestTransactionAt: null,
        lastTransactionSyncedAt: null,
        syncStatus: null,
        syncError: null,
        reconciliationStatus: 'EXTERNAL_ONLY',
        lastSyncedAt: null,
        category: row.allocation_policy === 'PRODUCT_ONLY' ? 'PRODUCT_ONLY' : 'RETIRED',
        reason: row.product_code ? `仅限 ${row.product_code}` : '运营已永久停用',
        externalOnly: true
      }));
    const allCards = [...mappedCards, ...overrideCards];
    const operationalSummary = summarizeStockCardOperationalState(allCards);
    return {
      threshold,
      autoReplenishmentEnabled,
      maxSuccessfulPayments,
      minimumRequiredCardBalance,
      operationalSummary,
      provider: {
        syncedAt: providerSnapshot?.syncedAt || null,
        rulesFresh: snapshotIsFresh(providerSnapshot, { maxAgeMs: CARD_PROVIDER_STATUS_MAX_AGE_MS }),
        purchaseEnabled: Boolean(providerSnapshot?.purchaseEnabled),
        accountBalance: providerSnapshot?.accountBalance || null,
        currency: providerSnapshot?.currency || 'USD',
        cardLimit: providerSnapshot?.cardLimit || null,
        defaultCardTypeId,
        defaultAmount: String(settingMap.get('default_open_card_amount') || ''),
        cardTypes: providerSnapshot?.cardTypes || [],
        selectedCardType,
        riskConfirmThreshold: CARD_STOCK_RISK_CONFIRM_THRESHOLD
      },
      catalog: catalogSnapshot ? {
        ...catalogSnapshot,
        fresh: cardCatalogIsFresh(catalogSnapshot),
        openingBlocked: !cardCatalogIsFresh(catalogSnapshot)
          || Number(catalogSnapshot.unresolvedActive || 0) > 0
          || Number(catalogSnapshot.providerOnlyActiveCount || 0) > 0
          || Number(catalogSnapshot.localMissingProviderCount || 0) > 0
          || Number(catalogSnapshot.statusConflictCount || 0) > 0
      } : {
        fresh: false,
        openingBlocked: true,
        providerTotal: 0,
        providerActive: 0,
        available: 0,
        assigned: 0,
        depleted: 0,
        unresolvedActive: 0,
        syncedAt: null
      },
      cardTypes: rows.map((row) => ({
        cardTypeId: String(row.card_type_id),
        available: Number(row.available || 0),
        provisioning: Number(row.provisioning || 0),
        assigned: Number(row.assigned || 0),
        depleted: Number(row.depleted || 0),
        held: Number(row.held || 0),
        low: threshold > 0 && !autoReplenishmentEnabled && Number(row.available || 0) <= threshold
      })),
        cards: allCards
    };
  }

  async function setThreshold(value) {
    const threshold = Number(value);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 10_000) {
      throw new Error('Card stock threshold must be an integer between 0 and 10000');
    }
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('card_stock_low_threshold', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [String(threshold)]
    );
    await refreshLowStockAlert(pool);
    return { threshold };
  }

  async function setMaxSuccessfulPayments(value) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 4) {
      throw new Error('Card successful payment limit must be an integer between 1 and 4');
    }
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('card_max_successful_payments', ?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),
         updated_at=CURRENT_TIMESTAMP(3)`,
      [String(limit)]
    );
    return { maxSuccessfulPayments: limit };
  }

  // Operator-set floor for card allocation eligibility (USD). Only affects
  // which cards may be assigned from now on; never touches payments.
  async function setMinimumRequiredCardBalance(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000 || Math.round(amount * 100) !== amount * 100) {
      throw new Error('Minimum required card balance must be between 0 and 1000 with at most two decimals');
    }
    const normalized = amount.toFixed(2);
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('default_minimum_required_card_balance', ?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),
         updated_at=CURRENT_TIMESTAMP(3)`,
      [normalized]
    );
    return { minimumRequiredCardBalance: normalized };
  }

  async function setDefaultCardType(cardTypeId) {
    const id = String(cardTypeId ?? '').trim();
    if (!id) throw new Error('Card type id is required');
    const snapshot = await readProviderSnapshot(pool);
    if (!snapshotIsFresh(snapshot, { maxAgeMs: CARD_PROVIDER_STATUS_MAX_AGE_MS })) {
      throw new Error('Card provider rules are stale');
    }
    const selected = snapshot.cardTypes?.find((item) => String(item.id) === id);
    if (!selected) throw new Error('Card type is unavailable');
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('default_card_type_id', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
         updated_at = CURRENT_TIMESTAMP(3)`, [id]
    );
    return { cardTypeId: id, cardTypeName: selected.name };
  }

  return { register, status, setThreshold, setMaxSuccessfulPayments, setMinimumRequiredCardBalance, setDefaultCardType };
}
