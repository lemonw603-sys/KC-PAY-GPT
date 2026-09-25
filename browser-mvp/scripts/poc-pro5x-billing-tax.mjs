// 块 6（D-371 后，Lemon 2026-09-25「2 A」）：5x 结账页只填账单地址，看税是否变成 0。
// 不填卡、不填邮箱、不点 Subscribe；只写 6 个地址字段（与生产同一个 fillBillingAddress、同一份免税州地址源）。
// 证据只记金额与页面结构，不记地址、邮箱、账号。结束默认关掉 Checkout 标签。
//
//   BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/poc-pro5x-billing-tax.mjs [--keep-open]
//
// 前提：该 Profile 已登录一个 Free 账号（Session 不经过本仓库）；菲律宾出口在线；没有别的程序在用这个窗口。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BILLING_ADDRESS_SELECTORS, fillBillingAddress } from '../src/billing-address-fill.js';
import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, navigateToChatGPTCheckout } from '../src/chatgpt-checkout-navigator.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT, observeCheckout } from '../src/checkout-observer.js';
import { MockAddressBillingAddressSource } from '../src/mockaddress-billing-address-source.js';
import { checkSessionHealth } from '../src/post-payment-session-recovery.js';

for (const key of ['BROWSER_PAYMENT_WRITES_ENABLED', 'BROWSER_PAYMENT_EXECUTOR_ENABLED', 'PROVIDER_WRITES_ENABLED']) {
  if (String(process.env[key] || 'false').toLowerCase() === 'true') { console.error(`${key} must not be true for this PoC`); process.exit(2); }
}
const EVIDENCE_DIR = fileURLToPath(new URL('../../artifacts/poc-pro5x-billing-tax/', import.meta.url));
const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const KEEP_OPEN = process.argv.includes('--keep-open');
const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const bit = async (path, body) => {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.success) throw new Error(`BitBrowser ${path} failed: ${JSON.stringify(j).slice(0, 200)}`); return j.data;
};
const evidence = { startedAt: new Date().toISOString(), profileIdDigest: digest(PROFILE), plan: 'pro_5x', steps: [] };
const note = (step, data) => { evidence.steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`[${step}]`, JSON.stringify(data)); };
// 报价只留金额类字段；observeCheckout 不返回地址。不做零税断言：这里是观察，不是判定。
const quoteOf = (observed) => ({ currency: observed?.currency ?? null, amountDue: observed?.amount ?? null, estimatedTax: observed?.estimatedTax ?? null });
// 页面上的金额叶子文本（小计/VAT/合计），同 D-369 PoC 的扫法；不扫 script/style。
const amountLines = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="checkout-summary-column"] *'))
  .filter((e) => e.childElementCount === 0).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
  .filter((t) => t && t.length < 80 && /₱|PHP|\$|VAT|tax|税|subtotal|total|due/i.test(t)).slice(0, 20));
const observe = (page) => observeCheckout(page, { ...CHATGPT_PLUS_CHECKOUT_CONTRACT, requireZeroTax: false, requireQuoteConsistency: false });

const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
let checkoutPage = null;
let fieldsWritten = 0;
const checkouts = [];
let ownPage = null;
try {
  const context = browser.contexts()[0];
  const page = await context.newPage();
  ownPage = page;
  // 页面自己调的 checkout 接口：只留套餐/金额类标量（同 D-369 PoC）；地址、邮箱永不记录。
  context.on('response', async (res) => {
    if (!res.url().includes('/backend-api/payments/checkout')) return;
    let json = null; try { json = await res.json(); } catch { json = null; }
    const keep = ['plan_name', 'status', 'payment_status', 'automatic_tax_enabled', 'currency', 'amount_total', 'amount_subtotal', 'total_details'];
    checkouts.push({ method: res.request().method(), status: res.status(), safe: json ? Object.fromEntries(keep.filter((k) => k in json).map((k) => [k, json[k]])) : null });
  });
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  // 页头上导航会先点的入口按钮（openPricingSelectors）现在显示什么
  const headerEntries = [];
  for (const selector of CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT.openPricingSelectors) {
    const texts = await page.locator(selector).filter({ visible: true }).allInnerTexts().catch(() => []);
    if (texts.length) headerEntries.push({ selector, texts: texts.map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 3) });
  }
  note('header-entries', { headerEntries });
  const health = await checkSessionHealth(page);
  note('session', { ok: health?.ok === true });
  if (health?.ok !== true) throw new Error('profile is not logged in');

  const result = await navigateToChatGPTCheckout(page, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, { plan: 'pro_5x', expect: 'plan-change', timeoutMs: 45_000 });
  note('navigation', { state: result.state, actions: result.actions, checkoutCreated: result.checkoutCreated });
  if (result.state === 'plan-change') throw new Error('account already subscribes (plan-change dialog); needs a Free account');
  checkoutPage = result.state === 'checkout-popup'
    ? context.pages().find((p) => p.url().startsWith(CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT.checkoutUrlPrefix)) || page
    : page;
  await checkoutPage.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
  await checkoutPage.locator('[data-testid="checkout-summary-column"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await checkoutPage.waitForTimeout(5000);
  const planLines = await checkoutPage.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .filter((e) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(e.tagName) && e.childElementCount === 0)
    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 100 && /pro|plus|20x|5x/i.test(t)).slice(0, 12));
  note('checkout-plan', { planLines, checkoutApi: checkouts });

  const before = await observe(checkoutPage);
  note('quote-before-address', { ...quoteOf(before), lines: await amountLines(checkoutPage), urlDigest: digest(checkoutPage.url()) });

  const address = await new MockAddressBillingAddressSource({ state: 'DE', name: 'Browser Billing' }).load('poc-pro5x-billing-tax');
  // Stripe 的地址框会在挂载期重载（两次实测 'Frame was detached' / 'Target ... closed'）。填写可重复：有界重试 3 次。
  let filled = null;
  for (let attempt = 1; attempt <= 3 && !filled; attempt += 1) {
    try { filled = await fillBillingAddress(checkoutPage, address, { timeoutMs: 15_000 }); } catch (error) {
      if (attempt === 3 || !/detached|has been closed/i.test(String(error?.message))) throw error;
      note('address-retry', { attempt, message: String(error.message).slice(0, 120) });
      await checkoutPage.waitForTimeout(2000);
    }
  }
  fieldsWritten = filled.fieldsFilled;
  note('address-filled', { fieldsFilled: filled.fieldsFilled, state: 'DE', paymentClicked: false, submitCalls: 0 });

  // 税费重算是异步的：每 2 秒读一次，最多 30 秒，记下每次读数（不在这里判定）。
  const reads = [];
  for (let i = 0; i < 15; i += 1) {
    await checkoutPage.waitForTimeout(2000);
    const q = quoteOf(await observe(checkoutPage));
    reads.push(q);
    if (reads.length >= 2 && JSON.stringify(reads.at(-1)) === JSON.stringify(reads.at(-2)) && JSON.stringify(q) !== JSON.stringify(quoteOf(before))) break;
  }
  note('quote-after-address', { last: reads.at(-1), lines: await amountLines(checkoutPage), readCount: reads.length, distinct: [...new Set(reads.map((r) => JSON.stringify(r)))].map((s) => JSON.parse(s)) });
  note('done', { fieldsWritten, cardFieldsWritten: 0, emailWritten: false, submitCalls: 0, keepOpen: KEEP_OPEN });
} catch (error) {
  // 出错时也记下：页面自己建了哪个套餐的结账、哪些标签停在结账页（只记套餐文字与摘要，不记地址）
  const context = browser.contexts()[0];
  const onCheckout = [];
  for (const p of context?.pages() || []) {
    if (!p.url().startsWith('https://chatgpt.com/checkout')) continue;
    const planLines = await p.evaluate(() => Array.from(document.querySelectorAll('body *'))
      .filter((e) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(e.tagName) && e.childElementCount === 0)
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 100 && /pro|plus|20x|5x|₱/i.test(t)).slice(0, 12)).catch(() => null);
    onCheckout.push({ own: p === ownPage, urlDigest: digest(p.url()), planLines });
  }
  // 地址表单在哪个框里、可不可见（只记来源域名与计数）
  const addressFrames = [];
  for (const frame of (checkoutPage || ownPage)?.frames() || []) {
    const row = { origin: (() => { try { return new URL(frame.url()).origin; } catch { return 'opaque'; } })() };
    for (const [key, selector] of Object.entries(BILLING_ADDRESS_SELECTORS)) {
      const loc = frame.locator(selector);
      const total = await loc.count().catch(() => -1);
      let visible = 0; for (let i = 0; i < total; i += 1) if (await loc.nth(i).isVisible().catch(() => false)) visible += 1;
      if (total > 0) row[key] = `${visible}/${total}`;
    }
    const card = await frame.locator('input[autocomplete="cc-number"]').count().catch(() => -1);
    if (card > 0) row.cardNumber = card;
    if (Object.keys(row).length > 1) addressFrames.push(row);
  }
  note('error', { code: error?.code || null, message: String(error?.message || error).slice(0, 300), fieldsWritten, checkoutApi: checkouts, onCheckout, addressFrames, frameCount: ((checkoutPage || ownPage)?.frames() || []).length });
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = `${EVIDENCE_DIR}pro_5x-${evidence.startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(`evidence: ${file}`);
  // 只关本脚本开的标签（含它弹出的结账页）；窗口里原有的标签不动。
  if (!KEEP_OPEN) for (const p of new Set([checkoutPage, ownPage].filter(Boolean))) await p.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
