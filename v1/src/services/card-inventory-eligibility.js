export function eligibleInventoryCardSql(alias = 'c', minimumSql = '?', { productCode = 'plus' } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
  return `${alias}.inventory_status IN ('AVAILABLE','ASSIGNED','DEPLETED')
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND LOWER(${alias}.status) IN ('active','available','usable','ready')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND ${alias}.last_transaction_synced_at IS NOT NULL
    AND ${alias}.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
    AND ${alias}.current_balance >= ${minimumSql}
    AND (SELECT COUNT(*) FROM card_consumption_ledger eligible_usage
      WHERE eligible_usage.card_id = ${alias}.id
        AND eligible_usage.status IN ('RESERVED','CONSUMED','RECONCILIATION'))
      < COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM app_settings
        WHERE setting_key='card_max_successful_payments' LIMIT 1), 3)
    AND NOT EXISTS (SELECT 1 FROM card_assignment_history eligible_assignment
      WHERE eligible_assignment.card_id=${alias}.id AND eligible_assignment.status='ACTIVE')
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
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND LOWER(${alias}.status) IN ('active','available','usable','ready')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND ${alias}.current_balance IS NOT NULL
    AND ${alias}.last_transaction_synced_at IS NOT NULL
    AND ${alias}.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
    AND (SELECT COUNT(*) FROM card_consumption_ledger fundable_usage
      WHERE fundable_usage.card_id = ${alias}.id
        AND fundable_usage.status IN ('RESERVED','CONSUMED','RECONCILIATION'))
      < COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM app_settings
        WHERE setting_key='card_max_successful_payments' LIMIT 1), 3)
    AND NOT EXISTS (SELECT 1 FROM card_assignment_history fundable_assignment
      WHERE fundable_assignment.card_id=${alias}.id AND fundable_assignment.status='ACTIVE')
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
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
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
