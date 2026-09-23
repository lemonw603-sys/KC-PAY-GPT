/**
 * 最低卡余额的**唯一**口径：先查按产品的键，缺了才回落全局 default。
 * 与真实建单 order-intake-repository.minimumRequiredCardBalanceForPlan() 同语义。
 * 生产实值（2026-09-20）：plus 16.00 / pro_5x 16.00 / pro_20x 150.00。
 *
 * 这份原本在 card-source-selection-service.js，而 providerCardStockSql 里
 * 又抄了一份写死全局键的版本 —— 同一个口径两处实现、其中一处是错的，正是 D-273
 * 「别为已经实现的东西再造第二份」说的那类。收敛到这里，两边都引用它。
 */
export function minimumBalanceSql(productCode) {
  const plan = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(plan)) throw new TypeError('Invalid product code');
  return `COALESCE(
    (SELECT CAST(setting_value AS DECIMAL(18,6)) FROM app_settings WHERE setting_key = 'minimum_required_card_balance:${plan}' LIMIT 1),
    (SELECT CAST(setting_value AS DECIMAL(18,6)) FROM app_settings WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1),
    999999999)`;
}

/**
 * 「这张卡按账本已经花掉多少」的唯一口径（D-217 的账本侧）。RELEASED 只在订单成功时计入：
 * 失败单的 RELEASED 是卡没用（不计），成功单的 RELEASED 是收口脚本记法差异（必须计）。
 * 资格 SQL 与 D-354 的 funded_amount 回填脚本共用，脚本不抄第二份。
 */
export function ledgerSpendSql(alias = 'c') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  return `COALESCE((
        SELECT SUM(eligible_spend.amount) FROM card_consumption_ledger eligible_spend
        LEFT JOIN orders eligible_spend_order ON eligible_spend_order.id = eligible_spend.order_id
        WHERE eligible_spend.card_id = ${alias}.id
          AND (eligible_spend.status IN ('RESERVED','CONSUMED','RECONCILIATION')
            OR (eligible_spend.status = 'RELEASED'
              AND eligible_spend_order.status = 'RECHARGE_SUCCESS'))
      ), 0)`;
}

export function eligibleInventoryCardSql(alias = 'c', minimumSql = '?', { productCode = 'plus' } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
  // 大额卡不给 Plus 用（Lemon 2026-09-20 定：「金额大于 75 美金，默认不能给 Plus 充」）。
  //
  // 为什么需要这条：卡本身不记产品归属（cards 表没有产品字段），开卡任务记了
  // product_code 但开出的卡不回写，唯一的产品限定是人工标 PRODUCT_ONLY。所以往后台放
  // 一张 $150 的 20X 卡时，只要忘了手动标，它就满足 Plus 的全部条件（余额 ≥ $16），
  // 立刻进 Plus 可分配池 —— Plus 单花掉 $16，剩下的继续被 Plus 吃到每卡单数上限，
  // 一百多美金卡死在那张卡上。这条规则不依赖任何人记得打标记。
  //
  // 判定金额取 GREATEST(当前余额, 充值金额)：只看当前余额的话，$150 的卡用掉一半
  // 降到 $70 就又能给 Plus 充，等于没堵。
  //
  // 「默认」＝可被显式覆盖：明确标了 PRODUCT_ONLY=plus 的卡仍然放行（运营知道自己在做什么）。
  // 阈值可调：往 app_settings 插 plus_max_card_balance；没有这个键时用 75。
  //
  // 生产实测（2026-09-20 立规则当天）：在库 9 张，判定金额最大 $50，**零误伤**。
  const plusLargeCardGuard = normalizedProduct !== 'plus' ? '' : `
    AND (
      GREATEST(${alias}.current_balance, COALESCE(${alias}.funded_amount, 0)) <= COALESCE(
        (SELECT CAST(setting_value AS DECIMAL(18,6)) FROM app_settings
          WHERE setting_key = 'plus_max_card_balance' LIMIT 1), 75)
      OR EXISTS (
        SELECT 1 FROM card_operational_overrides plus_large_override
        WHERE plus_large_override.provider_account_id = ${alias}.provider_account_id
          AND BINARY plus_large_override.external_card_id = BINARY ${alias}.external_card_id
          AND plus_large_override.allocation_policy = 'PRODUCT_ONLY'
          AND LOWER(COALESCE(plus_large_override.product_code, '')) = 'plus'
      )
    )`;

  return `${alias}.inventory_status IN ('AVAILABLE','ASSIGNED','DEPLETED')
    AND COALESCE(${alias}.source_present, 1) = 1
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND LOWER(${alias}.status) IN ('active','available','usable','ready')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND (${alias}.sync_tier = 'MANUAL_IMPORT' OR (
      ${alias}.last_transaction_synced_at IS NOT NULL
      AND ${alias}.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
    ))
    -- D-217：可用额取「同步余额」与「按账本推算的余额」中的较小者。
    -- 单看任一个都会放行一张钱不够的卡，2026-09-14 实测四张卡：
    --   1657 同步 18.56 / 推算 18.00   两者接近
    --   3159 同步 2.84  / 推算 2.00    账本更严，对
    --   3118 同步 1.07  / 推算 12.00   ← 账本漏记了消费，只看账本会放行
    --   5371 同步 2.84  / 推算 18.00   ← 同上，偏乐观 15 元
    -- 取较小者让两种偏差互相兜底：同步滞后时账本补上，账本漏记时同步兜底。
    --
    -- 为什么必须有账本这一侧：卡台快照每小时才同步一次，付款后那一小时里
    -- current_balance 仍是旧值，系统会把一张刚用掉大半的卡再分出去，下一单必然
    -- 因余额不足失败（Lemon 2026-09-14 指出这个可预测的失败）。
    --
    -- RELEASED 要看订单：订单失败=卡真没用（不计），订单成功=卡用了但收口脚本
    -- 记成了 RELEASED（必须计）。把所有 RELEASED 一律当消费会荒谬地保守——
    -- 5371 有 7 笔失败单的 RELEASED，那样它会被算成用了 8 次。
    AND LEAST(
      ${alias}.current_balance,
      ${alias}.funded_amount - ${ledgerSpendSql(alias)}
    ) >= ${minimumSql}
    AND (SELECT COUNT(*) FROM card_consumption_ledger eligible_usage
      WHERE eligible_usage.card_id = ${alias}.id
        AND eligible_usage.status IN ('RESERVED','CONSUMED','RECONCILIATION'))
      < COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM app_settings
        WHERE setting_key='card_max_successful_payments' LIMIT 1), 3)
    AND NOT EXISTS (SELECT 1 FROM card_assignment_history eligible_assignment
      WHERE eligible_assignment.card_id=${alias}.id AND eligible_assignment.status='ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM card_funding_attempts eligible_funding
      WHERE eligible_funding.card_id=${alias}.id
        AND (eligible_funding.status='PREPARED'
          OR eligible_funding.funds_risk_state IN ('ACTIVE','UNKNOWN')))
    AND NOT EXISTS (
      SELECT 1 FROM refund_cases eligible_refund
      WHERE eligible_refund.card_id = ${alias}.id
        AND eligible_refund.status <> 'WITHDRAWN'
    )
    AND NOT EXISTS (
      SELECT 1 FROM card_operational_overrides eligible_override
      WHERE eligible_override.provider_account_id = ${alias}.provider_account_id
        AND BINARY eligible_override.external_card_id = BINARY ${alias}.external_card_id
        AND (
          eligible_override.allocation_policy = 'RETIRED'
          OR (eligible_override.allocation_policy = 'PRODUCT_ONLY'
            AND LOWER(COALESCE(eligible_override.product_code, '')) <> '${normalizedProduct}')
        )
    )${plusLargeCardGuard}`;
}

export function fundableInventoryCardSql(alias = 'c', { productCode = 'plus' } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
  return `${alias}.inventory_status IN ('AVAILABLE','ASSIGNED','DEPLETED','PROVISIONING')
    AND COALESCE(${alias}.source_present, 1) = 1
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND LOWER(${alias}.status) IN ('active','available','usable','ready')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND ${alias}.current_balance IS NOT NULL
    AND ${alias}.sync_tier <> 'MANUAL_IMPORT'
    AND ${alias}.last_transaction_synced_at IS NOT NULL
    AND ${alias}.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
    AND (SELECT COUNT(*) FROM card_consumption_ledger fundable_usage
      WHERE fundable_usage.card_id = ${alias}.id
        AND fundable_usage.status IN ('RESERVED','CONSUMED','RECONCILIATION'))
      < COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM app_settings
        WHERE setting_key='card_max_successful_payments' LIMIT 1), 3)
    AND NOT EXISTS (SELECT 1 FROM card_assignment_history fundable_assignment
      WHERE fundable_assignment.card_id=${alias}.id AND fundable_assignment.status='ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM card_funding_attempts fundable_funding
      WHERE fundable_funding.card_id=${alias}.id
        AND (fundable_funding.status='PREPARED'
          OR fundable_funding.funds_risk_state IN ('ACTIVE','UNKNOWN')))
    AND NOT EXISTS (
      SELECT 1 FROM refund_cases fundable_refund
      WHERE fundable_refund.card_id = ${alias}.id
        AND fundable_refund.status <> 'WITHDRAWN'
    )
    AND NOT EXISTS (
      SELECT 1 FROM card_operational_overrides fundable_override
      WHERE fundable_override.provider_account_id = ${alias}.provider_account_id
        AND BINARY fundable_override.external_card_id = BINARY ${alias}.external_card_id
        AND (
          fundable_override.allocation_policy = 'RETIRED'
          OR (fundable_override.allocation_policy = 'PRODUCT_ONLY'
            AND LOWER(COALESCE(fundable_override.product_code, '')) <> '${normalizedProduct}')
        )
    )`;
}

// Candidate cards may be stale, so this predicate must never be used to assign
// or spend a card. It exists only to enqueue one on-demand read synchronization
// when a real order is waiting, avoiding high-frequency polling of the full catalog.
export function refreshableInventoryCardSql(alias = 'c', { productCode = 'plus' } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
  return `${alias}.inventory_status IN ('AVAILABLE','ASSIGNED','DEPLETED','PROVISIONING')
    AND COALESCE(${alias}.source_present, 1) = 1
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND ${alias}.sync_tier <> 'MANUAL_IMPORT'
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND (SELECT COUNT(*) FROM card_consumption_ledger refresh_usage
      WHERE refresh_usage.card_id = ${alias}.id
        AND refresh_usage.status IN ('RESERVED','CONSUMED','RECONCILIATION'))
      < COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM app_settings
        WHERE setting_key='card_max_successful_payments' LIMIT 1), 3)
    AND NOT EXISTS (SELECT 1 FROM card_assignment_history refresh_assignment
      WHERE refresh_assignment.card_id=${alias}.id AND refresh_assignment.status='ACTIVE')
    AND NOT EXISTS (
      SELECT 1 FROM refund_cases refresh_refund
      WHERE refresh_refund.card_id = ${alias}.id
        AND refresh_refund.status <> 'WITHDRAWN'
    )
    AND NOT EXISTS (
      SELECT 1 FROM card_operational_overrides refresh_override
      WHERE refresh_override.provider_account_id = ${alias}.provider_account_id
        AND BINARY refresh_override.external_card_id = BINARY ${alias}.external_card_id
        AND (
          refresh_override.allocation_policy = 'RETIRED'
          OR (refresh_override.allocation_policy = 'PRODUCT_ONLY'
            AND LOWER(COALESCE(refresh_override.product_code, '')) <> '${normalizedProduct}')
        )
    )`;
}

/**
 * 库存口径（水位统计 / 切换校验用）= 正式资格规则 **去掉 15 分钟新鲜度那一句**，其余条件原样。
 *
 * 分卡时那句「hnskj 卡的流水同步必须在 15 分钟内」是分配前的证据要求，不是这张卡不存在：
 * 5276 每小时整点同步一次，窗口外按资格 SQL 数是 0 张，调度器会以为缺 2 张、两分钟开出 2 张
 * （Lemon 2026-09-18 指出）。库存数只问「这张卡结构上还能不能服务新单」：余额、次数上限、
 * 活动分配、资金/退款风险、RETIRED/PRODUCT_ONLY 全部保留；新鲜度留给分卡与面二⑨按需同步。
 *
 * 不复制规则：从 eligibleInventoryCardSql 生成后只把那一句替换成「至少同步过一次」；
 * 找不到那一句就抛错，免得规则改了这里静默变成分配口径（D-172 惯犯 3）。
 */
const FRESHNESS_CLAUSE = /\(\s*(\w+)\.sync_tier = 'MANUAL_IMPORT' OR \(\s*\1\.last_transaction_synced_at IS NOT NULL\s+AND \1\.last_transaction_synced_at >= DATE_SUB\(CURRENT_TIMESTAMP\(3\), INTERVAL 15 MINUTE\)\s*\)\)/;

export function stockCountingCardSql(alias = 'c', minimumSql = '?', { productCode = 'plus' } = {}) {
  const eligible = eligibleInventoryCardSql(alias, minimumSql, { productCode });
  const match = FRESHNESS_CLAUSE.exec(eligible);
  if (!match || match[1] !== alias) {
    throw new Error('stockCountingCardSql: freshness clause not found in eligibleInventoryCardSql; rule changed, re-derive');
  }
  return eligible.replace(FRESHNESS_CLAUSE, `(${alias}.sync_tier = 'MANUAL_IMPORT' OR ${alias}.last_transaction_synced_at IS NOT NULL)`);
}

/**
 * 按卡台聚合库存（D-280 ①「两台并列、同一张脸」）。
 *
 * 唯一定义：工作台「卡与钱」和卡片页顶部台账栏都调这一份，所以两处永远同口径。
 * 页面不许再写一套判断。
 *
 * **一个数说不了两件事，所以这里算两个**（2026-09-20 Lemon 追问「HNSKJ 明明有两张卡，
 * 为什么可分配是 0」而查出来的）：
 *
 *   stock_available  库存口径 —— 这张卡结构上还能不能服务新单（余额、次数上限、活动分配、
 *                    资金/退款风险、RETIRED/PRODUCT_ONLY 全查，**不查 15 分钟同步时效**）。
 *                    「卡够不够」问的是这个数。
 *   bindable_now     分配口径 —— 此刻能不能立即绑单，比上面多一条「hnskj 卡的流水必须
 *                    15 分钟内同步过」。那是**付款前的证据要求**，不是这张卡不存在。
 *                    **界面上不显示它**（Lemon 2026-09-20 定）：它是个会自己恢复的瞬时值，
 *                    客户下单分不到卡时系统会自动排一次按需同步再重试，运营不需要为它操心，
 *                    摆出来只会让人以为卡出了事。留着它有两个用处：诊断「这张卡为什么
 *                    分不出去」，以及让 card-inventory-eligibility.test.js 能钉住
 *                    「两个口径除了新鲜度那一句必须完全相同」。**所以它当前没有 UI 消费方
 *                    是有意的，不是 F-71/F-72 那种「标记落了没人用」的漏。**
 *
 * 为什么必须分开：hnskj 的卡**每 3 小时**同步一次，而时效窗口是 15 分钟 —— 同一批好卡
 * 在每 3 小时里只有头 15 分钟算「可分配」，其余 91.7% 的时间是 0。生产 2026-09-20 10:56 实测：
 * legacy-primary 分配口径 0 / 库存口径 2 / 在库 2，两张卡余额 $16 与 $50、状态全正常。
 *
 * Lemon 2026-09-18 就指出过这个坑，当时**只修了补卡调度器**（它改用库存口径数，所以不会
 * 误判缺卡去开卡），卡片页与工作台这一侧漏了 —— 两处「同口径」没错，用的都是错的那个。
 *
 * in_stock 只排除 RETIRED，是「这台还剩几张卡」，比 stock_available 还宽（它不看余额与
 * 次数上限）。三个数依次收紧：in_stock ≥ stock_available ≥ bindable_now。
 */
export function providerCardStockSql({ productCode = 'plus' } = {}) {
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
  // 最低卡余额按产品取（唯一口径见 minimumBalanceSql）。此前这里写死取全局键，
  // productCode 只影响资格规则、不影响余额门槛：只调 plus 时看不出来，一旦按产品
  // 统计就严重高估 —— 生产实测在库 9 张里 ≥16（plus）4 张、≥150（pro_20x）0 张，
  // 照旧写法 20X 会显示「可分配 4」而真实是 0。
  const minimumSql = minimumBalanceSql(normalizedProduct);
  return `SELECT pa.id AS provider_account_id,
      pa.account_code AS provider_code,
      pa.provider_code AS provider_kind,
      -- token/供给故障的权威位置：补卡调度器失败时写 FAULT + 原因，贴新 token 清回 OK。
      -- 「已失效」只认这个，不靠 tokenStatus()（它只答配没配过）。
      pa.supply_fault_state, pa.supply_fault_reason, pa.supply_fault_at,
      -- 钱包底线的唯一来源：wallet_floor 就是开卡预检 walletPreflight 里那条硬底线
      -- （「扣完剩 X，低于硬底线 Y；未开卡」）。D-273 的教训是别为一个已经实现的东西
      -- 再造第二份，页面显示的底线必须就是挡开卡的那一个。
      pa.wallet_floor, pa.wallet_alert_threshold,
      -- 卡台健康：运营手动停用 / 熔断 / 有没有导入过完整快照。
      -- 这三项原先只在「卡台管理」那张表里露面（D-309 把表删了，状态并进台账栏）——
      -- 一台卡台是不是能用，该和它的可分配/钱包/日限显示在同一处，不该另开一张表。
      pa.operational_enabled, pa.circuit_state, pa.last_full_snapshot_at,
      -- 水位与日限的真实来源是 card_supply_policies（按台×按产品），补卡调度器读的就是它。
      -- app_settings 里的 card_stock_low_threshold / card_replenishment_daily_limit 早已被它
      -- 取代（step6 任务书 D 发现 1；生产实值 1 与 10，而策略表是 2 与 20）——显示那两个
      -- 全局键等于告诉运营一个系统根本不用的数。这里按 Plus 取，与「可分配」的口径一致。
      sp.target_available AS plus_target_available,
      sp.daily_open_limit AS plus_daily_open_limit,
      COUNT(*) AS total,
      SUM(c.inventory_status <> 'RETIRED') AS in_stock,
      -- 库存口径：「卡够不够」的答案，页面主数。
      SUM((${stockCountingCardSql('c', minimumSql, { productCode })})) AS stock_available,
      -- 分配口径：此刻能立即绑几张。比上面多一条 15 分钟同步时效，是个会自行恢复的瞬时值。
      SUM((${eligibleInventoryCardSql('c', minimumSql, { productCode })})) AS bindable_now,
      SUM(EXISTS(SELECT 1 FROM card_assignment_history ah
        WHERE ah.card_id=c.id AND ah.status='ACTIVE')) AS in_use,
      SUM((SELECT COUNT(*) FROM card_consumption_ledger u
        WHERE u.card_id=c.id AND u.status IN ('RESERVED','CONSUMED','RECONCILIATION'))>0) AS any_used,
      -- 按**产品**用过几张卡。上面那个 any_used 不分产品（它答的是「这张卡被用过没」），
      -- 拿它当按产品的用量会三个产品完全相同 —— 2026-09-20 生产实测：plus / pro_5x /
      -- pro_20x 三个口径的 any_used 都是 6，而真实按产品用量是 plus 12 / pro_20x 1 / pro_5x 0。
      -- 产品归属只能从账本 JOIN 回订单取 plan_type，卡本身不记自己服务过哪个产品。
      SUM(EXISTS(SELECT 1 FROM card_consumption_ledger pu
        JOIN orders po ON po.id = pu.order_id
        WHERE pu.card_id = c.id
          AND pu.status IN ('RESERVED','CONSUMED','RECONCILIATION')
          AND po.plan_type = '${normalizedProduct}')) AS product_used
    FROM cards c INNER JOIN provider_accounts pa ON pa.id=c.provider_account_id
    LEFT JOIN card_supply_policies sp ON sp.provider_account_id = pa.id AND sp.product_code = '${normalizedProduct}'
    -- 只统计**卡台**。provider_accounts 里还有 purpose='RECHARGE' 的行（zzshu 旧直充系统，
    -- CLAUDE.md：只保留历史兼容、不参与新链路），它不是卡台。全项目筛卡台都用 purpose='CARD'
    -- （分卡 workflow-repository、路线 provider-route-service、设置页、导入），唯独这里漏了。
    -- 此前不出错只是因为 zzshu 恰好 0 张卡 —— 依赖「碰巧没卡」而不是「它不是卡台」，
    -- 哪天历史数据让它挂上一张，工作台就会冒出第三个卡台（2026-09-20 我自己就这么看错过）。
    WHERE pa.purpose = 'CARD'
    GROUP BY pa.id, pa.account_code, pa.provider_code, pa.supply_fault_state,
      pa.supply_fault_reason, pa.supply_fault_at, pa.wallet_floor, pa.wallet_alert_threshold,
      pa.operational_enabled, pa.circuit_state, pa.last_full_snapshot_at,
      sp.target_available, sp.daily_open_limit
    ORDER BY pa.provider_code`;
}

/**
 * 「今天」＝ UTC+8 自然日（Lemon 在 UTC+8 运营，日限按他看到的那一天算）。
 * 唯一定义：工作台要全局合计、卡片页要按台明细，两个数必须落在同一个窗口里，
 * 否则「今日已开 3」和两台「1 + 1」对不上。调用方自己决定 GROUP BY 与否。
 */
export function todayCst8WindowSql(column = 'created_at') {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) throw new TypeError('Invalid column');
  return `${column} >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) - INTERVAL 8 HOUR
      AND ${column} < TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) + INTERVAL 16 HOUR`;
}

/**
 * 截至今天的最近 N 个 UTC+8 自然日（含今天）。与 todayCst8WindowSql 共用同一日界。
 * days 是源码内部常量，仍做整数与上界校验，防止 SQL 片段被污染或误传大范围。
 */
export function recentCst8CalendarDaysWindowSql(column = 'created_at', days = 7) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) throw new TypeError('Invalid column');
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new TypeError('Invalid day count');
  return `${column} >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) - INTERVAL ${days - 1} DAY - INTERVAL 8 HOUR
      AND ${column} < TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) + INTERVAL 16 HOUR`;
}

/** 已开/在途张数：PENDING/RUNNING 按请求数占位，其余按实开数。与日限对比用。 */
export const REPLENISHMENT_OPENED_COUNT_SQL =
  `COALESCE(SUM(CASE WHEN status IN ('PENDING','RUNNING') THEN requested_count ELSE opened_count END), 0)`;
