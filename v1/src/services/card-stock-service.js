import { encryptSecret } from '../security/secret-box.js';
import { mapCardCredentials } from '../providers/hnskj-card.js';

const ACTIVE = new Set(['active', 'available', 'usable', 'ready']);

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

export function mapStockCard(envelope, { providerCardId, cardTypeId = null, fundedAmount = null } = {}) {
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
  return {
    providerCardId: String(id),
    cardTypeId: String(typeId),
    status,
    fundedAmount: fundedAmount == null ? null : String(fundedAmount),
    currentBalance: currentBalance == null ? null : String(currentBalance),
    currency: String(firstValue(data, ['currency', 'cardCurrency', 'card_currency']) || 'USD').toUpperCase(),
    last4: credentials?.cardNumber.slice(-4) || null,
    credentials,
    ready: ACTIVE.has(status) && credentials !== null && currentBalance != null && currentBalance > 0
  };
}

export function createCardStockService({ pool, sessionEncryptionKey }) {
  async function refreshLowStockAlert(connection, cardTypeId) {
    const [thresholdRows] = await connection.query(
      `SELECT setting_value FROM app_settings
       WHERE setting_key = 'card_stock_low_threshold' LIMIT 1`
    );
    const [stockRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM cards
       WHERE order_id IS NULL AND inventory_status = 'AVAILABLE'
         AND BINARY card_type_id = BINARY ?
         AND LOWER(status) IN ('active','available','usable','ready')
         AND card_credentials_ciphertext IS NOT NULL`,
      [String(cardTypeId)]
    );
    const threshold = Math.max(0, Number(thresholdRows[0]?.setting_value || 5));
    const available = Number(stockRows[0]?.count || 0);
    const key = `card-stock-low:${cardTypeId}`;
    if (available <= threshold) {
      await connection.query(
        `INSERT INTO operator_alerts
         (id, alert_type, dedupe_key, severity, title, message, status)
         VALUES (UUID(), 'CARD_STOCK_LOW', ?, 'warning', '可用卡库存偏低', ?, 'OPEN')
         ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
           message = VALUES(message), status = 'OPEN', acknowledged_at = NULL`,
        [key, `卡段 ${cardTypeId} 剩余 ${available} 张可用库存卡，阈值为 ${threshold}。`]
      );
    } else {
      await connection.query(
        `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = CURRENT_TIMESTAMP(3)
         WHERE dedupe_key = ? AND status = 'OPEN'`,
        [key]
      );
    }
    return { available, threshold, low: available <= threshold };
  }

  async function register(card) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query(
        `SELECT id, order_id FROM cards WHERE BINARY provider_card_id = BINARY ? FOR UPDATE`,
        [card.providerCardId]
      );
      if (existing[0]?.order_id) {
        await connection.commit();
        return { providerCardId: card.providerCardId, inventoryStatus: 'ASSIGNED', alreadyAssigned: true };
      }
      const inventoryStatus = card.ready ? 'AVAILABLE' : 'PROVISIONING';
      const credentialsCiphertext = card.credentials
        ? encryptSecret(JSON.stringify(card.credentials), sessionEncryptionKey)
        : null;
      if (existing.length) {
        await connection.query(
          `UPDATE cards SET card_type_id = ?, last4 = ?, status = ?, funded_amount = COALESCE(?, funded_amount),
             current_balance = ?, currency = ?, inventory_status = ?, card_credentials_ciphertext = ?,
             last_synced_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND order_id IS NULL`,
          [card.cardTypeId, card.last4, card.status, card.fundedAmount, card.currentBalance,
            card.currency, inventoryStatus, credentialsCiphertext, existing[0].id]
        );
      } else {
        await connection.query(
          `INSERT INTO cards
           (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
            funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
            last_synced_at)
           VALUES (UUID(), NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'MONITORING', ?, CURRENT_TIMESTAMP(3))`,
          [inventoryStatus, card.providerCardId, card.cardTypeId, card.last4, card.status,
            card.fundedAmount, card.currentBalance, card.currency, credentialsCiphertext]
        );
      }
      const stock = await refreshLowStockAlert(connection, card.cardTypeId);
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
    const [[thresholdRows], [rows]] = await Promise.all([
      pool.query(
        `SELECT setting_value FROM app_settings
         WHERE setting_key = 'card_stock_low_threshold' LIMIT 1`
      ),
      pool.query(
        `SELECT card_type_id,
                SUM(order_id IS NULL AND inventory_status = 'AVAILABLE') AS available,
                SUM(order_id IS NULL AND inventory_status = 'PROVISIONING') AS provisioning,
                SUM(order_id IS NOT NULL OR inventory_status = 'ASSIGNED') AS assigned
         FROM cards GROUP BY card_type_id ORDER BY card_type_id`
      )
    ]);
    const threshold = Math.max(0, Number(thresholdRows[0]?.setting_value || 5));
    return {
      threshold,
      cardTypes: rows.map((row) => ({
        cardTypeId: String(row.card_type_id),
        available: Number(row.available || 0),
        provisioning: Number(row.provisioning || 0),
        assigned: Number(row.assigned || 0),
        low: Number(row.available || 0) <= threshold
      }))
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
    return { threshold };
  }

  return { register, status, setThreshold };
}
