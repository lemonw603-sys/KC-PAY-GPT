import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dismissSavedPaymentMethod, STRIPE_LINK_SELECTORS } from '../src/stripe-link-picker.js';

function fakePage({ change = 0, newItem = 0, newItemAfterClick = null } = {}) {
  const clicks = [];
  let changeClicked = false;
  const locator = (selector) => ({
    async count() {
      if (selector === STRIPE_LINK_SELECTORS.CHANGE_BUTTON) return change;
      const n = changeClicked && newItemAfterClick !== null ? newItemAfterClick : newItem;
      return n;
    },
    nth() {
      return {
        async isVisible() { return true; },
        async click() {
          clicks.push(selector);
          if (selector === STRIPE_LINK_SELECTORS.CHANGE_BUTTON) changeClicked = true;
        },
      };
    },
  });
  return { clicks, frames: () => [{ locator }], async waitForTimeout() {} };
}

test('没有已保存的支付方式时什么都不做（绝大多数单走这条路）', async () => {
  const page = fakePage({ change: 0 });
  const r = await dismissSavedPaymentMethod(page, { timeoutMs: 300 });
  assert.deepEqual(r, { savedMethodDetected: false, switchedToNewMethod: false });
  assert.deepEqual(page.clicks, [], '不能有任何点击');
});

test('Link 接管时点「更改」再点「新的付款方式」（D-201）', async () => {
  // 2026-09-13：Link 占住「Pay with」，卡号/有效期/CVV 不渲染，连环 CHECKOUT_DRIFT。
  const page = fakePage({ change: 1, newItem: 0, newItemAfterClick: 1 });
  const r = await dismissSavedPaymentMethod(page, { timeoutMs: 600 });
  assert.deepEqual(r, { savedMethodDetected: true, switchedToNewMethod: true });
  assert.deepEqual(page.clicks, [STRIPE_LINK_SELECTORS.CHANGE_BUTTON, STRIPE_LINK_SELECTORS.NEW_METHOD_ITEM]);
});

test('展开了却没有「新的付款方式」就如实报告，不乱点别的', async () => {
  const page = fakePage({ change: 1, newItem: 0, newItemAfterClick: 0 });
  const r = await dismissSavedPaymentMethod(page, { timeoutMs: 300 });
  assert.deepEqual(r, { savedMethodDetected: true, switchedToNewMethod: false });
  assert.deepEqual(page.clicks, [STRIPE_LINK_SELECTORS.CHANGE_BUTTON], '只点了「更改」，没有乱点');
});

test('选择器用 Stripe 的 class 而非文案——页面可能是任何语言', () => {
  // 当天页面是菲律宾语（p-Locale-fil，Stripe 按菲律宾出口 IP 定的），
  // 按钮写着 Palitan / Bagong paraan ng pagbabayad，靠文案匹配必然失效。
  for (const sel of Object.values(STRIPE_LINK_SELECTORS)) {
    assert.match(sel, /p-(PickerAction|PickerItem--new)/);
    assert.doesNotMatch(sel, /text=|has-text|Palitan|Change|New payment/i);
  }
});

test('绝不点「移除」——那会删掉客户自己的支付方式', async () => {
  // 只看代码，不看注释：注释里**说明**了为什么不点 Alisin，那是好事，不该因此失败。
  const source = readFileSync(new URL('../src/stripe-link-picker.js', import.meta.url), 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/^\s*\/\/.*$/gm, '');        // 行注释
  assert.doesNotMatch(code, /p-MenuAction--danger/, '移除按钮的选择器不得进入代码');
  assert.doesNotMatch(code, /Alisin|Remove|移除/i, '代码里不得出现移除相关的目标');
  // 代码里只允许点这两个：更改、新的付款方式。
  const clicked = code.match(/(\w+)\.click\(/g) || [];
  assert.equal(clicked.length, 2, `只应有两处点击，实际 ${clicked.length}`);
});
