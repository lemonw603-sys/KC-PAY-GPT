import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider } from '../src/providers/index.js';
import { syncCardCatalog } from '../src/services/card-catalog-sync-service.js';
import { createCardIntakeService } from '../src/services/card-intake-service.js';
import { createCardIntakeRepository } from '../src/db/repositories/card-intake-repository.js';
import { refreshProviderSnapshot } from '../src/services/card-provider-snapshot-service.js';
import { createProviderBalanceSnapshotService } from '../src/services/provider-balance-snapshot-service.js';
import { resolveCurrentCardProviderAccountId } from '../src/services/provider-route-service.js';

if (isEnvTrue(process.env.PROVIDER_WRITES_ENABLED) || isEnvTrue(process.env.PROVIDER_CARD_WRITES_ENABLED)) {
  throw new Error('Card catalog sync refuses to run with provider writes enabled');
}

const config = loadConfig();
const pool = createDatabasePool(config.database);
const providerAccountId = await resolveCurrentCardProviderAccountId(pool);
if (!providerAccountId) throw new Error('No active production card provider route');
const provider = new HnskjCardProvider({
  baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
  apiKey: String(process.env.HNSKJ_API_KEY || '')
});
const [[settings]] = await pool.query(
  `SELECT MAX(CASE WHEN setting_key = 'default_card_type_id' THEN setting_value END) AS card_type_id,
          MAX(CASE WHEN setting_key = 'default_minimum_required_card_balance' THEN setting_value END) AS minimum_balance
   FROM app_settings`
);
const balanceSnapshots = createProviderBalanceSnapshotService({ pool });

async function markProviderSnapshotHealth({ status, message }) {
  const dedupeKey = 'provider-snapshot:hnskj';
  if (status === 'OPEN') {
    await pool.query(
      `INSERT INTO operator_alerts
       (id, alert_type, dedupe_key, severity, title, message, status)
       VALUES (UUID(), 'PROVIDER_SNAPSHOT_STALE', ?, 'critical', '卡台信息暂时无法更新', ?, 'OPEN')
       ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
         message = VALUES(message),
         status = IF(status = 'RESOLVED', 'OPEN', status),
         acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
      [dedupeKey, message]
    );
  } else {
    await pool.query(
      `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = CURRENT_TIMESTAMP(3)
       WHERE dedupe_key = ? AND status = 'OPEN'`, [dedupeKey]
    );
  }
}

try {
  // Catalog synchronization is read-only. Refresh the provider balance/rules
  // snapshot here as well so the admin affordability view is not dependent on
  // the write-enabled card-stock runner.
  let providerSnapshot;
  try {
    providerSnapshot = await refreshProviderSnapshot(pool, provider, {
      balanceSnapshotService: balanceSnapshots,
      providerAccountId
    });
    await markProviderSnapshotHealth({ status: 'RESOLVED' });
  } catch (error) {
    const code = String(error?.code || error?.kind || 'PROVIDER_SNAPSHOT_SYNC_FAILED').slice(0, 80);
    await markProviderSnapshotHealth({
      status: 'OPEN',
      message: `卡台余额或开卡规则暂时没有更新成功（${code}）。系统已暂停使用旧数据开卡，请稍后刷新。`
    });
    throw error;
  }
  const intake = createCardIntakeService({
    provider,
    repository: createCardIntakeRepository({ pool }),
    providerAccountId,
    sessionEncryptionKey: config.sessionEncryptionKey,
    assumeDedicatedAccount: true,
    validationRules: {
      allowedCardTypeIds: [String(settings.card_type_id || '')],
      allowedCardTypes: providerSnapshot.cardTypes || [],
      minimumBalance: String(settings.minimum_balance || '')
    }
  });
  const catalog = await syncCardCatalog({ pool, provider, intake });
  console.log(JSON.stringify({ ...catalog, providerSnapshotSyncedAt: providerSnapshot.syncedAt }));
} finally {
  await pool.end();
}
