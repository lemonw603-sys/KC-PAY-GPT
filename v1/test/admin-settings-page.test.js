// 设置页（第⑥步 B / D-290）。这些数真正决定「何时自动开卡、开多大金额、
// 钱够不够、卡够不够格分配」，所以断言集中在两件事上：
//   1) 白名单——列名不能参数化，字段一旦能被调用方指定，就是注入面；
//   2) 不知道的东西不许伪装成知道——读失败要说读失败，不能显示成「还没有配置」。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAdminJs } from './helpers/admin-dom-harness.js';
import { createCardSupplyPolicyAdminService } from '../src/services/card-supply-policy-admin-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakePool = () => ({ getConnection: async () => ({
  beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
  release() {}, query: async () => [[]]
}), query: async () => [[]] });

test('策略字段走白名单：非法字段名一律拒绝（列名不能参数化，这里是注入面）', async () => {
  const svc = createCardSupplyPolicyAdminService({ pool: fakePool() });
  for (const field of ['updated_by', 'provider_account_id', 'target_available; DROP TABLE cards', '']) {
    await assert.rejects(
      () => svc.setPolicyField({ providerAccountId: 'a', productCode: 'plus', field, value: 1 }),
      /未知的策略字段/, `字段 ${JSON.stringify(field)} 必须被拒`);
  }
});

test('钱包字段走白名单：只允许底线与告警线', async () => {
  const svc = createCardSupplyPolicyAdminService({ pool: fakePool() });
  for (const field of ['account_code', 'provider_code', 'supply_fault_state']) {
    await assert.rejects(() => svc.setWalletField({ providerAccountId: 'a', field, value: 1 }),
      /未知的钱包字段/, `字段 ${field} 必须被拒`);
  }
});

test('数值校验：负数 / 超范围 / 非整数 / 三位小数都拒', async () => {
  const svc = createCardSupplyPolicyAdminService({ pool: fakePool() });
  const bad = [
    ['target_available', -1], ['target_available', 101], ['target_available', 2.5],
    ['daily_open_limit', -1], ['daily_open_limit', 501],
    ['open_card_amount', -0.01], ['open_card_amount', 1000.01], ['open_card_amount', 1.005],
    ['open_card_amount', Number.NaN]
  ];
  for (const [field, value] of bad) {
    await assert.rejects(
      () => svc.setPolicyField({ providerAccountId: 'a', productCode: 'plus', field, value }),
      (error) => error.code === 'INVALID_SETTING_VALUE', `${field}=${value} 必须被拒`);
  }
});

test('actor 必须有且不超长——审计没有操作人就等于没有审计', async () => {
  const svc = createCardSupplyPolicyAdminService({ pool: fakePool() });
  for (const actorId of ['', '   ', 'x'.repeat(129)]) {
    await assert.rejects(
      () => svc.setPolicyField({ providerAccountId: 'a', productCode: 'plus', field: 'target_available', value: 1, actorId }),
      /Invalid settings actor/);
  }
});

test('真的没有策略时才说「还没有任何供给策略」（读失败的措辞在 loadSettings，界面验收覆盖）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderSettingsPolicies({ policies: [] });
  assert.match(html('sel:#settings-policies'), /还没有任何供给策略/, '真的空要说空');
  // loadSettings 读失败时走另一套措辞，不能和「空」混为一谈
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(src, /设置读取失败，先不要照这里的值做判断/);
});

test('每卡单数按产品三行可编辑（2026-09-24 落地 D-221），不再有「共用」缺口说明，且不把编号写到界面上', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderSettingsThresholds({
    wallets: [], minimumBalanceByPlan: { plus: '16.00' },
    maxSuccessfulPayments: '3', maxSuccessfulPaymentsByPlan: { plus: '3', pro_5x: '1', pro_20x: '1' }
  });
  const out = html('sel:#settings-thresholds');
  assert.doesNotMatch(out, /三个产品共用|还不能分开设/);
  assert.doesNotMatch(out, /\b[DF]-\d+\b/);
  const rows = out.match(/data-field="max_successful_payments"/g) || [];
  assert.equal(rows.length, 3, 'Plus / 5X / 20X 各一行');
  assert.match(out, /每卡单数 · Plus[\s\S]*value="3"/);
  assert.match(out, /每卡单数 · Pro 20X[\s\S]*value="1"/);
  assert.match(out, /data-save-capacity/);
  assert.match(out, /max="4"/);
});

test('最低余额按产品可改，且走既有端点 —— 不是「设置页漏做了」', () => {
  // 2026-09-20 我一度断言「设置页 D-290 漏做了最低余额」，并把它写成删块 2 的硬前置。
  // 错在只查了 card-supply-policy-admin-service 的 POLICY_FIELDS，而最低余额不走那个
  // service、走 /card-stock/minimum-balance。这条测试把「已存在」钉住，免得再误判一次。
  const { sandbox, html } = loadAdminJs();
  sandbox.renderSettingsThresholds({
    wallets: [], minimumBalanceByPlan: { plus: '16.00', pro_5x: '95.00', pro_20x: '150.00' },
    maxSuccessfulPayments: '3'
  });
  const out = html('sel:#settings-thresholds');
  for (const plan of ['plus', 'pro_5x', 'pro_20x']) {
    assert.match(out, new RegExp(`data-plan="${plan}"`), `${plan} 要有自己的一行`);
  }
  assert.match(out, /data-field="minimum_balance"/);
  assert.match(out, /data-save-minimum/);
  assert.match(out, /95\.00/);
});

test('设置页在 .workbench 作用域内，可以用 wb-* 同族样式（与 CDK 页的坑相反）', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  assert.match(html, /<section id="settings-view" class="view workbench"/);
  const css = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'workbench.css'), 'utf8');
  for (const cls of ['set-table', 'set-kv', 'set-f']) {
    assert.match(css, new RegExp(`\\.workbench \\.${cls}\\b`), `workbench.css 必须定义 .${cls}`);
  }
});
