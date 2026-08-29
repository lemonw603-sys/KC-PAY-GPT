export function eligibleInventoryCardSql(alias = 'c', minimumSql = '?', { productCode = 'plus' } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid card SQL alias');
  const normalizedProduct = String(productCode || 'plus').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(normalizedProduct)) throw new TypeError('Invalid product code');
  return `${alias}.order_id IS NULL
    AND ${alias}.inventory_status = 'AVAILABLE'
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND LOWER(${alias}.status) IN ('active','available','usable','ready')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND ${alias}.last_transaction_synced_at IS NOT NULL
    AND ${alias}.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
    AND ${alias}.current_balance >= ${minimumSql}
    AND NOT EXISTS (
      SELECT 1 FROM card_assignment_history eligible_history
      WHERE eligible_history.card_id = ${alias}.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM card_transactions eligible_purchase
      WHERE eligible_purchase.card_id = ${alias}.id
        AND UPPER(eligible_purchase.transaction_type) = 'PURCHASE'
    )
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
  return `${alias}.order_id IS NULL
    AND ${alias}.inventory_status IN ('AVAILABLE','DEPLETED','PROVISIONING')
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND LOWER(${alias}.status) IN ('active','available','usable','ready')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND ${alias}.current_balance IS NOT NULL
    AND ${alias}.last_transaction_synced_at IS NOT NULL
    AND ${alias}.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
    AND NOT EXISTS (
      SELECT 1 FROM card_assignment_history fundable_history
      WHERE fundable_history.card_id = ${alias}.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM card_transactions fundable_purchase
      WHERE fundable_purchase.card_id = ${alias}.id
        AND UPPER(fundable_purchase.transaction_type) = 'PURCHASE'
    )
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
  return `${alias}.order_id IS NULL
    AND ${alias}.inventory_status IN ('AVAILABLE','DEPLETED','PROVISIONING')
    AND ${alias}.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
    AND ${alias}.card_credentials_ciphertext IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM card_assignment_history refresh_history
      WHERE refresh_history.card_id = ${alias}.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM card_transactions refresh_purchase
      WHERE refresh_purchase.card_id = ${alias}.id
        AND UPPER(refresh_purchase.transaction_type) = 'PURCHASE'
    )
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
