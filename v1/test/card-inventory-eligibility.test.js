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
  // D-217：余额门槛改为「同步余额」与「按账本推算」取较小者。单看任一个都会放行
  // 一张钱不够的卡：同步每小时一次，付款后那一小时里余额是旧的；而账本又可能漏记
  // （2026-09-14 实测 3118 账本推算 12.00、卡台实际 1.07）。以下三条守住这个口径。
  assert.match(sql, /LEAST\(/, '余额判断必须取两者较小值');
  assert.match(sql, /funded_amount -/, '必须有按账本推算的那一侧');
  assert.match(sql, /eligible_spend\.status = 'RELEASED'\s*\n?\s*AND eligible_spend_order\.status = 'RECHARGE_SUCCESS'/,
    'RELEASED 必须看订单结局：订单失败=卡真没用（不计），订单成功=卡用了但被收口脚本记成 RELEASED（必须计）');
  assert.match(sql, />= \?/, '门槛参数仍然要能传进来');
  assert.match(sql, /source_present/);
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
  assert.match(sql, /fundable_funding\.status='PREPARED'/);
  assert.match(sql, /funds_risk_state IN \('ACTIVE','UNKNOWN'\)/);
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
