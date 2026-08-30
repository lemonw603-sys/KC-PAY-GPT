import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  eligibleInventoryCardSql,
  fundableInventoryCardSql,
  refreshableInventoryCardSql
} from '../src/services/card-inventory-eligibility.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('inventory predicate permits sequential reuse below capacity but excludes active assignment and disputes', () => {
  const sql = eligibleInventoryCardSql('cards', '?');
  assert.match(sql, /inventory_status IN \('AVAILABLE','ASSIGNED','DEPLETED'\)/);
  assert.match(sql, /current_balance >= \?/);
  assert.match(sql, /last_transaction_synced_at IS NOT NULL/);
  assert.match(sql, /INTERVAL 15 MINUTE/);
  assert.match(sql, /card_consumption_ledger/);
  assert.match(sql, /card_max_successful_payments/);
  assert.match(sql, /eligible_assignment\.status='ACTIVE'/);
  assert.match(sql, /refund_cases/);
  assert.match(sql, /status <> 'WITHDRAWN'/);
  assert.match(sql, /card_operational_overrides/);
  assert.match(sql, /allocation_policy = 'RETIRED'/);
  assert.match(sql, /PRODUCT_ONLY/);
});

test('fundable predicate includes reusable low-balance cards but keeps money-safety exclusions', () => {
  const sql = fundableInventoryCardSql('c');
  assert.match(sql, /inventory_status IN \('AVAILABLE','ASSIGNED','DEPLETED','PROVISIONING'\)/);
  assert.match(sql, /card_credentials_ciphertext IS NOT NULL/);
  assert.match(sql, /last_transaction_synced_at IS NOT NULL/);
  assert.match(sql, /fundable_assignment\.status='ACTIVE'/);
  assert.match(sql, /card_consumption_ledger/);
  assert.match(sql, /card_operational_overrides/);
});

test('refreshable predicate is safe only for on-demand read synchronization', () => {
  const sql = refreshableInventoryCardSql('c');
  assert.match(sql, /inventory_status IN \('AVAILABLE','ASSIGNED','DEPLETED','PROVISIONING'\)/);
  assert.match(sql, /card_credentials_ciphertext IS NOT NULL/);
  assert.match(sql, /refresh_assignment\.status='ACTIVE'/);
  assert.match(sql, /card_consumption_ledger/);
  assert.match(sql, /refund_cases/);
  assert.match(sql, /card_operational_overrides/);
  assert.doesNotMatch(sql, /last_transaction_synced_at/);
  assert.doesNotMatch(sql, /current_balance >=/);
});

test('inventory predicate supports product-specific operational overrides without hard-coding card tails', () => {
  const sql = eligibleInventoryCardSql('c', '0', { productCode: 'plus' });
  assert.match(sql, /external_card_id/);
  assert.match(sql, /COALESCE\(eligible_override\.product_code, ''\).*<> 'plus'/);
  assert.throws(() => eligibleInventoryCardSql('c', '0', { productCode: 'bad product' }), /Invalid product code/);
});

test('stage 4 migration is replay guarded and defaults automatic card spending to disabled', () => {
  const sql = fs.readFileSync(path.join(here, '../migrations/029_waiting_for_card.sql'), 'utf8');
  assert.match(sql, /card_auto_replenishment_enabled', 'false'/);
  assert.match(sql, /card_replenishment_daily_limit', '5'/);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /job_source VARCHAR\(16\).*DEFAULT 'MANUAL'/);
  assert.match(sql, /idx_card_stock_jobs_source_created/);
  assert.doesNotMatch(sql, /purchaseCard|\/cards\/purchase|rechargeCard/);
});

test('card operational override migration is minimal and replay-safe by table creation', () => {
  const sql = fs.readFileSync(path.join(here, '../migrations/040_card_operational_overrides.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS card_operational_overrides/);
  assert.match(sql, /UNIQUE KEY uq_card_operational_override/);
  assert.match(sql, /allocation_policy IN \('NORMAL','PRODUCT_ONLY','RETIRED'\)/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/);
});
