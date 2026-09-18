import crypto from 'node:crypto';
import { fromCents, maxPlausibleFeeCents, toCents } from '../domain/card-issue-fee.js';
import { CARD_ISSUE_FEE_TYPE } from '../domain/card-issue-fee.js';
import { cardProviderAccountIsHealthy, listCardProviderAccounts } from './provider-route-service.js';
import { countEligibleCards, listCardSourceSelections, safeWaitingPredicate } from './card-source-selection-service.js';
import { countTodayOpenings, unresolvedPaidJobsSql } from './card-stock-job-service.js';

/**
 * 库存水位驱动的供卡调度（D-247 面二①③⑤⑥⑦，D-252 打架 2）。每分钟跑一次：
 *
 *   每卡台 × 每产品有一行策略（水位 / 开卡金额 / 每日上限 / 卡段）。
 *   需求 = max(水位, 该台该产品正在等卡的单数)；缺口 = 需求 − 可分配 − 在途 job。
 *   缺口 > 0 且 总闸开 且 没有别的 job 在跑 且 没有花过钱没人核对的 job
 *     → 该台此刻能开：日限内、钱包预检过（余额 − 金额 − 手续费 ≥ 硬底线）→ 建一张卡的 job；
 *     → 该台此刻不能开（故障 / 无 token / 卡台禁开）：Browser 产品需求转另一台开一张顶上，
 *       API 需求不转（ZZSHU 只认 hnskj 的 BIN，D-253）。
 *   `CARD_STOCK_LOW` 按台 × 产品由这里唯一产生（阈值 = 水位），不再散在分卡/入库两处。
 *
 * 手续费用第②步落的真实观察（CARD_ISSUE_FEE 行）：取该台最近 5 条的中位数；一条观察都没有时
 * 用「金额 10% + $1」这个保守上限（computeIssueFee 的合理性闸门），宁可少开也不猜费率。
 */

export const SUPPLY_FAULT_RETRY_MS = 15 * 60_000;
export const ALERT_TYPES = Object.freeze({
  STOCK_LOW: 'CARD_STOCK_LOW',
  WALLET_LOW: 'CARD_SUPPLY_WALLET_LOW',
  WALLET_ALERT: 'PROVIDER_WALLET_LOW',
  BLOCKED: 'CARD_SUPPLY_BLOCKED',
  OPEN_FAILED: 'CARD_SUPPLY_OPEN_FAILED',
  FAULT: 'CARD_SUPPLY_FAULT',
  TOKEN_EXPIRED: 'PROVIDER_TOKEN_EXPIRED'
});

export async function upsertSupplyAlert(queryable, { type, key, severity = 'warning', title, message, orderId = null }) {
  await queryable.query(
    `INSERT INTO operator_alerts
     (id, alert_type, dedupe_key, order_id, severity, title, message, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'OPEN')
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
       order_id = VALUES(order_id), message = VALUES(message),
       status = IF(status = 'RESOLVED', 'OPEN', status),
       acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
    [type, key, orderId, severity, String(title).slice(0, 255), String(message).slice(0, 2000)]
  );
}

export async function resolveSupplyAlert(queryable, key) {
  await queryable.query(
    `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))
      WHERE dedupe_key = ? AND status = 'OPEN'`,
    [key]
  );
}

/**
 * 关掉一个前缀下、除 `exceptKey` 外的所有 OPEN 告警。日报用它每次跑先收掉「除今天外的历史汇总」
 * （昨天、更早、上线前遗留的旧固定 key），保证同一时刻只有当天那一条 OPEN（F-54/F-56/F-59）。
 * `prefixLike` 是 SQL LIKE 模式（如 `daily-reconciliation%`）。
 */
export async function resolveSupplyAlertsByPrefix(queryable, prefixLike, exceptKey) {
  await queryable.query(
    `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))
      WHERE dedupe_key LIKE ? AND dedupe_key <> ? AND status = 'OPEN'`,
    [prefixLike, exceptKey]
  );
}

/** 卡台故障告警的 dedupe_key。一段故障期只有这一行，所以只推一次（第⑤步，契约表三 #10）。 */
export function supplyFaultAlertKey(providerAccountId) {
  return `card-supply-fault:${providerAccountId}`;
}

/** token 失效告警的 dedupe_key。同理：一段失效期只有这一行，贴回新 token 后 RESOLVE。 */
export function tokenExpiredAlertKey(providerAccountId) {
  return `provider-token-expired:${providerAccountId}`;
}

/**
 * 第⑤步（面四①，契约表三 #10「token 要用而没有」）：token 失效以前只让定时任务 exit 1，
 * **一条告警都没有**（2026-09-17 生产实证：06:06 贴、08:38 失效，到 12:47 Lemon 自己发现才重贴）。
 *
 * 「一段失效期只推一次」靠 dedupe_key + `alert_notifications` 的 (alert_id, channel) 唯一约束：
 * 失效期间 timer 每小时撞一次，撞的都是同一行，只有第一次进队列。恢复时 RESOLVE，
 * 下次失效重新 OPEN 才会再推一次。
 */
export async function markProviderTokenExpired(queryable, { providerAccountId, code = 'HIGHVCC_TOKEN_EXPIRED' }) {
  const [rows] = await queryable.query(
    'SELECT display_name, provider_code FROM provider_accounts WHERE id = ? LIMIT 1',
    [String(providerAccountId)]
  );
  const label = rows[0]?.display_name || rows[0]?.provider_code || providerAccountId;
  await upsertSupplyAlert(queryable, {
    type: ALERT_TYPES.TOKEN_EXPIRED,
    key: tokenExpiredAlertKey(providerAccountId),
    severity: 'critical',
    title: '卡台登录失效了，要你贴新 token',
    message: `${label} 的访问 token 已失效（${code}）。同步、开卡、付款后的卡台侧核对都停了。`
      + '登录含随机滑块，系统换不了（D-249），请重新贴一次 token。'
  });
}

export async function clearProviderTokenExpired(queryable, { providerAccountId }) {
  await resolveSupplyAlert(queryable, tokenExpiredAlertKey(providerAccountId));
}

/**
 * 第⑤步（面四①）：故障态以前只落 `provider_accounts.supply_fault_state`，**没有任何告警**——
 * 卡台坏了没人知道，直到有客户等卡。告警挂在这里而不是五个调用点上，新增调用点自动带上。
 * 恢复（clearSupplyFault）时 RESOLVE，下次再坏才重新 OPEN、重新推一次。
 */
export async function markSupplyFault(queryable, { providerAccountId, reason, now = new Date() }) {
  const code = String(reason || 'UNKNOWN').slice(0, 255);
  const [result] = await queryable.query(
    `UPDATE provider_accounts SET supply_fault_state = 'FAULT', supply_fault_reason = ?, supply_fault_at = ?
      WHERE id = ?`,
    [code, now, String(providerAccountId)]
  );
  if (Number(result?.affectedRows || 0) === 0) return;
  const [rows] = await queryable.query(
    'SELECT display_name, provider_code FROM provider_accounts WHERE id = ? LIMIT 1',
    [String(providerAccountId)]
  );
  const label = rows[0]?.display_name || rows[0]?.provider_code || providerAccountId;
  await upsertSupplyAlert(queryable, {
    type: ALERT_TYPES.FAULT,
    key: supplyFaultAlertKey(providerAccountId),
    severity: 'critical',
    title: '卡台故障，开不出卡',
    message: `${label} 供卡故障（${code}）。系统已停止用它开卡；另一台若能顶会自动转台，顶不上时等卡的单会一直等。请去卡台看看。`
  });
}

export async function clearSupplyFault(queryable, { providerAccountId }) {
  const [result] = await queryable.query(
    `UPDATE provider_accounts SET supply_fault_state = 'OK', supply_fault_reason = NULL, supply_fault_at = NULL
      WHERE id = ? AND supply_fault_state <> 'OK'`,
    [String(providerAccountId)]
  );
  if (Number(result?.affectedRows || 0) === 0) return;
  await resolveSupplyAlert(queryable, supplyFaultAlertKey(providerAccountId));
}

/** 转台开出的卡要给等它的单用：把还没分配、没资金痕迹的等待单冻结卡台改到新台（复用 safeWaitingPredicate）。 */
export async function takeoverWaitingOrders(queryable, { productId, fromProviderAccountId, toProviderAccountId }) {
  const [result] = await queryable.query(
    `UPDATE orders o
        SET o.frozen_card_provider_account_id = ?, o.version = o.version + 1, o.updated_at = CURRENT_TIMESTAMP(3)
      WHERE o.product_id = ? AND o.frozen_card_provider_account_id = ? AND ${safeWaitingPredicate('o')}`,
    [String(toProviderAccountId), String(productId), String(fromProviderAccountId)]
  );
  return Number(result?.affectedRows || 0);
}

/** 该台最近 5 次开卡的真实成本中位数（分）；没有观察就返回 null。 */
export async function observedIssueFeeCents(queryable, { providerAccountId, limit = 5 }) {
  const [rows] = await queryable.query(
    `SELECT ct.amount FROM card_transactions ct
       INNER JOIN cards c ON c.id = ct.card_id
      WHERE c.provider_account_id = ? AND ct.transaction_type = ?
      ORDER BY ct.first_seen_at DESC LIMIT ?`,
    [String(providerAccountId), CARD_ISSUE_FEE_TYPE, Math.max(1, Number(limit) || 5)]
  );
  const cents = rows.map((row) => toCents(String(row.amount))).filter((value) => Number.isInteger(value) && value >= 0).sort((a, b) => a - b);
  if (!cents.length) return null;
  return cents[Math.floor(cents.length / 2)];
}

export function estimateIssueFeeCents({ observedCents, amountCents }) {
  if (Number.isInteger(observedCents)) return { cents: observedCents, source: 'OBSERVED' };
  return { cents: maxPlausibleFeeCents(amountCents), source: 'PLAUSIBLE_UPPER_BOUND' };
}

/**
 * 钱包预检：余额 − 开卡金额 − 手续费 ≥ 硬底线。全程整数分。
 *
 * **硬底线就是卡台要求账户里留着不能动的那笔钱**（`provider_accounts.wallet_floor`：
 * 备用卡台 A = 20，hnskj = 30）。2026-09-18 我在 D-272 ② 里又按 `usdDeposit` 扣了一遍押金，
 * 那是重复计算——押金早就由 floor 表达了，扣两遍等于把底线悄悄翻倍（D-273）。
 * **要调那笔留存，改 `wallet_floor` 这一个地方，不要在公式里再加减项。**
 */
export function walletPreflight({ availableBalance, amount, feeCents, floor }) {
  const balanceCents = toCents(String(availableBalance));
  const amountCents = toCents(String(amount));
  const floorCents = floor == null ? 0 : toCents(String(floor));
  if (balanceCents === null || amountCents === null || floorCents === null || !Number.isInteger(feeCents)) {
    return { ok: false, reason: 'UNREADABLE_AMOUNTS' };
  }
  const projected = balanceCents - amountCents - feeCents;
  return {
    ok: projected >= floorCents,
    balance: fromCents(balanceCents), amount: fromCents(amountCents), fee: fromCents(feeCents),
    floor: fromCents(floorCents), projected: fromCents(projected)
  };
}

function accountCanOpen(account, adapters, { now }) {
  if (!account) return { ok: false, reason: 'NO_ACCOUNT' };
  if (!account.openAdapter || !adapters.has(account.openAdapter)) return { ok: false, reason: 'NO_OPEN_ADAPTER' };
  if (!account.supportsAutoOpen) return { ok: false, reason: 'AUTO_OPEN_NOT_SUPPORTED' };
  if (!cardProviderAccountIsHealthy(account, { now: now.getTime() })) return { ok: false, reason: 'ACCOUNT_UNHEALTHY' };
  if (account.supplyFaultState !== 'OK') {
    const faultAt = Date.parse(account.supplyFaultAt || '');
    const retryDue = Number.isFinite(faultAt) && now.getTime() - faultAt >= SUPPLY_FAULT_RETRY_MS;
    if (!retryDue) return { ok: false, reason: `FAULT:${account.supplyFaultReason || 'UNKNOWN'}` };
  }
  return { ok: true };
}

function policyKey(providerAccountId, productCode) {
  return `${providerAccountId}:${productCode}`;
}

export function createCardSupplyScheduler({ pool, adapters, now = () => new Date() } = {}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('pool is required');
  if (!adapters?.for) throw new TypeError('adapters registry is required');

  async function loadState() {
    const [[settingRows], accounts, selections, [policyRows], [productRows]] = await Promise.all([
      pool.query(`SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'card_auto_replenishment_enabled'`),
      listCardProviderAccounts(pool),
      listCardSourceSelections(pool),
      pool.query(`SELECT provider_account_id, product_code, target_available, open_card_amount, daily_open_limit, card_segment
                    FROM card_supply_policies ORDER BY provider_account_id, product_code`),
      pool.query(`SELECT id, product_code, legacy_plan_type FROM products WHERE status = 'ACTIVE'`)
    ]);
    const enabled = settingRows.some((row) => row.setting_value === 'true');
    const accountsById = new Map(accounts.filter((account) => account.operationalEnabled).map((account) => [account.id, account]));
    const products = new Map(productRows.map((row) => [String(row.legacy_plan_type || row.product_code), row]));
    const policies = policyRows
      .filter((row) => accountsById.has(String(row.provider_account_id)) && products.has(String(row.product_code)))
      .map((row) => ({
        providerAccountId: String(row.provider_account_id),
        productCode: String(row.product_code),
        productId: String(products.get(String(row.product_code)).id),
        targetAvailable: Number(row.target_available || 0),
        openCardAmount: String(row.open_card_amount),
        dailyOpenLimit: Number(row.daily_open_limit || 0),
        cardSegment: row.card_segment == null ? null : String(row.card_segment)
      }));
    return { enabled, accountsById, selections, policies, products };
  }

  async function measure(policy) {
    const available = await countEligibleCards(pool, { providerAccountId: policy.providerAccountId, productCode: policy.productCode });
    const [[waiting]] = await pool.query(
      `SELECT COUNT(*) AS count, MIN(o.created_at) AS oldest FROM orders o
        WHERE o.product_id = ? AND o.frozen_card_provider_account_id = ? AND ${safeWaitingPredicate('o')}`,
      [policy.productId, policy.providerAccountId]
    );
    const [[oldestOrder]] = await pool.query(
      `SELECT o.id FROM orders o
        WHERE o.product_id = ? AND o.frozen_card_provider_account_id = ? AND ${safeWaitingPredicate('o')}
        ORDER BY o.created_at ASC LIMIT 1`,
      [policy.productId, policy.providerAccountId]
    );
    const [[inflight]] = await pool.query(
      `SELECT COALESCE(SUM(requested_count - opened_count), 0) AS count FROM card_stock_jobs
        WHERE status IN ('PENDING','RUNNING') AND product_code = ?
          AND (provider_account_id = ? OR fallback_for_provider_account_id = ?)`,
      [policy.productCode, policy.providerAccountId, policy.providerAccountId]
    );
    const waitingCount = Number(waiting?.count || 0);
    const demand = Math.max(policy.targetAvailable, waitingCount);
    const inflightCount = Number(inflight?.count || 0);
    return {
      ...policy, available, waiting: waitingCount, demandOrderId: oldestOrder?.id || null,
      inflight: inflightCount, demand, deficit: demand - available - inflightCount
    };
  }

  async function refreshStockAlert(measured, { enabled }) {
    const key = `card-stock-low:${measured.providerAccountId}:${measured.productCode}`;
    if (measured.targetAvailable > 0 && measured.available < measured.targetAvailable) {
      await upsertSupplyAlert(pool, {
        type: ALERT_TYPES.STOCK_LOW, key, severity: 'warning', title: '可用卡库存偏低',
        message: `${measured.accountLabel} 的 ${measured.productCode} 可分配 ${measured.available} 张，水位 ${measured.targetAvailable}${enabled ? '，调度器正在补' : '，自动开卡总闸关闭，不会自动补'}。`
      });
      return true;
    }
    await resolveSupplyAlert(pool, key);
    return false;
  }

  function pickFallback({ demandAccountId, productId, accountsById, selections }) {
    // 只有 Browser 需求才转台：选择表 BROWSER 行指向缺卡那台，说明这批需求由 Browser 消费；
    // API 行冻结 hnskj，不转（D-253）。
    const browserRow = selections.find((row) => row.productId === productId && row.executorKind === 'BROWSER');
    if (!browserRow || browserRow.providerAccountId !== demandAccountId) return { account: null, reason: 'NOT_BROWSER_DEMAND' };
    const current = now();
    for (const account of accountsById.values()) {
      if (account.id === demandAccountId || !account.supportsBrowserRecharge) continue;
      if (accountCanOpen(account, adapters, { now: current }).ok) return { account, reason: null };
    }
    return { account: null, reason: 'NO_FALLBACK_ACCOUNT' };
  }

  async function scheduleFor(candidate, state) {
    const current = now();
    const demandAccount = state.accountsById.get(candidate.providerAccountId);
    let opener = demandAccount;
    let fallbackFor = null;
    const canOpen = accountCanOpen(demandAccount, adapters, { now: current });
    if (!canOpen.ok) {
      const fallback = pickFallback({ demandAccountId: demandAccount.id, productId: candidate.productId,
        accountsById: state.accountsById, selections: state.selections });
      if (!fallback.account) {
        await upsertSupplyAlert(pool, {
          type: ALERT_TYPES.BLOCKED, key: `card-supply-blocked:${demandAccount.id}:${candidate.productCode}`, severity: 'critical',
          title: '缺卡但开不出来',
          message: `${demandAccount.displayName} 的 ${candidate.productCode} 缺 ${candidate.deficit} 张：该台此刻不能开（${canOpen.reason}），${fallback.reason === 'NOT_BROWSER_DEMAND' ? 'API 路线不转台' : '没有别的卡台能顶上'}。`,
          orderId: candidate.demandOrderId
        });
        return { scheduled: false, reason: 'BLOCKED', cause: canOpen.reason, fallback: fallback.reason };
      }
      opener = fallback.account;
      fallbackFor = demandAccount.id;
    }
    await resolveSupplyAlert(pool, `card-supply-blocked:${demandAccount.id}:${candidate.productCode}`);

    const openerPolicy = state.policies.find((row) => row.providerAccountId === opener.id && row.productCode === candidate.productCode) || null;
    const dailyLimit = openerPolicy?.dailyOpenLimit ?? candidate.dailyOpenLimit;
    const usedToday = await countTodayOpenings(pool, { providerAccountId: opener.id, now: current });
    if (usedToday >= dailyLimit) {
      return { scheduled: false, reason: 'DAILY_LIMIT', opener: opener.id, usedToday, dailyLimit };
    }

    const adapter = adapters.for(opener.openAdapter);
    const adapterGate = await adapter.canOpen(opener);
    if (!adapterGate.ok) {
      await markSupplyFault(pool, { providerAccountId: opener.id, reason: adapterGate.reason, now: current });
      return { scheduled: false, reason: 'ADAPTER_CANNOT_OPEN', opener: opener.id, cause: adapterGate.reason };
    }
    let wallet;
    try {
      wallet = await adapter.readWallet(opener);
    } catch (error) {
      const reason = String(error?.code || error?.kind || 'WALLET_READ_FAILED');
      await markSupplyFault(pool, { providerAccountId: opener.id, reason, now: current });
      return { scheduled: false, reason: 'WALLET_READ_FAILED', opener: opener.id, cause: reason };
    }
    if (wallet.purchaseEnabled === false) {
      await markSupplyFault(pool, { providerAccountId: opener.id, reason: 'CARD_STOCK_PURCHASE_DISABLED', now: current });
      return { scheduled: false, reason: 'ADAPTER_CANNOT_OPEN', opener: opener.id, cause: 'CARD_STOCK_PURCHASE_DISABLED' };
    }
    const amount = candidate.openCardAmount;
    const amountCents = toCents(String(amount));
    const fee = estimateIssueFeeCents({
      observedCents: await observedIssueFeeCents(pool, { providerAccountId: opener.id }), amountCents
    });
    const preflight = walletPreflight({ availableBalance: wallet.availableBalance, amount, feeCents: fee.cents, floor: opener.walletFloor });
    const alertThreshold = opener.walletAlertThreshold == null ? null : toCents(String(opener.walletAlertThreshold));
    const balanceCents = toCents(String(wallet.availableBalance));
    if (alertThreshold != null && balanceCents != null && balanceCents < alertThreshold) {
      await upsertSupplyAlert(pool, {
        type: ALERT_TYPES.WALLET_ALERT, key: `provider-wallet-low:${opener.id}`, severity: 'warning',
        title: '卡台钱包余额低于告警线',
        message: `${opener.displayName} 钱包 ${wallet.availableBalance} ${wallet.currency}，告警线 ${opener.walletAlertThreshold}。`
      });
    } else {
      await resolveSupplyAlert(pool, `provider-wallet-low:${opener.id}`);
    }
    if (!preflight.ok) {
      await upsertSupplyAlert(pool, {
        type: ALERT_TYPES.WALLET_LOW, key: `card-supply-wallet-low:${opener.id}`, severity: 'critical',
        title: '卡台钱包不够开卡',
        message: `${opener.displayName} 钱包 ${preflight.balance ?? wallet.availableBalance}，开 ${candidate.productCode} 一张要 ${preflight.amount ?? amount} + 手续费约 ${preflight.fee ?? '?'}（${fee.source}），扣完剩 ${preflight.projected ?? '?'}，低于硬底线 ${preflight.floor ?? opener.walletFloor}；未开卡，请充值钱包。`,
        orderId: candidate.demandOrderId
      });
      return { scheduled: false, reason: 'WALLET_BELOW_FLOOR', opener: opener.id, preflight, fee };
    }
    await resolveSupplyAlert(pool, `card-supply-wallet-low:${opener.id}`);

    const segment = openerPolicy?.cardSegment || opener.defaultCardSegment;
    if (!segment) return { scheduled: false, reason: 'NO_CARD_SEGMENT', opener: opener.id };
    let evaluation = null;
    try {
      evaluation = await adapter.preflight(opener, { segment, amount, wallet });
    } catch (error) {
      return { scheduled: false, reason: 'ADAPTER_PREFLIGHT_REJECTED', opener: opener.id, cause: String(error?.code || error?.message) };
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [active] = await connection.query(
        `SELECT id FROM card_stock_jobs WHERE status IN ('PENDING','RUNNING') LIMIT 1 FOR UPDATE`
      );
      if (active.length) {
        await connection.commit();
        return { scheduled: false, reason: 'JOB_ACTIVE' };
      }
      const id = crypto.randomUUID();
      const estimatedTotal = fromCents(amountCents + fee.cents);
      await connection.query(
        `INSERT INTO card_stock_jobs
         (id, status, job_source, provider_account_id, product_code, fallback_for_provider_account_id,
          card_type_id, amount, estimated_total, rules_snapshot_json, requested_count)
         VALUES (?, 'PENDING', 'AUTOMATIC', ?, ?, ?, ?, ?, ?, ?, 1)`,
        [id, opener.id, candidate.productCode, fallbackFor, String(segment), String(amount), estimatedTotal,
          JSON.stringify({
            demandOrderId: candidate.demandOrderId,
            demandProviderAccountId: candidate.providerAccountId,
            policy: { targetAvailable: candidate.targetAvailable, dailyOpenLimit: dailyLimit, openCardAmount: amount, cardSegment: segment },
            measured: { available: candidate.available, waiting: candidate.waiting, inflight: candidate.inflight, deficit: candidate.deficit },
            wallet: { availableBalance: wallet.availableBalance, currency: wallet.currency, floor: opener.walletFloor },
            feeEstimate: { cents: fee.cents, source: fee.source },
            preflight, evaluation: evaluation || null, usedToday, cardType: evaluation?.cardType || { name: null }
          })]
      );
      await connection.commit();
      return { scheduled: true, id, opener: opener.id, fallbackFor, productCode: candidate.productCode,
        amount: String(amount), segment: String(segment), preflight, fee, usedToday, dailyLimit };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function run() {
    const state = await loadState();
    const measured = [];
    for (const policy of state.policies) {
      const account = state.accountsById.get(policy.providerAccountId);
      const row = await measure(policy);
      row.accountLabel = account.displayName;
      row.low = await refreshStockAlert(row, { enabled: state.enabled });
      measured.push(row);
    }
    const decisions = measured.map((row) => ({
      providerAccountId: row.providerAccountId, productCode: row.productCode, available: row.available,
      target: row.targetAvailable, waiting: row.waiting, inflight: row.inflight, deficit: row.deficit, low: row.low
    }));
    if (!state.enabled) return { enabled: false, reason: 'DISABLED', decisions, scheduled: null };
    const [active] = await pool.query(`SELECT id FROM card_stock_jobs WHERE status IN ('PENDING','RUNNING') LIMIT 1`);
    if (active.length) return { enabled: true, reason: 'JOB_ACTIVE', decisions, scheduled: null };
    const [unresolved] = await pool.query(unresolvedPaidJobsSql());
    if (unresolved.length) return { enabled: true, reason: 'FUNDS_REVIEW_REQUIRED', decisions, scheduled: null, jobId: unresolved[0].id };
    const candidates = measured.filter((row) => row.deficit > 0)
      .sort((a, b) => (b.waiting - a.waiting) || (a.productCode === 'plus' ? -1 : b.productCode === 'plus' ? 1 : 0));
    if (!candidates.length) return { enabled: true, reason: 'NO_DEMAND', decisions, scheduled: null };
    const outcome = await scheduleFor(candidates[0], state);
    return { enabled: true, reason: outcome.scheduled ? 'SCHEDULED' : outcome.reason, decisions, scheduled: outcome.scheduled ? outcome : null, outcome };
  }

  return Object.freeze({ run, measure, scheduleFor, loadState });
}
