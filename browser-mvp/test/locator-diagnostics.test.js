import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { describeCandidates } from '../src/locator-diagnostics.js';
import { fillTransientBillingEmail } from '../src/billing-address-fill.js';

// D-212：2026-09-13 这条断言抛了 8 次，每次只说"必须是一个"，查一整天说不出卡在哪——
// 而 matches.length 当时就在代码手里。消息必须自己把答案说出来。
test('D-212: two visible email fields name both of them in the error', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // 真实形态：结账页自己一个，另一个来自被嵌入的付款 iframe
    await page.setContent(`<form>
      <input name="email" type="email">
      <iframe srcdoc='<input autocomplete="email" name="linkEmail" value="someone@example.test">'></iframe>
    </form>`);
    await page.waitForTimeout(150);
    await assert.rejects(
      () => fillTransientBillingEmail(page, 'fixture@example.test', { timeoutMs: 1000 }),
      (error) => {
        assert.match(error.message, /找到 2 个/, `消息必须说出数量，实际: ${error.message}`);
        assert.match(error.message, /name=email/, '必须能认出结账页那个');
        assert.match(error.message, /name=linkEmail/, '必须能认出 iframe 里那个');
        return true;
      },
    );
  } finally { await browser.close(); }
});

// 诊断绝不能泄露值：邮箱/卡号/姓名都可能在 value 里，而这条消息会进日志和数据库。
test('D-212: diagnostics never leak the field value', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input name="email" type="email" value="secret-customer@example.test">');
    const locator = page.locator('input[name="email"]');
    const text = await describeCandidates([{ locator, frame: page.mainFrame() }]);
    assert.doesNotMatch(text, /secret-customer/, `值泄露了: ${text}`);
    assert.match(text, /已有值/, '应只说明有没有值');
  } finally { await browser.close(); }
});

// 诊断自己出错不能反过来弄坏流程。
test('D-212: a broken candidate degrades instead of throwing', async () => {
  const text = await describeCandidates([{ locator: { evaluate: async () => { throw new Error('detached'); } } }]);
  assert.match(text, /找到 1 个/);
  assert.match(text, /读不到/);
});
