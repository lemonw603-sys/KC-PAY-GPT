// 「演示精简版」造数：按 shape.json（生产聚合）往本机隔离库里造一份形状一样、每一行都是假的数据。
//
// 假在哪：邮箱全是 @demo.invalid；订单号、卡号（BIN 51000099 / 40000099，Luhn 校验合法但不存在）、尾号、
// 外部卡号、卡密、Session、token、直充单号全部现场随机生成；原因、提醒、备注等文字用固定模板。
// 像在哪：各表每组的个数、日偏移（UTC+8 自然日，相对「现在」往回推）、状态、开关、门槛、钱包量级、
// 以及账本/占用/覆盖/流水这些决定「剩几张·能充几单」「成功率」的关系，与快照一致（verify.mjs 逐节比对）。
//
// 只写传进来的连接池（scripts/local-admin.sh 只会给它本机 pojia_local_admin* 库）。不连外网、不连生产。
import crypto from 'node:crypto';
import { encryptSecret } from '../../src/security/secret-box.js';
import { createAdminCdkService } from '../../src/services/cdk-service.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
export const FAKE_EMAIL_DOMAIN = 'demo.invalid';
export const FAKE_HIGHVCC_TOKEN = 'local-admin-demo-token-not-a-real-highvcc-token';
/** 假卡段：highvcc 形状的卡用 51000099，hnskj 形状的卡用 40000099。offline-guard 的卡段列表与之对应。 */
export const FAKE_BINS = { manual_excel: '51000099', hnskj: '40000099' };

/** 分桶的代表值（造数取值）。与 shape-queries.mjs 的 BALANCE_BUCKETS 一一对应。 */
const BUCKET_VALUE = {
  neg: '-1.00', 0: '0.00', '0-1': '0.40', '1-5': '2.84', '5-16': '9.60', '16-17': '16.00', '17-50': '32.00',
  '50-75': '50.00', '75-95': '80.00', '95-150': '100.00', '150+': '150.00'
};
const BUCKET_RANGE = {
  neg: [-1e9, 0], 0: [0, 0], '0-1': [0.000001, 0.999999], '1-5': [1, 4.999999], '5-16': [5, 15.999999],
  '16-17': [16, 16.999999], '17-50': [17, 49.999999], '50-75': [50, 75], '75-95': [75.000001, 94.999999],
  '95-150': [95, 149.999999], '150+': [150, 1e9]
};
const bucketOf = (value) => {
  if (value == null) return 'null';
  const n = Number(value);
  for (const [name, [lo, hi]] of Object.entries(BUCKET_RANGE)) if (n >= lo && n <= hi) return name;
  return 'null';
};

const FAILURE_TEXT = {
  BROWSER_RETRY_LIMIT: '浏览器重试次数用完，停在付款前',
  CANCELLED_PRE_SUBMISSION: '付款前取消，卡密已退回',
  CARD_DECLINED: '卡被拒付（发卡行拒绝）',
  CHATGPT_ACCESS_BLOCKED: 'ChatGPT 拒绝访问（地区或风控）',
  CHECKOUT_DRIFT: '结账页和冻结合同对不上，停在付款前',
  CHECKOUT_NAVIGATION_FAILED: '打不开结账页',
  CHECKOUT_OBSERVATION_FAILED: '结账页读不到价格框',
  HUMAN_VERIFIED_NOT_CHARGED: '人工核实：没有扣款',
  PAGE_CHECKPOINT_FAILED: '页面检查点没通过',
  PAGE_DRIFT: '页面结构变化',
  PAYMENT_EXECUTION_FAILED: '付款执行失败',
  PROFILE_PAGE_AMBIGUOUS: '账号页状态看不明白',
  PROVIDER_CONFIRMED_FAILURE: '直充平台确认失败',
  RECHARGE_SUBMIT_REJECTED: '直充平台拒绝提交'
};
const NAVIGATION_TEXT = {
  CHECKOUT_DRIFT: 'price box not found in expected column (demo)',
  CHECKOUT_NAVIGATION_FAILED: 'navigation timeout after 45000ms (demo)',
  CHECKOUT_OBSERVATION_FAILED: 'checkout observation returned no plan price (demo)',
  PAGE_CHECKPOINT_FAILED: 'checkpoint signature mismatch (demo)'
};
const ALERT_TEXT = {
  BROWSER_ORDER_SUBMITTED: ['新订单已提交', '客户提交了一单，浏览器执行器已接手'],
  BROWSER_ORDER_COMPLETED: ['订单已完成', '充值成功，续费已关'],
  BROWSER_PAYMENT_CONFIRMED: ['付款已确认', '卡台看到了这笔扣款'],
  BROWSER_ORDER_FAILED: ['订单失败', '停在付款前，卡密已退回'],
  BROWSER_PAYMENT_UNKNOWN: ['付款结果不明', '点击付款后没拿到结果，先核实，不要重付'],
  BROWSER_ORDER_STALLED: ['订单卡住了', '执行器超过 10 分钟没有进展'],
  BROWSER_HUMAN_REQUIRED: ['需要人工接手', '页面需要人工处理'],
  PROVIDER_BALANCE_CHANGED: ['卡台余额变化', '钱包余额和上次查询不一样'],
  PROVIDER_WALLET_LOW: ['卡台钱包偏低', '钱包低于提醒线'],
  PROVIDER_SNAPSHOT_STALE: ['卡台快照过期', '超过 10 分钟没读到卡台'],
  PROVIDER_TOKEN_EXPIRED: ['highvcc 登录失效', '重新贴一次 token'],
  CARD_STOCK_LOW: ['可分配卡偏少', '可分配卡低于水位'],
  CARD_STOCK_EMPTY: ['没有可分配的卡', '新单会等卡'],
  CARD_SUPPLY_FAULT: ['供卡故障', '卡台暂时开不出卡'],
  CARD_SUPPLY_BLOCKED: ['补卡被挡住', '钱包或卡台状态不允许自动开卡'],
  CARD_SUPPLY_OPEN_FAILED: ['自动开卡失败', '卡台返回失败'],
  CARD_SUPPLY_WALLET_LOW: ['钱包不够开卡', '充值后才能继续自动开卡'],
  ORDER_WAITING_FOR_CARD: ['客户在等卡', '有订单在等可分配的卡'],
  EXECUTOR_OFFLINE: ['执行器离线', '心跳超过 2 分钟没更新'],
  DAILY_RECONCILIATION_SUMMARY: ['日对账', '昨夜日对账已跑完']
};
const OVERRIDE_REASON = {
  MANUAL_USED: 'MANUAL_USED: 演示数据（手动用卡）',
  'manual-used': 'highvcc-manual-used 演示数据',
  PROVIDER_VOIDED: 'PROVIDER_VOIDED: 演示数据（卡台已作废）',
  OTHER: '演示数据：运营停用'
};

// ---------------------------------------------------------------------------------------------
// 小工具

/** 可复现的伪随机（同一份快照每次造出同样的分布与取值；时间仍相对「现在」）。 */
function createRng(seedText) {
  let a = crypto.createHash('sha256').update(String(seedText)).digest().readUInt32LE(0);
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chars: (n, alphabet = 'abcdefghjkmnpqrstuvwxyz23456789') =>
      Array.from({ length: n }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
  };
}
const uuid = () => crypto.randomUUID();
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const bool = (value) => Number(value) === 1 || value === true;
const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

function luhnComplete(prefix, length = 16) {
  const digits = prefix.split('').map(Number);
  while (digits.length < length - 1) digits.push(crypto.randomInt(10));
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = digits[digits.length - 1 - i];
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  digits.push((10 - (sum % 10)) % 10);
  return digits.join('');
}

function fakeSession({ email, accountId, createdAt }) {
  const iat = Math.floor(createdAt / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return JSON.stringify({
    user: { id: `user-demo${hex(6)}`, email },
    account: { id: accountId },
    accessToken: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iat, exp: iat + 10 * 86400, demo: true })}.demo`,
    sessionToken: ['demo', '', hex(8), hex(8), hex(8)].join('.'),
    expires: new Date(createdAt + 30 * DAY).toISOString()
  });
}

/** 批量插入（mysql2 的 VALUES ?）。 */
async function insertRows(db, table, columns, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    if (!chunk.length) continue;
    await db.query(`INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES ?`,
      [chunk.map((row) => columns.map((c) => (row[c] === undefined ? null : row[c])))]);
  }
}

// ---------------------------------------------------------------------------------------------

export async function seedLocalAdmin({ pool, shape, keys, now = new Date() }) {
  const rng = createRng(shape.capturedAt || 'local-admin');
  const nowMs = now.getTime();
  // UTC+8 的「今天 00:00」对应的 UTC 毫秒
  const todayStart = Math.floor((nowMs + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
  /** 某个 UTC+8 自然日里一个像样的时刻（白天偏多）；今天的不晚于现在。 */
  const timeOnDay = (offset) => {
    const start = todayStart - Number(offset || 0) * DAY;
    if (Number(offset || 0) === 0) {
      const span = Math.max(MINUTE, nowMs - start - 3 * MINUTE);
      return start + Math.floor(rng.next() * span);
    }
    return start + 9 * HOUR + Math.floor(rng.next() * 14 * HOUR);
  };
  const ago = (seconds) => (seconds == null ? null : new Date(nowMs - Number(seconds) * 1000));
  const sessionKey = keys.sessionEncryptionKey;
  const stats = {};
  const count = (name, n = 1) => { stats[name] = (stats[name] || 0) + n; };

  const [providerRows] = await pool.query('SELECT id, provider_code, account_code FROM provider_accounts');
  const providerId = new Map(providerRows.map((r) => [r.provider_code, r.id]));
  const [productRows] = await pool.query('SELECT id, product_code, legacy_plan_type FROM products');
  const productIdByPlan = new Map(productRows.map((r) => [r.legacy_plan_type, r.id]));
  const productIdByCode = new Map(productRows.map((r) => [r.product_code, r.id]));
  const [routeRows] = await pool.query('SELECT id, route_code, executor_kind, recharge_provider_account_id FROM fulfillment_routes');
  const routeByCode = new Map(routeRows.map((r) => [r.route_code, r]));
  const [profileRows] = await pool.query("SELECT id, profile_code FROM executor_profiles WHERE executor_kind = 'BROWSER' ORDER BY created_at LIMIT 1");
  const browserProfileId = profileRows[0]?.id || null;

  // ---- 1. 开关、门槛、心跳、token ----------------------------------------------------------
  const setSetting = (key, value, updatedAt = null) => pool.query(
    `INSERT INTO app_settings (setting_key, setting_value${updatedAt ? ', updated_at' : ''}) VALUES (?, ?${updatedAt ? ', ?' : ''})
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)${updatedAt ? ', updated_at = VALUES(updated_at)' : ''}`,
    updatedAt ? [key, value, updatedAt] : [key, value]);
  for (const [key, value] of Object.entries(shape.settings?.values || {})) await setSetting(key, value);
  for (const [key, age] of Object.entries(shape.settings?.heartbeatAges || {})) {
    if (age != null) await setSetting(key, ago(age).toISOString());
  }
  if (shape.settings?.highvccToken?.configured) {
    await setSetting('highvcc_access_token_ciphertext', encryptSecret(FAKE_HIGHVCC_TOKEN, sessionKey).toString('base64'),
      ago(shape.settings.highvccToken.ageSeconds ?? 0));
  }
  const dailyReport = shape.settings?.dailyReport;
  if (dailyReport) {
    const at = ago(dailyReport.ageSeconds ?? 0);
    await setSetting('daily_reconciliation_last_report', JSON.stringify({
      date: new Date(at.getTime() + 8 * HOUR).toISOString().slice(0, 10),
      generatedAt: at.toISOString(),
      persistentFingerprints: Array.from({ length: Number(dailyReport.persistent || 0) }, () => hex(16)),
      discrepancyFingerprints: Array.from({ length: Number(dailyReport.discrepancies || 0) }, () => hex(16))
    }), at);
  }
  count('app_settings', Object.keys(shape.settings?.values || {}).length);

  // ---- 2. 卡台、钱包、路线、策略 ------------------------------------------------------------
  for (const p of shape.providers || []) {
    const id = providerId.get(p.providerCode);
    if (!id) continue;
    await pool.query(
      `UPDATE provider_accounts SET display_name = ?, supply_fault_state = ?, supply_fault_reason = ?, supply_fault_at = ?,
          wallet_floor = ?, wallet_alert_threshold = ?, operational_enabled = ?, read_enabled = ?, write_enabled = ?,
          circuit_state = ?, default_card_segment = ?, last_full_snapshot_at = ? WHERE id = ?`,
      [p.displayName, p.supplyFaultState || 'OK', p.supplyFaultReason, ago(p.supplyFaultAgeSeconds), p.walletFloor,
        p.walletAlertThreshold, p.operationalEnabled ?? 1, p.readEnabled ?? 0, p.writeEnabled ?? 0, p.circuitState || 'CLOSED',
        p.defaultCardSegment, ago(p.lastFullSnapshotAgeSeconds), id]);
    if (p.walletBalance != null) {
      // 最新一条就是工作台「钱包 X USD · 查询于」；往前补几条历史，金额在量级内小幅波动。
      const history = Math.min(Math.max(Number(p.balanceSnapshots || 1), 1), 24);
      const rows = [];
      for (let i = history - 1; i >= 0; i -= 1) {
        const drift = i === 0 ? 0 : (rng.next() - 0.5) * 4;
        rows.push({ provider_account_id: id, currency: p.walletCurrency || 'USD',
          available_balance: money(Math.max(0, Number(p.walletBalance) + drift)),
          payload_hash: hex(32), observed_at: new Date(nowMs - Number(p.walletAgeSeconds || 0) * 1000 - i * HOUR) });
      }
      await insertRows(pool, 'provider_balance_snapshots',
        ['provider_account_id', 'currency', 'available_balance', 'payload_hash', 'observed_at'], rows);
      count('provider_balance_snapshots', rows.length);
    }
  }
  const snap = shape.hnskjSnapshot;
  if (snap) {
    const defaultType = String(shape.settings?.values?.default_card_type_id || '23');
    const cardTypes = Array.from({ length: Number(snap.cardTypeCount || 0) }, (_, i) => ({
      id: i === 0 ? defaultType : String(100 + i), name: `演示卡段 ${i + 1}`, country: 'US', binPrefix: FAKE_BINS.hnskj.slice(0, 6),
      effectiveCardFee: '1.00', effectiveFeeRate: '0.02', minimumAmount: '10', maximumAmount: '500',
      minimumAccountBalance: '0', requireMinimumAccountBalance: false, consumeRate: '0', chargebackFee: '0', maintaining: false
    }));
    const syncedAt = ago(snap.ageSeconds ?? 0);
    await pool.query(
      `INSERT INTO card_provider_snapshots (provider, payload_json, synced_at) VALUES ('hnskj', ?, ?)
       ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), synced_at = VALUES(synced_at)`,
      [JSON.stringify({ provider: 'hnskj', syncedAt: syncedAt.toISOString(), purchaseEnabled: Boolean(snap.purchaseEnabled),
        accountBalance: money(snap.accountBalance ?? 0), currency: snap.currency || 'USD', exchangeRate: snap.exchangeRate || '1',
        cardLimit: snap.cardLimit || { current: 0, maximum: 0, remaining: 0 }, cardTypes }), syncedAt]);
    count('card_provider_snapshots');
  }
  const config = shape.config || {};
  for (const sp of config.supplyPolicies || []) {
    const id = providerId.get(sp.providerCode);
    if (!id) continue;
    await pool.query(
      `INSERT INTO card_supply_policies (provider_account_id, product_code, target_available, open_card_amount, daily_open_limit, card_segment, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'local-admin') ON DUPLICATE KEY UPDATE target_available = VALUES(target_available),
         open_card_amount = VALUES(open_card_amount), daily_open_limit = VALUES(daily_open_limit), card_segment = VALUES(card_segment),
         updated_by = VALUES(updated_by)`,
      [id, sp.productCode, sp.targetAvailable, sp.openCardAmount, sp.dailyOpenLimit, sp.cardSegment]);
  }
  for (const cs of config.cardSources || []) {
    const pid = productIdByCode.get(cs.productCode);
    const aid = providerId.get(cs.providerCode);
    if (!pid || !aid) continue;
    await pool.query(
      `INSERT INTO card_source_selections (product_id, executor_kind, provider_account_id, locked, updated_by)
       VALUES (?, ?, ?, ?, 'local-admin') ON DUPLICATE KEY UPDATE provider_account_id = VALUES(provider_account_id),
         locked = VALUES(locked), updated_by = VALUES(updated_by)`, [pid, cs.executorKind, aid, cs.locked ? 1 : 0]);
  }
  for (const route of config.routes || []) {
    await pool.query('UPDATE fulfillment_routes SET accepts_new_orders = ?, retired_at = ? WHERE route_code = ?',
      [route.acceptsNewOrders ? 1 : 0, route.retired ? new Date(nowMs - 30 * DAY) : null, route.routeCode]);
  }
  for (const profile of config.executorProfiles || []) {
    await pool.query(
      `UPDATE executor_profiles SET status = ?, config_public_json = JSON_SET(COALESCE(config_public_json, JSON_OBJECT()),
         '$.productionWritesEnabled', CAST(? AS JSON)) WHERE profile_code = ?`,
      [profile.status, profile.productionWritesEnabled ? 'true' : 'false', profile.profileCode]);
  }
  for (const product of config.products || []) {
    await pool.query('UPDATE products SET status = ? WHERE product_code = ?', [product.status, product.productCode]);
  }

  // ---- 3. 卡密（用正式的批次生成服务，再按快照改状态） ----------------------------------------
  const createBatch = createAdminCdkService({ pool, cdkHashKey: keys.cdkHashKey, cdkRecoveryKey: keys.cdkRecoveryKey,
    now: () => new Date(batchClock) });
  let batchClock = nowMs;
  const cdkGroupsByBatch = new Map();
  for (const row of shape.cdks || []) {
    const key = row.batchOrdinal ?? 'none';
    if (!cdkGroupsByBatch.has(key)) cdkGroupsByBatch.set(key, []);
    cdkGroupsByBatch.get(key).push(row);
  }
  const cdkPool = []; // { id, status, orderLinked, slots }
  const batches = [...(shape.cdkBatches || [])].sort((a, b) => a.ordinal - b.ordinal);
  // 批次序号＝按创建时间排的名次：同一天的几批先各取一个时刻、排好序再按序号分，序号才对得上。
  const batchTimes = new Map();
  for (const batch of batches) {
    if (!batchTimes.has(batch.dayOffset)) batchTimes.set(batch.dayOffset, []);
    batchTimes.get(batch.dayOffset).push(timeOnDay(batch.dayOffset));
  }
  for (const times of batchTimes.values()) times.sort((a, b) => a - b);
  for (const batch of batches) {
    const groups = cdkGroupsByBatch.get(batch.ordinal) || [];
    const total = groups.reduce((n, g) => n + Number(g.count), 0);
    const createdAt = batchTimes.get(batch.dayOffset).shift();
    const batchNo = `B-${new Date(createdAt).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${String(batch.ordinal).padStart(3, '0')}${rng.chars(3, 'ABCDEF0123456789')}`;
    if (total > 0) {
      batchClock = createdAt;
      await createBatch({ count: total, planType: batch.planType, requestKey: `local-admin-batch-${batch.ordinal}`,
        batchNo, issuanceKind: 'NORMAL', expiryMode: 'NEVER', note: batch.hasChannelNote ? '演示渠道' : '' });
    } else {
      await pool.query(`INSERT INTO cdk_batches (batch_no, request_key, plan_type, requested_count, created_by, created_at)
        VALUES (?, ?, ?, ?, 'admin', ?)`, [batchNo, `local-admin-batch-${batch.ordinal}`, batch.planType, batch.requestedCount, new Date(createdAt)]);
    }
    await pool.query(`UPDATE cdk_batches SET requested_count = ?, revoked_at = ?, revoke_reason = ?, issued_at = ?,
        sale_amount = ?, sale_currency = ?, channel_note = ? WHERE batch_no = ?`,
    [batch.requestedCount, batch.revoked ? new Date(createdAt + HOUR) : null, batch.revoked ? '演示数据：整批作废' : null,
      batch.issued ? new Date(createdAt) : null, batch.saleAmount, batch.saleAmount == null ? null : (batch.saleCurrency || 'CNY'),
      batch.hasChannelNote ? '演示渠道' : null, batchNo]);
    const [ids] = await pool.query('SELECT id FROM cdks WHERE batch_no = ? ORDER BY created_at, id', [batchNo]);
    let cursor = 0;
    for (const g of groups) {
      for (let i = 0; i < Number(g.count); i += 1) {
        const id = ids[cursor]?.id;
        cursor += 1;
        if (!id) continue;
        await pool.query(`UPDATE cdks SET status = ?, plan_type = ?, issuance_kind = ?, issued_at = ?, issued_note = ?,
            expires_at = ?, redeemed_at = ?, revoked_at = ?, revoke_reason = ? WHERE id = ?`,
        [g.status, g.planType, g.issuanceKind, bool(g.issued) ? new Date(createdAt) : null, bool(g.hasIssuedNote) ? '演示：已发给测试渠道' : null,
          bool(g.expires) ? new Date(bool(g.expired) ? nowMs - DAY : nowMs + 90 * DAY) : null,
          g.status === 'REDEEMED' ? new Date(createdAt + HOUR) : null,
          g.status === 'REVOKED' ? new Date(createdAt + 2 * HOUR) : null, g.status === 'REVOKED' ? '演示数据：作废' : null, id]);
        cdkPool.push({ id, status: g.status, orderLinked: bool(g.orderLinked), slots: Number(g.orderRefs || 0), orders: [] });
      }
    }
    count('cdk_batches');
  }
  // 不属于任何批次的卡密（早期导入的旧码）：直接插，码的哈希随机生成（本来就没人拿得到明文）。
  for (const g of cdkGroupsByBatch.get('none') || []) {
    for (let i = 0; i < Number(g.count); i += 1) {
      const id = uuid();
      const createdAt = nowMs - 40 * DAY - rng.int(0, 10) * DAY;
      await pool.query(`INSERT INTO cdks (id, code_hash, status, batch_no, plan_type, issuance_kind, issued_at, expires_at,
          redeemed_at, revoked_at, revoke_reason, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, hex(32), g.status, g.planType, g.issuanceKind, bool(g.issued) ? new Date(createdAt) : null,
        bool(g.expires) ? new Date(bool(g.expired) ? nowMs - DAY : nowMs + 90 * DAY) : null,
        g.status === 'REDEEMED' ? new Date(createdAt + HOUR) : null,
        g.status === 'REVOKED' ? new Date(createdAt + 2 * HOUR) : null, g.status === 'REVOKED' ? '演示数据：作废' : null,
        new Date(createdAt)]);
      cdkPool.push({ id, status: g.status, orderLinked: bool(g.orderLinked), slots: Number(g.orderRefs || 0), orders: [] });
    }
  }
  count('cdks', cdkPool.length);

  // ---- 4. 卡（先不连订单） ----------------------------------------------------------------
  const cards = [];
  const cardRows = [];
  for (const g of shape.cards || []) {
    for (let i = 0; i < Number(g.count); i += 1) {
      const aid = providerId.get(g.providerCode);
      if (!aid) continue;
      const pan = luhnComplete(FAKE_BINS[g.providerCode] || '51000099');
      const external = g.providerCode === 'hnskj' ? `9${rng.chars(9, '0123456789')}` : `hv-demo-${rng.chars(10, '0123456789')}`;
      const createdAt = timeOnDay(g.createdDayOffset);
      const card = {
        id: uuid(), providerCode: g.providerCode, providerAccountId: aid, external, group: g, createdAt,
        balance: g.balanceBucket === 'null' ? null : BUCKET_VALUE[g.balanceBucket],
        funded: g.fundedBucket === 'null' ? null : BUCKET_VALUE[g.fundedBucket],
        ledger: [], assignments: [], orderIds: new Set()
      };
      cards.push(card);
      const syncAt = (state, windowMs) => (state === 'never' ? null : new Date(state === 'fresh' ? nowMs - windowMs : nowMs - 3 * DAY));
      cardRows.push({
        id: card.id, provider_account_id: aid, inventory_status: g.inventoryStatus, intake_status: g.intakeStatus,
        assigned_at: bool(g.activeAssignment) ? new Date(nowMs - 20 * MINUTE) : null,
        provider_card_id: g.providerCode === 'hnskj' ? external : `demo-${external}`, external_card_id: external,
        card_type_id: g.cardTypeId || '0', last4: pan.slice(-4), card_bin: pan.slice(0, 8), status: g.status,
        funded_amount: card.funded, current_balance: card.balance, currency: g.currency || 'USD',
        refund_status: g.refundStatus, sync_tier: g.syncTier, source_present: g.sourcePresent ?? 1,
        source_operational_status: g.sourceOperationalStatus,
        last_successful_sync_at: syncAt(g.lastSuccessfulSync, 30 * MINUTE),
        last_synced_at: syncAt(g.lastSync, 30 * MINUTE),
        last_transaction_synced_at: syncAt(g.lastTxSync, 5 * MINUTE),
        card_credentials_ciphertext: bool(g.hasCredentials)
          ? encryptSecret(JSON.stringify({ cardNumber: pan, expiryMonth: '12', expiryYear: '2031', cvv: '000' }), sessionKey) : null,
        card_number_ciphertext: bool(g.hasNumber) ? encryptSecret(pan, sessionKey) : null,
        pan_hmac: bool(g.hasPanHmac) && keys.cardIntakePanHmacKey
          ? crypto.createHmac('sha256', keys.cardIntakePanHmacKey).update(pan).digest('hex') : null,
        pan_hmac_version: bool(g.hasPanHmac) ? 1 : null,
        created_at: new Date(createdAt), updated_at: new Date(Math.max(createdAt, nowMs - 2 * HOUR))
      });
    }
  }
  await insertRows(pool, 'cards', Object.keys(cardRows[0] || { id: 1 }), cardRows);
  count('cards', cardRows.length);

  // ---- 5. 订单、事件、付款尝试、Browser run ------------------------------------------------
  const cdkSlots = new Map(); // status → [cdk, cdk, ...]（按 orderRefs 展开）
  for (const cdk of cdkPool) {
    if (!cdkSlots.has(cdk.status)) cdkSlots.set(cdk.status, []);
    for (let i = 0; i < cdk.slots; i += 1) cdkSlots.get(cdk.status).push(cdk);
  }
  const orders = [];
  const orderRows = [];
  const eventRows = [];
  const attemptRows = [];
  const runRows = [];
  const runEventRows = [];
  const FINISHED = new Set(['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED', 'CARD_FAILED']);
  const workerId = { pool: 'pool:demo-mac-1', production: 'production-demo-worker', local: 'local-demo', other: 'demo-worker', none: null };
  for (const g of shape.orders || []) {
    for (let i = 0; i < Number(g.count); i += 1) {
      const route = routeByCode.get(g.routeCode) || null;
      const createdAt = timeOnDay(g.dayOffset);
      const finished = FINISHED.has(g.status);
      const duration = Math.max(60, Number(g.avgDurationSeconds || 600));
      const finishedAt = finished ? Math.min(createdAt + duration * 1000, nowMs - MINUTE) : null;
      const slots = cdkSlots.get(g.cdkStatus) || [];
      const cdk = slots.shift() || cdkPool.find((c) => c.status === g.cdkStatus) || cdkPool[0];
      const email = `${rng.chars(6)}${rng.int(10, 99)}@${FAKE_EMAIL_DOMAIN}`;
      const accountId = `demo-acct-${hex(8)}`;
      const order = {
        id: uuid(), publicNo: `PJV1-${crypto.randomBytes(15).toString('base64url')}`, group: g, status: g.status,
        planType: g.planType, cardProvider: g.cardProvider, createdAt, finishedAt: finishedAt ?? createdAt,
        success: g.status === 'RECHARGE_SUCCESS' || (g.status === 'CLOSED' && g.closedLastStatus === 'RECHARGE_SUCCESS'),
        attempts: [], cardIds: new Set(), latestAttemptId: null
      };
      orders.push(order);
      if (cdk) cdk.orders.push(order);
      orderRows.push({
        id: order.id, public_no: order.publicNo, cdk_id: cdk?.id, status: g.status, plan_type: g.planType,
        product_id: productIdByPlan.get(g.planType) || null, fulfillment_route_id: route?.id || null,
        frozen_card_provider_account_id: g.cardProvider ? providerId.get(g.cardProvider) || null : null,
        route_resolution_status: g.routeResolution || 'RESOLVED',
        customer_email: email, chatgpt_account_id: accountId,
        session_ciphertext: encryptSecret(fakeSession({ email, accountId, createdAt }), sessionKey),
        card_purchase_idempotency_key: `local-admin-${uuid()}`,
        recharge_order_no: bool(g.hasRechargeOrderNo) ? `DEMO${rng.chars(14, '0123456789')}` : null,
        actual_payment_amount: g.avgPayment == null ? null : money(g.avgPayment),
        actual_payment_currency: g.paymentCurrency,
        subscription_cancelled: g.subscriptionCancelled,
        cancellation_checked_at: g.subscriptionCancelled == null ? null : new Date(order.finishedAt + 5 * MINUTE),
        cancellation_review_required: g.cancellationReviewRequired ? 1 : 0,
        failure_code: g.failureCode,
        failure_reason: bool(g.hasFailureReason) ? (FAILURE_TEXT[g.failureCode] || '演示数据：失败') : null,
        customer_action_code: g.customerActionCode,
        session_replacement_count: Number(g.sessionReplacements || 0),
        last_session_replaced_at: Number(g.sessionReplacements || 0) > 0 ? new Date(createdAt + 10 * MINUTE) : null,
        created_at: new Date(createdAt), updated_at: new Date(order.finishedAt), finished_at: finishedAt ? new Date(finishedAt) : null
      });

      // 事件：客户提交 → 分卡 → 提交付款 → 结局（CLOSED 先落到关单前状态再关）；有人动过就在结局前插一条 ADMIN。
      const events = [{ from: null, to: 'CREATED', actor: 'CUSTOMER', reason: 'customer submitted (demo)' }];
      if (bool(g.cardAssigned) || g.cardProvider) events.push({ from: 'CREATED', to: 'CARD_READY', actor: 'WORKER', reason: 'card assigned (demo)' });
      const beforeFinal = g.status === 'CLOSED' ? (g.closedLastStatus || 'RECHARGE_FAILED') : g.status;
      const last = () => events[events.length - 1].to;
      if (['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'SUBMIT_UNKNOWN'].includes(beforeFinal) && g.attemptCount > 0) {
        events.push({ from: last(), to: 'SUBMITTING', actor: 'WORKER', reason: 'payment submitted (demo)' });
        if (beforeFinal === 'RECHARGE_SUCCESS') events.push({ from: last(), to: 'RECHARGE_PROCESSING', actor: 'WORKER', reason: 'waiting for confirmation (demo)' });
      }
      if (bool(g.successEvent) && beforeFinal !== 'RECHARGE_SUCCESS') {
        events.push({ from: last(), to: 'RECHARGE_SUCCESS', actor: 'WORKER', reason: 'recharge confirmed (demo)' });
      }
      if (last() !== beforeFinal) events.push({ from: last(), to: beforeFinal, actor: 'WORKER', reason: 'order finished (demo)' });
      if (bool(g.humanTouched)) events.push({ from: last(), to: last(), actor: 'ADMIN', reason: 'operator action in admin (demo)' });
      if (g.status === 'CLOSED') events.push({ from: last(), to: 'CLOSED', actor: bool(g.humanTouched) ? 'ADMIN' : 'SYSTEM', reason: 'order closed (demo)' });
      events.forEach((e, idx) => eventRows.push({
        order_id: order.id, from_status: e.from, to_status: e.to, actor_type: e.actor, actor_id: e.actor === 'ADMIN' ? 'admin' : null,
        reason: e.reason, created_at: new Date(createdAt + Math.floor(((order.finishedAt - createdAt) * idx) / Math.max(1, events.length - 1)))
      }));

      // 付款尝试：最新一次按快照；更早的都是「已清」。Browser run 挂在尝试上，最新一次按快照。
      const attemptCount = Number(g.attemptCount || 0);
      const runCount = Number(g.runCount || 0);
      const attemptIds = [];
      for (let a = 0; a < attemptCount; a += 1) {
        const latest = a === attemptCount - 1;
        const executor = g.attemptExecutor || route?.executor_kind || 'BROWSER';
        const at = createdAt + Math.floor(((order.finishedAt - createdAt) * (a + 1)) / (attemptCount + 1));
        const id = uuid();
        attemptIds.push({ id, executor, at });
        attemptRows.push({
          id, order_id: order.id, fulfillment_route_id: route?.id || null,
          provider_account_id: executor === 'API' ? route?.recharge_provider_account_id || null : null,
          executor_kind: executor, executor_profile_id: executor === 'BROWSER' ? browserProfileId : null,
          status: latest ? g.attemptStatus : 'CLEARED', funds_risk_state: latest ? (g.attemptFundsRisk || 'NONE') : 'CLEARED',
          external_order_id: executor === 'API' && latest && bool(g.hasRechargeOrderNo) ? `DEMO-EXT-${hex(6)}` : null,
          submit_intent_at: new Date(at), submitted_at: new Date(at + 20_000),
          finished_at: finished ? new Date(Math.min(at + 60_000, order.finishedAt)) : null,
          created_at: new Date(at), updated_at: new Date(Math.min(at + 60_000, nowMs))
        });
      }
      order.latestAttemptId = attemptIds.at(-1)?.id || null;
      order.attempts = attemptIds;
      const browserAttempts = attemptIds.filter((a) => a.executor === 'BROWSER');
      for (let r = 0; r < runCount && browserAttempts.length; r += 1) {
        const latest = r === runCount - 1;
        const attempt = latest ? browserAttempts.at(-1) : browserAttempts[Math.min(r, browserAttempts.length - 1)];
        const runId = uuid();
        const status = latest ? g.runStatus : 'FAILED_SAFE';
        const payment = latest ? g.runPaymentState : 'NOT_STARTED';
        const post = latest ? (g.runPostPaymentState || 'NOT_STARTED') : 'NOT_STARTED';
        const runAt = attempt.at + r * 1000;
        const runNo = runRows.filter((row) => row.recharge_attempt_id === attempt.id).length + 1;
        runRows.push({
          id: runId, recharge_attempt_id: attempt.id, executor_profile_id: browserProfileId, run_no: runNo,
          start_operation_key: `local-admin-${uuid()}`, status, payment_state: payment, post_payment_state: post,
          plus_activated_at: ['PLUS_CONFIRMED', 'CANCELLATION_PENDING', 'CANCELLATION_CONFIRMED'].includes(post) ? new Date(order.finishedAt) : null,
          cancellation_confirmed_at: post === 'CANCELLATION_CONFIRMED' ? new Date(order.finishedAt) : null,
          account_key_hmac: hex(32), worker_id: workerId[g.runWorker] ?? null,
          control_state: latest ? (g.runControlState || 'AUTOMATION') : 'AUTOMATION', requested_by: 'worker',
          selected_lane: 'chatgpt-plus-browser-v1', last_checkpoint_kind: payment === 'NOT_STARTED' ? 'checkout-navigation' : 'payment-stage',
          // 演练单的判定看这一单所有 run：演练单的每个 run 都得是「演练停」；不是演练单的，早先那几个是正式 run
          last_error_code: latest || bool(g.rehearsal) ? g.runErrorCode : null,
          created_at: new Date(runAt), updated_at: new Date(order.finishedAt),
          finished_at: ['COMPLETED', 'FAILED_SAFE'].includes(status) ? new Date(order.finishedAt) : null
        });
        if (latest) {
          const steps = ['session-bootstrap', 'account-readonly-probe', 'page-signature', 'checkout-navigation'];
          if (payment !== 'NOT_STARTED') steps.push('card-material-preflight', 'payment-stage');
          if (payment === 'PAYMENT_CONFIRMED') steps.push('saved-payment-method');
          const jobId = `brjob:${runId}`;
          steps.forEach((action, idx) => runEventRows.push({
            job_id: jobId, order_id: order.id, browser_run_id: runId, sequence_no: idx + 1, event_type: 'checkpoint', action,
            summary_json: JSON.stringify({ action, demo: true }), payload_digest: hex(32), worker_id: workerId[g.runWorker] ?? null,
            created_at: new Date(runAt + idx * 15_000)
          }));
          if (bool(g.hasExecutionDetail)) {
            runEventRows.push({
              job_id: jobId, order_id: order.id, browser_run_id: runId, sequence_no: steps.length + 1, event_type: 'freeze',
              action: 'fail-closed', summary_json: JSON.stringify({ action: 'fail-closed',
                navigationError: NAVIGATION_TEXT[g.failureCode] || `${g.failureCode || 'FAILED'}: stopped before payment (demo)` }),
              payload_digest: hex(32), worker_id: workerId[g.runWorker] ?? null, created_at: new Date(runAt + steps.length * 15_000)
            });
          }
        }
      }
    }
  }
  await insertRows(pool, 'orders', Object.keys(orderRows[0] || { id: 1 }), orderRows);
  await insertRows(pool, 'order_events', ['order_id', 'from_status', 'to_status', 'actor_type', 'actor_id', 'reason', 'created_at'], eventRows);
  await insertRows(pool, 'recharge_attempts', Object.keys(attemptRows[0] || { id: 1 }), attemptRows);
  await insertRows(pool, 'browser_runs', Object.keys(runRows[0] || { id: 1 }), runRows);
  await insertRows(pool, 'browser_run_events', Object.keys(runEventRows[0] || { id: 1 }), runEventRows);
  count('orders', orderRows.length); count('order_events', eventRows.length); count('recharge_attempts', attemptRows.length);
  count('browser_runs', runRows.length); count('browser_run_events', runEventRows.length);

  // 卡密 ↔ 订单：被订单引用的卡密里，标了 orderLinked 的回填 cdks.order_id（最近那一单）。
  for (const cdk of cdkPool) {
    if (!cdk.orderLinked || !cdk.orders.length) continue;
    const latest = [...cdk.orders].sort((a, b) => b.createdAt - a.createdAt)[0];
    await pool.query('UPDATE cdks SET order_id = ?, redeemed_at = COALESCE(redeemed_at, ?) WHERE id = ?', [latest.id, new Date(latest.createdAt), cdk.id]);
  }

  // ---- 6. 账本、占用：按卡的组（各状态次数、服务过的产品）挑订单，同时让 (账本状态, 订单状态, 产品, 卡台) 的分布贴快照 ----
  const ledgerBudget = new Map();
  const ledgerKey = (status, orderStatus, planType, providerCode) => `${status}|${orderStatus}|${planType}|${providerCode}`;
  for (const row of shape.ledger || []) {
    ledgerBudget.set(ledgerKey(row.status, row.orderStatus, row.planType, row.providerCode), {
      left: Number(row.count), amount: row.count ? Number(row.amount || 0) / Number(row.count) : 0, currency: row.currency || 'USD'
    });
  }
  const ledgerUse = new Map(); // orderId → 已挂几条账本
  const usedAttempts = new Set();
  const ledgerRows = [];
  const pickOrder = (card, status, planHint) => {
    let best = null; let bestScore = -Infinity;
    for (const order of orders) {
      if (card.orderIds.has(order.id)) continue;
      const budget = ledgerBudget.get(ledgerKey(status, order.status, order.planType, card.providerCode));
      let score = 0;
      if (budget?.left > 0) score += 64;
      if (planHint.includes(order.planType)) score += 16;
      if (order.cardProvider === card.providerCode) score += 8;
      if (status === 'CONSUMED' || (status === 'RELEASED' && planHint.successWanted)) score += order.success ? 4 : -32;
      else if (status === 'RELEASED') score += order.success ? -8 : 4;
      score -= (ledgerUse.get(order.id) || 0) * 2;
      score += rng.next();
      if (score > bestScore) { bestScore = score; best = order; }
    }
    return best;
  };
  for (const card of cards) {
    const g = card.group;
    const activePlans = String(g.activePlans || '').split(',').filter(Boolean);
    const releasedPlans = String(g.releasedPlans || '').split(',').filter(Boolean);
    const wanted = [];
    const addRows = (status, n, plans, extra = {}) => {
      for (let i = 0; i < Number(n || 0); i += 1) {
        const hint = [...(plans.length ? [plans[i % plans.length]] : ['plus'])];
        if (extra.successWanted) hint.successWanted = true;
        wanted.push({ status, hint });
      }
    };
    addRows('CONSUMED', g.ledgerConsumed, activePlans);
    addRows('RESERVED', g.ledgerReserved, activePlans);
    addRows('RECONCILIATION', g.ledgerReconciliation, activePlans);
    const releasedSuccess = Number(g.releasedOnSuccess || 0);
    addRows('RELEASED', releasedSuccess, releasedPlans, { successWanted: true });
    addRows('RELEASED', Number(g.ledgerReleased || 0) - releasedSuccess, releasedPlans);
    for (const want of wanted) {
      const order = pickOrder(card, want.status, want.hint);
      if (!order) continue;
      card.orderIds.add(order.id);
      order.cardIds.add(card.id);
      ledgerUse.set(order.id, (ledgerUse.get(order.id) || 0) + 1);
      const budget = ledgerBudget.get(ledgerKey(want.status, order.status, order.planType, card.providerCode));
      if (budget) budget.left -= 1;
      const attemptId = order.latestAttemptId && !usedAttempts.has(order.latestAttemptId) ? order.latestAttemptId : null;
      if (attemptId) usedAttempts.add(attemptId);
      const row = {
        id: uuid(), card_id: card.id, order_id: order.id, recharge_attempt_id: attemptId,
        product_id: productIdByPlan.get(order.planType) || null, provider_transaction_id: null, status: want.status,
        amount: money(budget?.amount || (order.planType === 'plus' ? 15.8 : 150)), currency: budget?.currency || 'USD',
        reserved_at: new Date(order.createdAt + MINUTE),
        consumed_at: want.status === 'CONSUMED' ? new Date(order.finishedAt) : null,
        released_at: want.status === 'RELEASED' ? new Date(order.finishedAt) : null,
        release_reason: want.status === 'RELEASED' ? 'order finished without charge (demo)' : null,
        created_at: new Date(order.createdAt + MINUTE), updated_at: new Date(order.finishedAt)
      };
      card.ledger.push({ row, order });
      ledgerRows.push(row);
    }
    // 可用额贴快照的分桶：LEAST(当前余额, 入卡额 − 账本已花) 要落在 effectiveBucket。
    fitEffectiveBalance(card);
  }
  await insertRows(pool, 'card_consumption_ledger', Object.keys(ledgerRows[0] || { id: 1 }), ledgerRows);
  count('card_consumption_ledger', ledgerRows.length);
  for (const card of cards) {
    await pool.query('UPDATE cards SET funded_amount = ?, current_balance = ? WHERE id = ?', [card.funded, card.balance, card.id]);
  }

  // 占用历史：先挂账本那几单，不够再挑同卡台、要了卡的单；activeAssignment 的最后一条保持 ACTIVE。
  const assignmentRows = [];
  for (const card of cards) {
    const g = card.group;
    const n = Number(g.assignmentCount || 0);
    const linked = [...card.ledger.map((l) => l.order)];
    const extra = orders.filter((o) => !card.orderIds.has(o.id) && o.cardProvider === card.providerCode && bool(o.group.cardAssigned));
    while (linked.length < n && extra.length) {
      const order = extra.splice(Math.floor(rng.next() * extra.length), 1)[0];
      linked.push(order);
      card.orderIds.add(order.id);
      order.cardIds.add(card.id);
    }
    const chosen = linked.slice(0, n).sort((a, b) => a.createdAt - b.createdAt);
    chosen.forEach((order, idx) => {
      const active = bool(g.activeAssignment) && idx === chosen.length - 1;
      assignmentRows.push({
        id: uuid(), card_id: card.id, order_id: order.id, assignment_kind: 'NORMAL', status: active ? 'ACTIVE' : 'RELEASED',
        assigned_by: 'worker', assignment_reason: 'assigned for order (demo)', assigned_at: new Date(order.createdAt + MINUTE),
        released_by: active ? null : 'worker', release_reason: active ? null : 'order finished (demo)',
        released_at: active ? null : new Date(order.finishedAt), created_at: new Date(order.createdAt + MINUTE),
        updated_at: new Date(order.finishedAt)
      });
      card.assignments.push(order);
    });
  }
  await insertRows(pool, 'card_assignment_history', Object.keys(assignmentRows[0] || { id: 1 }), assignmentRows);
  count('card_assignment_history', assignmentRows.length);

  // orders.assigned_card_id：优先挂过账本/占用的卡，其次同卡台任一张。cards.order_id（旧的一卡一单）同理且唯一。
  const cardsByProvider = new Map();
  for (const card of cards) {
    if (!cardsByProvider.has(card.providerCode)) cardsByProvider.set(card.providerCode, []);
    cardsByProvider.get(card.providerCode).push(card);
  }
  for (const order of orders) {
    if (!bool(order.group.cardAssigned)) continue;
    const linked = cards.filter((c) => order.cardIds.has(c.id));
    const choices = linked.length ? linked : (cardsByProvider.get(order.cardProvider) || cards);
    const card = choices[Math.floor(rng.next() * choices.length)];
    if (card) await pool.query('UPDATE orders SET assigned_card_id = ? WHERE id = ?', [card.id, order.id]);
  }
  const legacyTaken = new Set();
  for (const card of cards.filter((c) => bool(c.group.legacyOrder))) {
    const candidates = orders.filter((o) => card.orderIds.has(o.id) && !legacyTaken.has(o.id));
    const order = candidates[0] || orders.find((o) => !legacyTaken.has(o.id) && o.cardProvider === card.providerCode)
      || orders.find((o) => !legacyTaken.has(o.id));
    if (!order) continue;
    legacyTaken.add(order.id);
    await pool.query('UPDATE cards SET order_id = ? WHERE id = ?', [order.id, card.id]);
  }

  // ---- 7. 停用覆盖、销卡登记、流水 ----------------------------------------------------------
  const overrideRows = [];
  const stateEventRows = [];
  for (const card of cards) {
    const g = card.group;
    const policies = String(g.overridePolicy || '').split(',').filter(Boolean);
    if (policies.length) {
      const policy = policies.includes('RETIRED') ? 'RETIRED' : policies[0];
      overrideRows.push({ id: uuid(), provider_account_id: card.providerAccountId, external_card_id: card.external,
        allocation_policy: policy, product_code: g.overrideProduct || null,
        reason: OVERRIDE_REASON[g.overrideReasonCode] || `${g.overrideReasonCode || 'OTHER'}: 演示数据`,
        set_by: 'admin', set_at: new Date(Math.min(nowMs - HOUR, card.createdAt + DAY)) });
    }
    if (bool(g.retiredConfirmed)) {
      const at = new Date(Math.min(nowMs - HOUR, card.createdAt + 2 * DAY));
      stateEventRows.push({ card_id: card.id, event_type: 'CARD_RETIRED_CONFIRMED', source: 'admin',
        previous_json: JSON.stringify({ inventoryStatus: 'AVAILABLE', syncTier: g.syncTier, nextSyncAt: null, override: null }),
        current_json: JSON.stringify({ inventoryStatus: 'RETIRED', retiredConfirmedAt: at.toISOString(), ageHours: 48,
          confirmedBy: 'admin', source: 'admin', note: '演示数据', sourcePresentAtConfirm: bool(g.sourcePresent),
          balanceAtConfirm: card.balance }), created_at: at });
    }
  }
  // 只有停用覆盖、卡本身不在 cards 里的（卡片页「历史」里的「仅外部」行）
  for (const g of shape.overrideOnly || []) {
    const aid = providerId.get(g.providerCode);
    if (!aid) continue;
    for (let i = 0; i < Number(g.count); i += 1) {
      overrideRows.push({ id: uuid(), provider_account_id: aid,
        external_card_id: g.providerCode === 'hnskj' ? `9${rng.chars(9, '0123456789')}` : `hv-demo-${rng.chars(10, '0123456789')}`,
        allocation_policy: g.policy, product_code: g.productCode || null,
        reason: OVERRIDE_REASON[g.reasonCode] || `${g.reasonCode || 'OTHER'}: 演示数据`,
        set_by: 'admin', set_at: new Date(nowMs - rng.int(2, 30) * DAY) });
    }
  }
  await insertRows(pool, 'card_operational_overrides', Object.keys(overrideRows[0] || { id: 1 }), overrideRows);
  await insertRows(pool, 'card_state_events', Object.keys(stateEventRows[0] || { id: 1 }), stateEventRows);
  count('card_operational_overrides', overrideRows.length); count('card_state_events', stateEventRows.length);

  const txBudget = (shape.cardTransactions || []).map((row) => ({ ...row, left: Number(row.count) }));
  const txRows = [];
  for (const card of cards) {
    const signature = String(card.group.txSignature || '').split(',').filter(Boolean);
    for (const part of signature) {
      const [head, n] = part.split('*');
      const [type, status, dayBucket] = head.split('|');
      for (let i = 0; i < Number(n || 0); i += 1) {
        // 库里类型/状态的比较不分大小写（utf8mb4_unicode_ci），快照的分组也是按不分大小写合并的
        const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
        const budget = txBudget.find((b) => b.left > 0 && b.providerCode === card.providerCode && same(b.type, type)
          && same(b.status, status) && String(b.dayBucket) === String(dayBucket))
          || txBudget.find((b) => b.providerCode === card.providerCode && same(b.type, type) && same(b.status, status));
        if (budget) budget.left -= 1;
        const per = (field) => (budget && budget[field] != null && Number(budget.count) ? Number(budget[field]) / Number(budget.count) : null);
        const at = dayBucket === 'old' ? Math.min(card.createdAt + HOUR, nowMs - 8 * DAY - HOUR) : timeOnDay(Number(dayBucket));
        const purchase = /purchase/i.test(type);
        txRows.push({
          card_id: card.id, provider_transaction_id: `demo-tx-${hex(8)}`, transaction_type: type, status,
          amount: money(per('amount') ?? (purchase ? -15.8 : 0)), currency: budget?.currency || 'USD',
          fee: per('fee') == null ? null : money(per('fee')), trade_time_raw: new Date(at).toISOString(),
          settlement_status: budget?.settlementStatus ?? null,
          original_amount: per('originalAmount') == null ? null : money(per('originalAmount')),
          original_currency: budget?.originalCurrency ?? null,
          merchant_name: purchase ? 'OPENAI *CHATGPT SUBSCR (demo)' : null, merchant_country: purchase ? 'US' : null,
          occurred_at: null, raw_hash: hex(32), first_seen_at: new Date(at), last_seen_at: new Date(at)
        });
      }
    }
  }
  await insertRows(pool, 'card_transactions', Object.keys(txRows[0] || { id: 1 }), txRows);
  count('card_transactions', txRows.length);

  // ---- 8. 提醒、对账案例、派单、任务、补卡/同步任务、待接管的卡 -----------------------------------
  const ordersBy = (pred) => orders.filter(pred);
  const alertRows = [];
  for (const g of shape.alerts || []) {
    const [title, message] = ALERT_TEXT[g.type] || [g.type, '演示数据'];
    const candidates = bool(g.hasOrder) ? ordersBy((o) => (/^BROWSER_/.test(g.type) ? o.group.attemptExecutor === 'BROWSER' : true)) : [];
    for (let i = 0; i < Number(g.count); i += 1) {
      const createdAt = timeOnDay(g.dayOffset);
      const order = candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : null;
      const id = uuid();
      alertRows.push({
        id, alert_type: g.type,
        dedupe_key: g.type === 'PROVIDER_TOKEN_EXPIRED' && g.status === 'OPEN'
          ? `provider-token-expired:${providerId.get('manual_excel')}` : `${g.type.toLowerCase()}:demo:${id}`,
        order_id: order?.id || null, severity: g.severity, title,
        message: order ? `${message}（${order.publicNo.slice(0, 9)}…）` : message, status: g.status,
        created_at: new Date(createdAt), updated_at: new Date(createdAt),
        acknowledged_at: g.status === 'OPEN' ? null : new Date(Math.min(nowMs, createdAt + HOUR)),
        incident_version: Number(g.incidentVersion || 1)
      });
    }
  }
  await insertRows(pool, 'operator_alerts', Object.keys(alertRows[0] || { id: 1 }), alertRows);
  count('operator_alerts', alertRows.length);

  const caseRows = [];
  for (const g of shape.reconciliationCases || []) {
    const candidates = ordersBy((o) => (/PAYMENT_UNKNOWN/.test(g.caseType) ? o.group.runPaymentState === 'PAYMENT_UNKNOWN' : true));
    for (let i = 0; i < Number(g.count); i += 1) {
      const order = bool(g.hasOrder) && candidates.length ? candidates[i % candidates.length] : null;
      const card = bool(g.hasCard) ? cards.find((c) => order && c.orderIds.has(order.id)) || cards[0] : null;
      const at = timeOnDay(g.dayOffset);
      caseRows.push({
        id: uuid(), case_type: g.caseType, status: g.status, severity: g.severity, dedupe_key: `demo:${g.caseType}:${uuid()}`,
        order_id: order?.id || null, card_id: card?.id || null,
        recharge_attempt_id: bool(g.hasAttempt) ? order?.latestAttemptId || null : null,
        evidence_json: JSON.stringify({ demo: true }), resolution_note: g.status === 'RESOLVED' ? '演示数据：已核实' : null,
        detected_at: new Date(at), last_seen_at: new Date(at), resolved_at: g.status === 'RESOLVED' ? new Date(Math.min(nowMs, at + HOUR)) : null
      });
    }
  }
  await insertRows(pool, 'reconciliation_cases', Object.keys(caseRows[0] || { id: 1 }), caseRows);
  count('reconciliation_cases', caseRows.length);

  for (const g of shape.refundCases || []) {
    const candidates = ordersBy((o) => o.status === g.orderStatus && o.cardIds.size);
    for (let i = 0; i < Number(g.count) && i < candidates.length; i += 1) {
      const order = candidates[i];
      await pool.query(`INSERT INTO refund_cases (id, order_id, card_id, status, currency, operator_note) VALUES (?, ?, ?, ?, 'USD', ?)`,
        [uuid(), order.id, [...order.cardIds][0], g.status, '演示数据']);
      count('refund_cases');
    }
  }

  const dispatchBudget = (shape.dispatchJobs || []).map((row) => ({ ...row, left: Number(row.count) }));
  const dispatchRows = [];
  for (const attempt of attemptRows.filter((a) => a.executor_kind === 'BROWSER')) {
    const budget = dispatchBudget.find((b) => b.left > 0 && b.attemptStatus === attempt.status)
      || dispatchBudget.find((b) => b.left > 0);
    if (!budget) break;
    budget.left -= 1;
    dispatchRows.push({ job_key: `demo:${attempt.id}`, recharge_attempt_id: attempt.id, order_id: attempt.order_id,
      executor_profile_id: browserProfileId, status: budget.status, attempt_count: 1,
      queued_at: attempt.created_at, claimed_at: attempt.created_at,
      completed_at: ['COMPLETED', 'CANCELLED'].includes(budget.status) ? attempt.updated_at : null });
  }
  await insertRows(pool, 'browser_dispatch_jobs', Object.keys(dispatchRows[0] || { id: 1 }), dispatchRows);
  count('browser_dispatch_jobs', dispatchRows.length);

  const taskRows = [];
  for (const g of shape.tasks || []) {
    const candidates = ordersBy((o) => o.status === g.orderStatus);
    for (let i = 0; i < Number(g.count) && candidates.length; i += 1) {
      const order = candidates[i % candidates.length];
      taskRows.push({ order_id: order.id, task_type: g.taskType, status: g.status,
        dedupe_key: `demo:${g.taskType}:${order.id}:${uuid().slice(0, 8)}`, attempts: g.status === 'PENDING' ? 0 : 1,
        available_at: new Date(order.createdAt), leased_until: bool(g.leaseExpired) ? new Date(nowMs - 10 * MINUTE) : null,
        created_at: new Date(order.createdAt), updated_at: new Date(order.finishedAt),
        completed_at: g.status === 'COMPLETED' ? new Date(order.finishedAt) : null,
        last_error_code: g.status === 'DEAD' ? 'DEMO_DEAD' : null });
    }
  }
  await insertRows(pool, 'tasks', Object.keys(taskRows[0] || { id: 1 }), taskRows);
  count('tasks', taskRows.length);

  const stockRows = [];
  for (const g of shape.stockJobs || []) {
    for (let i = 0; i < Number(g.count); i += 1) {
      const at = g.dayBucket === 'old' ? nowMs - (8 + rng.int(0, 30)) * DAY - rng.int(0, 20) * HOUR : timeOnDay(Number(g.dayBucket));
      stockRows.push({ id: uuid(), status: g.status, job_source: g.jobSource,
        provider_account_id: g.providerCode ? providerId.get(g.providerCode) || null : null, product_code: g.productCode,
        card_type_id: String(shape.settings?.values?.default_card_type_id || '23'), amount: money(g.amount ?? 16),
        estimated_total: money(Number(g.amount ?? 16) * Number(g.requestedCount || 1)),
        requested_count: g.requestedCount, opened_count: g.openedCount, error_code: bool(g.hasError) ? 'DEMO_ERROR' : null,
        error_message: bool(g.hasError) ? '演示数据：开卡失败' : null, created_at: new Date(at), started_at: new Date(at),
        finished_at: ['PENDING', 'RUNNING'].includes(g.status) ? null : new Date(at + MINUTE),
        archived_at: g.status === 'ARCHIVED_LEGACY' ? new Date(at + DAY) : null,
        archive_reason: g.status === 'ARCHIVED_LEGACY' ? 'legacy job archived (demo)' : null });
    }
  }
  await insertRows(pool, 'card_stock_jobs', Object.keys(stockRows[0] || { id: 1 }), stockRows);
  count('card_stock_jobs', stockRows.length);

  const syncRows = [];
  const syncCards = cards.filter((c) => c.group.syncTier !== 'MANUAL_IMPORT');
  const syncTargets = syncCards.length ? syncCards : cards;
  for (const g of shape.syncJobs || []) {
    for (let i = 0; i < Number(g.count) && syncTargets.length; i += 1) {
      const card = syncTargets[i % syncTargets.length];
      const done = !['PENDING', 'RUNNING'].includes(g.status);
      const completed = bool(g.within24h) ? nowMs - rng.int(1, 23) * HOUR : nowMs - (2 + rng.int(0, 30)) * DAY;
      const created = completed - Number(g.avgLatencySeconds || 30) * 1000;
      syncRows.push({ id: uuid(), card_id: card.id, status: g.status, requested_by: 'scheduler', dedupe_key: `demo:${uuid()}`,
        attempts: 1, created_at: new Date(created), available_at: new Date(created), updated_at: new Date(completed),
        completed_at: done ? new Date(completed) : null });
    }
  }
  await insertRows(pool, 'card_sync_jobs', Object.keys(syncRows[0] || { id: 1 }), syncRows);
  count('card_sync_jobs', syncRows.length);

  for (const g of shape.cardIntakeStuck || []) {
    const aid = providerId.get(g.providerCode);
    if (!aid) continue;
    const batchId = uuid();
    const at = ago(g.firstSeenAgeSeconds ?? 0);
    await pool.query(`INSERT INTO card_intake_batches (id, provider_account_id, status, requested_by, discovered_count, review_count, created_at, completed_at)
      VALUES (?, ?, 'COMPLETED', 'scheduler', ?, ?, ?, ?)`, [batchId, aid, g.count, g.count, at, at]);
    const rows = Array.from({ length: Number(g.count) }, () => ({
      id: uuid(), intake_batch_id: batchId, provider_account_id: aid, external_card_id: `9${rng.chars(9, '0123456789')}`,
      intake_status: g.intakeStatus, validation_attempts: 1,
      details_json: JSON.stringify({ validation: { errors: g.firstError == null ? [] : [g.firstError] }, demo: true }),
      failure_code: g.firstError, first_seen_at: at
    }));
    await insertRows(pool, 'card_discoveries', Object.keys(rows[0] || { id: 1 }), rows);
    count('card_discoveries', rows.length);
  }

  return stats;

  /**
   * 让 LEAST(当前余额, 入卡额 − 账本已花) 落进快照的 effectiveBucket（资格规则的余额一句就看它）。
   * 先动账本金额（它只是「每单花了多少」的平均），动不了再在入卡额所在分桶内调入卡额。
   */
  function fitEffectiveBalance(card) {
    const g = card.group;
    if (card.funded == null || card.balance == null || g.effectiveBucket === 'null') return;
    const counted = card.ledger.filter(({ row, order }) => ['RESERVED', 'CONSUMED', 'RECONCILIATION'].includes(row.status)
      || (row.status === 'RELEASED' && order.status === 'RECHARGE_SUCCESS'));
    const spend = () => counted.reduce((n, { row }) => n + Number(row.amount || 0), 0);
    const effective = () => Math.min(Number(card.balance), Number(card.funded) - spend());
    if (bucketOf(effective()) === g.effectiveBucket) return;
    const target = Number(BUCKET_VALUE[g.effectiveBucket]);
    const [flo, fhi] = BUCKET_RANGE[g.fundedBucket] || [Number(card.funded), Number(card.funded)];
    if (g.effectiveBucket === g.balanceBucket) {
      // 余额那一侧该是较小者：入卡额 − 已花 ≥ 当前余额
      const needFunded = Number(card.balance) + spend();
      if (needFunded >= flo && needFunded <= fhi) { card.funded = money(Math.max(Number(card.funded), needFunded)); return; }
      if (counted.length) {
        const per = Math.max(0, (Number(card.funded) - Number(card.balance)) / counted.length);
        counted.forEach(({ row }) => { row.amount = money(Math.floor(per * 100) / 100); });
      }
      return;
    }
    // 入卡额那一侧是较小者：入卡额 − 已花 ≈ 目标
    if (counted.length) {
      const per = (Number(card.funded) - target) / counted.length;
      if (per >= 0) { counted.forEach(({ row }) => { row.amount = money(per); }); return; }
    }
    const funded = target + spend();
    if (funded >= flo && funded <= fhi) card.funded = money(funded);
  }
}
