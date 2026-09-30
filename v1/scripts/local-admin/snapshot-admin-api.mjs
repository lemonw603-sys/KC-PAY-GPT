// 本机演示后台的「不登录渲染」：用生产同一套服务函数，对演示库算出后台三页（工作台、卡片、设置）要读的接口数据，
// 写成一份 JSON；配合同目录外的静态页（真 admin.js / css，只把 fetch 换成读这份 JSON）截图看效果。
// 只读、只连本机演示库（DATABASE_URL 由 local-admin.sh 的库给），不碰生产、不改任何数据。
//   node scripts/local-admin/snapshot-admin-api.mjs <输出.json>
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { createAdminReadService } from '../../src/services/admin-read-service.js';
import { createCardStockService } from '../../src/services/card-stock-service.js';
import { createHighvccCardService } from '../../src/services/highvcc-card-service.js';
import { createCardSupplyPolicyAdminService } from '../../src/services/card-supply-policy-admin-service.js';
import { createCardSourceAdminService } from '../../src/services/card-source-admin-service.js';
import { createCardOperationalOverrideService } from '../../src/services/card-operational-override-service.js';
import { createCardRetirementService } from '../../src/services/card-retirement-service.js';
import { buildAdminReadinessSummary } from '../../src/services/admin-readiness-summary.js';

const url = process.env.DATABASE_URL;
if (!url || !/\/pojia_local_admin(_[a-z0-9]+)?$/.test(url)) { console.error('只允许本机演示库 pojia_local_admin'); process.exit(2); }
const key = Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64');
const panKey = Buffer.from(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64, 'base64');
const pool = mysql.createPool({ uri: url, connectionLimit: 4, timezone: 'Z' });
try {
  const adminRead = createAdminReadService({ pool, sessionEncryptionKey: key, panHmacKey: panKey });
  const stock = createCardStockService({ pool, sessionEncryptionKey: key, panHmacKey: panKey });
  const [overview, stockStatus] = await Promise.all([adminRead.getOverview(), stock.status()]);
  const defaultId = stockStatus.provider?.defaultCardTypeId;
  const defaultCardTypeReady = stockStatus.provider?.cardTypes?.some((item) => String(item.id) === String(defaultId)) === true;
  const out = {
    '/api/v1/admin/session': { authenticated: true },
    '/api/v1/admin/overview': { ...overview, readiness: buildAdminReadinessSummary(overview, { defaultCardTypeReady }) },
    '/api/v1/admin/alerts': await adminRead.listAlerts({}),
    '/api/v1/admin/card-stock': stockStatus,
    '/api/v1/admin/backup-cards/highvcc/status': await createHighvccCardService({ pool, encryptionKey: key, panHmacKey: panKey }).tokenStatus(),
    '/api/v1/admin/settings/supply': await createCardSupplyPolicyAdminService({ pool }).list(),
    '/api/v1/admin/card-sources': await createCardSourceAdminService({ pool }).list(),
    '/api/v1/admin/card-operational-overrides': await createCardOperationalOverrideService({ pool }).list({}),
    '/api/v1/admin/card-retirement/candidates': await createCardRetirementService({ pool }).list({})
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
  console.log('snapshot written:', Object.keys(out).length, 'endpoints');
} finally { await pool.end(); }
