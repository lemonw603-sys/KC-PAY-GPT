export function eligibleInventoryCardSql(alias = 'c', minimumSql = '?', { productCode = 'plus' } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
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
      ${alias}.funded_amount - COALESCE((
        SELECT SUM(eligible_spend.amount) FROM card_consumption_ledger eligible_spend
        LEFT JOIN orders eligible_spend_order ON eligible_spend_order.id = eligible_spend.order_id
        WHERE eligible_spend.card_id = ${alias}.id
          AND (eligible_spend.status IN ('RESERVED','CONSUMED','RECONCILIATION')
            OR (eligible_spend.status = 'RELEASED'
              AND eligible_spend_order.status = 'RECHARGE_SUCCESS'))
      ), 0)
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
    )`;
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
