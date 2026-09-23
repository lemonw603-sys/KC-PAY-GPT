import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  eligibleInventoryCardSql,
  fundableInventoryCardSql,
  providerCardStockSql,
  refreshableInventoryCardSql,
  maxPaymentsSql,
  stockCountingCardSql
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

test('按产品统计库存时，最低卡余额也要按产品取 —— 与真实建单同口径', () => {
  // 真实建单走 order-intake-repository.minimumRequiredCardBalanceForPlan()：
  // 先查 `minimum_required_card_balance:<product>`，缺了才回落全局 default。
  // 这里的统计 SQL 必须用同一套口径，否则页面上的「可分配」和实际能不能派卡对不上。
  //
  // 生产实测（2026-09-20）：在库 9 张里余额 ≥16（plus 口径）4 张、≥150（pro_20x 真实
  // 口径，生产实值）0 张。此前 minimumSql 写死取全局键，传 productCode 只改资格规则、
  // 不改余额门槛 —— 按产品统计时 20X 会显示「可分配 4」，真实是 0。
  const plus = providerCardStockSql();
  const pro20 = providerCardStockSql({ productCode: 'pro_20x' });

  for (const [label, sql, key] of [
    ['plus', plus, 'minimum_required_card_balance:plus'],
    ['pro_20x', pro20, 'minimum_required_card_balance:pro_20x']
  ]) {
    assert.ok(sql.includes(`setting_key = '${key}'`), `${label} 必须先查按产品的余额键`);
    assert.ok(sql.includes("setting_key = 'default_minimum_required_card_balance'"),
      `${label} 取不到按产品值时要回落全局 default`);
  }
  // 两个产品生成的 SQL 必须真的不同 —— 相同就说明 productCode 又被忽略了
  assert.notEqual(plus, pro20);
  // 回落顺序不能反：按产品的键要排在 default 前面
  const idxProduct = pro20.indexOf('minimum_required_card_balance:pro_20x');
  const idxDefault = pro20.indexOf("'default_minimum_required_card_balance'");
  assert.ok(idxProduct > -1 && idxDefault > idxProduct, '按产品的键必须排在全局 default 之前');
});

test('大额卡默认不给 Plus 用，且只约束 Plus（Lemon 2026-09-20 定：>75 美金）', () => {
  // 背景：cards 表没有产品字段，开卡任务记了 product_code 但开出的卡不回写，
  // 唯一的产品限定是人工标 PRODUCT_ONLY。往后台放一张 $150 的 20X 卡时，只要忘了
  // 手动标，它就满足 Plus 的全部条件（余额 ≥ $16）而进 Plus 池，钱卡死在那张卡上。
  const plus = eligibleInventoryCardSql('c', '16');

  // 判定金额取两者较大：只看当前余额的话，$150 的卡用掉一半降到 $70 就又能给 Plus 用
  assert.match(plus, /GREATEST\(\s*c\.current_balance,\s*COALESCE\(c\.funded_amount, 0\)\s*\)/);
  // 阈值可调，缺省 75
  assert.ok(plus.includes("setting_key = 'plus_max_card_balance'"), '阈值要能从 app_settings 调');
  assert.match(plus, /LIMIT 1\), 75\)/);
  // 「默认」＝可被显式覆盖：明确标了 PRODUCT_ONLY=plus 的卡仍然放行
  assert.match(plus, /plus_large_override\.allocation_policy = 'PRODUCT_ONLY'/);
  assert.match(plus, /LOWER\(COALESCE\(plus_large_override\.product_code, ''\)\) = 'plus'/);

  // 只约束 Plus —— 大卡给 5X/20X 用本来就是它该去的地方，不能连它们一起挡住
  for (const product of ['pro_5x', 'pro_20x']) {
    const sql = eligibleInventoryCardSql('c', '150', { productCode: product });
    assert.ok(!sql.includes('plus_max_card_balance'), `${product} 不该带 Plus 的大额守卫`);
  }
});

test('加了大额守卫之后，库存口径仍能从资格规则派生（不复制规则）', async () => {
  // stockCountingCardSql 是「资格规则去掉新鲜度那一句」派生出来的，靠正则定位那一句。
  // 在规则末尾加条件不该碰坏它；碰坏了它会抛错而不是静默变成分配口径。
  const { stockCountingCardSql } = await import('../src/services/card-source-selection-service.js');
  const counting = stockCountingCardSql('c', '16');
  assert.ok(counting.includes('plus_max_card_balance'), '派生结果要保留大额守卫');
  assert.ok(!counting.includes('INTERVAL 15 MINUTE'), '派生结果要去掉新鲜度');
  assert.ok(counting.includes("c.sync_tier = 'MANUAL_IMPORT' OR c.last_transaction_synced_at IS NOT NULL"));
});

test('库存统计只算卡台，不把 zzshu 那类充值渠道当成第三个卡台', () => {
  // provider_accounts 里混着两种：purpose='CARD'（hnskj / highvcc，卡台）和
  // purpose='RECHARGE'（zzshu 旧直充系统，CLAUDE.md 明确「只保留历史兼容、不参与新链路」）。
  // 全项目筛卡台都用 purpose='CARD'（分卡 workflow-repository、路线 provider-route-service、
  // 设置页 card-supply-policy-admin-service、导入 manual-card-import-service），这里曾经漏了。
  //
  // 漏了也不出错，只因为 zzshu 生产上恰好 0 张卡 —— 依赖「碰巧没卡」而不是「它不是卡台」。
  // 2026-09-20 我自己就照着 provider_accounts 的行数报了「生产有 3 个卡台」，被 Lemon 当场纠正。
  for (const product of ['plus', 'pro_5x', 'pro_20x']) {
    const sql = providerCardStockSql({ productCode: product });
    assert.ok(sql.includes("pa.purpose = 'CARD'"), `${product} 的库存统计必须只算卡台`);
    assert.ok(sql.indexOf('WHERE') < sql.indexOf('GROUP BY'), 'WHERE 必须在 GROUP BY 之前');
  }
});

test('库存口径与分配口径是两个数，只差「15 分钟同步时效」那一句（D-307）', async () => {
  const { providerCardStockSql, eligibleInventoryCardSql, stockCountingCardSql, minimumBalanceSql }
    = await import('../src/services/card-inventory-eligibility.js');

  const sql = providerCardStockSql();
  // 两列必须都在。合成一个数正是 2026-09-20 那个 bug：hnskj 每 3 小时同步一次而窗口
  // 只有 15 分钟，好卡在 91.7% 的时间里被算成 0（生产实测 分配 0 / 库存 2 / 在库 2）。
  assert.match(sql, /AS stock_available/);
  assert.match(sql, /AS bindable_now/);
  assert.doesNotMatch(sql, /AS plus_assignable/, '旧的单一口径列不许回来');

  // 两个口径的差别**有且只有**新鲜度那一句 —— 别的条件必须一字不差，
  // 否则「库存」会悄悄比「能绑」宽出别的东西（比如漏掉退款风险或次数上限）。
  const min = minimumBalanceSql('plus');
  const strict = eligibleInventoryCardSql('c', min, { productCode: 'plus' });
  const loose = stockCountingCardSql('c', min, { productCode: 'plus' });
  assert.match(strict, /INTERVAL 15 MINUTE/);
  assert.doesNotMatch(loose, /INTERVAL 15 MINUTE/);
  // 两边各自精确替换掉新鲜度那一句。**不要写成一个通吃的正则**——
  // 第一版写 /\(c\.sync_tier = 'MANUAL_IMPORT' OR[\s\S]*?\)\)/ 在宽口径那侧
  // 一路吃到了 LEAST(...) 结尾的 `))`，把余额子句也吞了，比出来的"差异"全是假的。
  const STRICT_FRESH = /\(c\.sync_tier = 'MANUAL_IMPORT' OR \(\s*c\.last_transaction_synced_at IS NOT NULL\s+AND c\.last_transaction_synced_at >= DATE_SUB\(CURRENT_TIMESTAMP\(3\), INTERVAL 15 MINUTE\)\s*\)\)/;
  const LOOSE_FRESH = /\(c\.sync_tier = 'MANUAL_IMPORT' OR c\.last_transaction_synced_at IS NOT NULL\)/;
  assert.match(strict, STRICT_FRESH, '严口径里应当有 15 分钟那一句');
  assert.match(loose, LOOSE_FRESH, '宽口径里应当只剩「至少同步过一次」');
  const normalize = (x, re) => x.replace(re, '<FRESHNESS>').replace(/\s+/g, ' ');
  assert.equal(normalize(loose, LOOSE_FRESH), normalize(strict, STRICT_FRESH),
    '两个口径除了新鲜度那一句必须完全相同');

  // 三个数依次收紧：in_stock ≥ stock_available ≥ bindable_now
  assert.match(sql, /SUM\(c\.inventory_status <> 'RETIRED'\) AS in_stock/);
});

test('D-221: 每卡单数按产品 —— 按产品键优先、回落全局、再回落 3；Pro 用过的卡不再分给任何产品', () => {
  const plus = eligibleInventoryCardSql('c', '?', { productCode: 'plus' });
  const pro = eligibleInventoryCardSql('c', '?', { productCode: 'pro_20x' });
  assert.match(plus, /setting_key = 'card_max_successful_payments:plus'/, 'Plus 也先看按产品键（不存在时回落全局）');
  assert.match(pro, /setting_key = 'card_max_successful_payments:pro_20x'/);
  assert.match(pro, /setting_key = 'card_max_successful_payments' LIMIT 1\),\s*3\)/, '回落链：按产品 → 全局 → 3');
  assert.doesNotMatch(plus, /setting_key='card_max_successful_payments' LIMIT 1\), 3\)/, '旧的只读全局的写法不能残留');
  // 5X/20X 一卡一单：跑过 Pro 的卡不再进任何产品的可分配池（与待销 PRO_USED 同口径）
  for (const sql of [plus, pro]) assert.match(sql, /eligible_pro_product\.product_code LIKE 'chatgpt_pro%'/);
  assert.match(fundableInventoryCardSql('c'), /fundable_pro_product\.product_code LIKE 'chatgpt_pro%'/, '补余额资格同样排除');
  // 库存口径从资格生成，规则自动跟着走
  assert.match(stockCountingCardSql('c', '?', { productCode: 'pro_5x' }), /card_max_successful_payments:pro_5x/);
  assert.match(stockCountingCardSql('c', '?', { productCode: 'pro_5x' }), /LIKE 'chatgpt_pro%'/);
  // 订单抽屉按行取产品
  assert.match(maxPaymentsSql({ column: 'o.plan_type' }), /CONCAT\('card_max_successful_payments:', LOWER\(o\.plan_type\)\)/);
  assert.throws(() => maxPaymentsSql('bad plan!'), /Invalid product code/);
  assert.throws(() => maxPaymentsSql({ column: 'o.plan_type; DROP' }), /Invalid plan column/);
});

