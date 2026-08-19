import { mapStockCard } from './card-stock-service.js';

const ACTIVE = new Set(['active', 'available', 'usable', 'ready']);

function cardId(record) {
  const value = record?.id ?? record?.cardId ?? record?.card_id;
  return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function cardStatus(record) {
  return String(record?.status ?? record?.cardStatus ?? record?.card_status ?? '').trim().toLowerCase();
}

async function fetchAllCards(provider, { pageSize = 50, maxPages = 100 } = {}) {
  const cards = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await provider.cards({ page, pageSize });
    cards.push(...response.data.cards);
    if (cards.length >= response.data.total) return cards;
  }
  throw new Error('Provider card list exceeded the safe page limit');
}

export async function syncCardCatalog({ pool, provider, stock, checkedAt = new Date() }) {
  const [settingRows] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('default_card_type_id','default_minimum_required_card_balance')`
  );
  const settings = new Map(settingRows.map((row) => [row.setting_key, row.setting_value]));
  const cardTypeId = String(settings.get('default_card_type_id') || '').trim();
  const minimumRequiredBalance = Number(settings.get('default_minimum_required_card_balance'));
  if (!cardTypeId || !Number.isFinite(minimumRequiredBalance) || minimumRequiredBalance <= 0) {
    throw new Error('Card catalog sync settings are incomplete');
  }

  const listed = await fetchAllCards(provider);
  const active = listed.filter((record) => ACTIVE.has(cardStatus(record)) && cardId(record));
  const unresolved = [];
  for (const record of active) {
    const providerCardId = cardId(record);
    try {
      const detail = await provider.card(providerCardId);
      await stock.register(mapStockCard(detail, {
        providerCardId,
        cardTypeId,
        minimumRequiredBalance
      }));
    } catch (error) {
      unresolved.push({ providerCardId, code: String(error?.code || error?.kind || 'CARD_READ_FAILED').slice(0, 64) });
    }
  }

  const [counts] = await pool.query(
    `SELECT
       SUM(order_id IS NULL AND inventory_status = 'AVAILABLE') AS available,
       SUM(order_id IS NOT NULL OR inventory_status = 'ASSIGNED') AS assigned,
       SUM(order_id IS NULL AND inventory_status = 'DEPLETED') AS depleted,
       SUM(order_id IS NULL AND inventory_status = 'PROVISIONING') AS provisioning
     FROM cards`
  );
  const [localCards] = await pool.query(
    `SELECT provider_card_id, status FROM cards ORDER BY provider_card_id`
  );
  const listedById = new Map(listed.map((record) => [cardId(record), cardStatus(record)]).filter(([id]) => id));
  const localById = new Map(localCards.map((record) => [String(record.provider_card_id), String(record.status || '').toLowerCase()]));
  const providerOnlyActiveIds = active.map(cardId).filter((id) => !localById.has(id));
  const localMissingProviderIds = [...localById.keys()].filter((id) => !listedById.has(id));
  const statusConflictIds = [...localById.entries()]
    .filter(([id, status]) => listedById.has(id) && ACTIVE.has(status) !== ACTIVE.has(listedById.get(id)))
    .map(([id]) => id);
  const snapshot = {
    providerTotal: listed.length,
    providerActive: active.length,
    providerInactive: listed.length - active.length,
    available: Number(counts[0]?.available || 0),
    assigned: Number(counts[0]?.assigned || 0),
    depleted: Number(counts[0]?.depleted || 0),
    provisioning: Number(counts[0]?.provisioning || 0),
    unresolvedActive: unresolved.length,
    unresolved,
    providerOnlyActiveCount: providerOnlyActiveIds.length,
    providerOnlyActiveIds,
    localMissingProviderCount: localMissingProviderIds.length,
    localMissingProviderIds,
    statusConflictCount: statusConflictIds.length,
    statusConflictIds
  };
  await pool.query(
    `INSERT INTO card_catalog_snapshots (provider, payload_json, synced_at)
     VALUES ('hnskj', ?, ?)
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json),
       synced_at = VALUES(synced_at), updated_at = CURRENT_TIMESTAMP(3)`,
    [JSON.stringify(snapshot), checkedAt]
  );
  return { ...snapshot, syncedAt: checkedAt.toISOString() };
}
