export async function readCardCatalogSnapshot(pool) {
  const [rows] = await pool.query(
    `SELECT payload_json, synced_at FROM card_catalog_snapshots
     WHERE provider = 'hnskj' LIMIT 1`
  );
  if (!rows.length) return null;
  const payload = typeof rows[0].payload_json === 'string'
    ? JSON.parse(rows[0].payload_json) : rows[0].payload_json;
  return { ...payload, syncedAt: new Date(rows[0].synced_at).toISOString() };
}

export function cardCatalogIsFresh(snapshot, { now = Date.now(), maxAgeMs = 15 * 60_000 } = {}) {
  const syncedAt = Date.parse(snapshot?.syncedAt || '');
  return Number.isFinite(syncedAt) && syncedAt <= now && now - syncedAt <= maxAgeMs;
}
