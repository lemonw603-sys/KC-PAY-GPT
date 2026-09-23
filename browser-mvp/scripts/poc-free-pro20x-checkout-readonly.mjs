// 块 6 前置（D-245 / D-359 后）：只读 PoC —— 一个**从未付费**的 ChatGPT 账号能否从定价弹窗直接选
// Pro 20x 进入 Checkout。停在 Checkout 页，不填卡、不点 Pay，只记录页面结构与页面自己发的
// checkout 接口的安全字段。隔离赛道：不改 src，不碰付款链路（D-254）。
//
//   BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/poc-free-pro20x-checkout-readonly.mjs [pro_20x|pro_5x] [--keep-open]
//   --keep-open  结束后不关 Checkout 标签（默认关掉，避免留一个可付款的页面）
//
// 前提：该 Profile 已由 Lemon 手动登录一个 Free 账号（Session 不经过本仓库）；菲律宾出口在线。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, navigateToChatGPTCheckout } from '../src/chatgpt-checkout-navigator.js';
import { checkSessionHealth } from '../src/post-payment-session-recovery.js';

for (const key of ['BROWSER_PAYMENT_WRITES_ENABLED', 'BROWSER_PAYMENT_EXECUTOR_ENABLED', 'PROVIDER_WRITES_ENABLED']) {
  if (String(process.env[key] || 'false').toLowerCase() === 'true') { console.error(`${key} must not be true for a read-only PoC`); process.exit(2); }
}
const EVIDENCE_DIR = fileURLToPath(new URL('../../artifacts/poc-free-pro20x-20260924/', import.meta.url));
const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const args = process.argv.slice(2);
const plan = args.find((v) => /^pro_(5x|20x)$/.test(v)) || 'pro_20x';
const KEEP_OPEN = args.includes('--keep-open');
const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const bit = async (path, body) => {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.success) throw new Error(`BitBrowser ${path} failed: ${JSON.stringify(j).slice(0, 200)}`); return j.data;
};
const evidence = { startedAt: new Date().toISOString(), profileIdDigest: digest(PROFILE), plan, steps: [] };
const note = (step, data) => { evidence.steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`[${step}]`, JSON.stringify(data)); };
// 页面自己调的 checkout 接口：只留标量安全字段。checkout_state / billing_details 带客户邮箱与地址，永不记录。
const SAFE_RESPONSE_FIELDS = ['tag', 'checkout_ui_mode', 'automatic_tax_enabled', 'plan_name', 'requires_manual_approval', 'payment_method_collection', 'status', 'payment_status', 'checkout_provider', 'currency', 'amount_total', 'amount_subtotal', 'total_details'];
const AMOUNT = /(?:₱|PHP|\$|USD)\s?[\d,]+(?:\.\d{2})?|VAT|tax|税/i;

const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
let checkoutPage = null;
try {
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const checkouts = [];
  context.on('response', async (res) => {
    if (!res.url().includes('/backend-api/payments/checkout')) return;
    let json = null; try { json = await res.json(); } catch { json = null; }
    const safe = json ? Object.fromEntries(SAFE_RESPONSE_FIELDS.filter((k) => k in json).map((k) => [k, json[k]])) : null;
    let body = null; try { body = res.request().postDataJSON(); } catch { body = null; }
    // 请求体里只留套餐/价格标识类字段
    const bodySafe = body && typeof body === 'object' ? Object.fromEntries(Object.entries(body).filter(([k]) => /plan|price|tier|product|interval|currency|country/i.test(k))) : null;
    checkouts.push({ method: res.request().method(), path: new URL(res.url()).pathname, status: res.status(), requestBodySafe: bodySafe, responseKeys: json ? Object.keys(json).slice(0, 30) : null, safe, detail: json?.detail ?? null });
  });
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  note('page', { url: page.url().split('?')[0].split('#')[0], title: await page.title() });
  const health = await checkSessionHealth(page);
  note('session', health);
  if (health?.ok !== true) throw new Error('profile is not logged in; Lemon must sign in a Free account first');

  // 先看定价弹窗本身：Pro 卡片上有没有 5x/20x 档位切换（旧观察 D-133/D-136 说没有）
  await page.goto('https://chatgpt.com/#pricing', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const dialog = page.locator('[role="dialog"]').first();
  const dialogVisible = await dialog.isVisible().catch(() => false);
  const labels = dialogVisible ? (await dialog.locator('button:visible').allInnerTexts().catch(() => [])).map(clean).filter(Boolean) : [];
  note('pricing-modal', { visible: dialogVisible, buttonLabels: labels.slice(0, 24), tierToggle: labels.filter((l) => /^(5x|20x)$/i.test(l)), proUpgradeLabels: labels.filter((l) => /pro/i.test(l) && /upgrade|升级|rejoin|重新/i.test(l)), currentPlanMarker: labels.filter((l) => /current|当前/i.test(l)) });
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2000);

  // 走执行器同一份导航合同：plan-change 模式对免费账号的停点是「Checkout（同页或新标签）」，对已付费账号是「Confirm plan changes」弹窗
  const result = await navigateToChatGPTCheckout(page, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, { plan, expect: 'plan-change', timeoutMs: 45_000 });
  note('navigation', { state: result.state, actions: result.actions, checkoutCreated: result.checkoutCreated, planChange: result.planChange ?? null, checkoutInsteadOfDialog: result.checkoutInsteadOfDialog ?? null });
  if (result.state === 'plan-change') throw new Error('account already subscribes (plan-change dialog); this PoC needs a Free account');

  checkoutPage = result.state === 'checkout-popup'
    ? context.pages().find((p) => p.url().startsWith(CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT.checkoutUrlPrefix)) || page
    : page;
  await checkoutPage.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
  await checkoutPage.waitForTimeout(6000);
  const url = new URL(checkoutPage.url());
  const readySelector = CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT.checkoutReadySelector;
  const buttonLabels = (await checkoutPage.locator('button:visible').allInnerTexts().catch(() => [])).map(clean).filter(Boolean);
  // 只扫可见叶子文本，不扫 script/style（里面有内联页面数据）
  const lines = await checkoutPage.evaluate((pattern) => {
    const re = new RegExp(pattern, 'i');
    return Array.from(document.querySelectorAll('body *'))
      .filter((e) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(e.tagName) && e.childElementCount === 0)
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 140 && re.test(t)).slice(0, 20);
  }, AMOUNT.source);
  const planLines = await checkoutPage.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .filter((e) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(e.tagName) && e.childElementCount === 0)
    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 100 && /pro|plus|20x|5x/i.test(t)).slice(0, 12));
  const fields = await checkoutPage.evaluate(() => Array.from(document.querySelectorAll('input:not([type=hidden]), select'))
    .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type || null, name: e.name || null, id: e.id || null, autocomplete: e.autocomplete || null, placeholder: e.placeholder || null })).slice(0, 30));
  const iframes = await checkoutPage.evaluate(() => Array.from(document.querySelectorAll('iframe')).map((f) => { try { return new URL(f.src).origin; } catch { return f.src ? 'opaque' : 'no-src'; } }).slice(0, 10));
  note('checkout-page', {
    origin: url.origin, pathPrefix: url.pathname.split('/').slice(0, 3).join('/'), urlDigest: digest(checkoutPage.url()),
    title: await checkoutPage.title(),
    readySelectorPresent: (await checkoutPage.locator(readySelector).count()) > 0,
    planLines, amountLines: lines, buttonLabels: buttonLabels.slice(0, 24),
    payButtonPresent: buttonLabels.some((l) => /^(pay now|立即支付|立即付款|subscribe|订阅|立即订阅)$/i.test(l)),
    fields, iframeOrigins: iframes,
  });
  for (const c of checkouts) note('checkout-api', c);
  note('done', { fieldsWritten: 0, submitCalls: 0, keepOpen: KEEP_OPEN });
} catch (error) {
  note('error', { code: error?.code || null, message: String(error?.message || error).slice(0, 300) });
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = `${EVIDENCE_DIR}free-${plan}-${evidence.startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(`evidence: ${file}`);
  if (!KEEP_OPEN && checkoutPage) await checkoutPage.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
