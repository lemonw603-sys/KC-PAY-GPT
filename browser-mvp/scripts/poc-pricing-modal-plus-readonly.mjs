// Read-only page-flow probe: open ChatGPT's own pricing modal in a BitBrowser
// profile, click the Plus upgrade button once, and record what the page itself
// sends to backend-api/payments/checkout and what comes back. No card, no payment.
// Usage: BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/poc-pricing-modal-plus-readonly.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const EVIDENCE_DIR = fileURLToPath(new URL('../../artifacts/poc-checkout-api-20260907/', import.meta.url));
const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const bit = async (path, body) => { const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!j.success) throw new Error(`${path}: ${j.msg}`); return j.data; };
const evidence = { startedAt: new Date().toISOString(), profileIdDigest: digest(PROFILE), steps: [] };
const note = (step, data) => { evidence.steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`[${step}]`, JSON.stringify(data)); };
const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
try {
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const checkouts = [];
  const popups = [];
  context.on('page', (p) => popups.push(p));
  // Scalars and short lists only. checkout_state / billing_details carry the customer's email and address: never logged.
  const SAFE_RESPONSE_FIELDS = ['tag', 'checkout_ui_mode', 'automatic_tax_enabled', 'plan_name', 'requires_manual_approval', 'payment_method_collection', 'status', 'payment_status', 'checkout_provider', 'checkout_kind', 'entry_point', 'payment_method_types', 'selected_payment_method_type', 'reactivation_member_management', 'is_new_stripe_customer', 'one_click_trial_eligible', 'processor_entity'];
  const DRY = process.argv.includes('--dry');
  const SAFE_HEADER = /^(oai-|x-oai-|openai-|content-type$|accept$|accept-language$|origin$|referer$|sec-fetch)/i;
  const requests = [];
  if (DRY) {
    // Record the page's own request shape and abort it: no checkout is created.
    await context.route('**/backend-api/payments/checkout**', async (route) => {
      const req = route.request();
      const headers = await req.allHeaders();
      const shown = Object.fromEntries(Object.entries(headers).filter(([k]) => SAFE_HEADER.test(k)).map(([k, v]) => [k, /authorization|cookie/i.test(k) ? '<hidden>' : v.length > 120 ? `<${v.length} chars>` : v]));
      const hidden = Object.keys(headers).filter((k) => !SAFE_HEADER.test(k)).map((k) => `${k}:${headers[k].length}`);
      let body = null; try { body = req.postDataJSON(); } catch { body = req.postData() ? { unparsed: true, length: req.postData().length } : null; }
      requests.push({ method: req.method(), path: new URL(req.url()).pathname, query: new URL(req.url()).search || null, body, headersShown: shown, otherHeaders: hidden });
      await route.abort('failed');
    });
  }
  const onResponse = async (res) => {
    if (!res.url().includes('/backend-api/payments/checkout')) return;
    const req = res.request();
    const u = new URL(res.url());
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = { unparsed: true }; }
    let json = null; try { json = await res.json(); } catch { json = null; }
    const safe = json ? Object.fromEntries(SAFE_RESPONSE_FIELDS.filter((k) => k in json).map((k) => [k, json[k]])) : null;
    checkouts.push({ method: req.method(), path: u.pathname, query: u.search || null, requestBody: body, status: res.status(), responseKeys: json ? Object.keys(json) : null, detail: json?.detail ?? null, hasSessionId: Boolean(json?.checkout_session_id), hasUrl: Boolean(json?.url), urlHost: json?.url ? new URL(json.url).host : null, safe });
  };
  context.on('response', onResponse);
  await page.goto('https://chatgpt.com/#pricing', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  note('page', { url: page.url().split('?')[0].split('#')[0], title: await page.title() });
  const dialog = page.locator('[role="dialog"]').first();
  const dialogVisible = await dialog.isVisible().catch(() => false);
  note('pricing-modal', { visible: dialogVisible, text: dialogVisible ? (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 600) : null });
  if (!dialogVisible) throw new Error('pricing modal not visible');
  // Plus card: the upgrade button whose nearby text mentions Plus (and not Pro/Go/Business).
  const buttons = dialog.locator('button');
  const labels = [];
  for (let i = 0; i < await buttons.count(); i += 1) labels.push((await buttons.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim());
  note('buttons', { labels: labels.filter(Boolean).slice(0, 20) });
  const plusButton = dialog.locator('button', { hasText: /plus/i }).filter({ hasNotText: /pro|go|business|current/i }).first();
  if (!(await plusButton.count())) throw new Error('no Plus upgrade button found');
  note('click', { label: (await plusButton.innerText()).replace(/\s+/g, ' ').trim() });
  await plusButton.click();
  await page.waitForTimeout(8000);
  note('after-click', { url: page.url().split('?')[0], title: await page.title(), checkoutCalls: checkouts.length, popups: popups.map((p) => p.url().replace(/\?.*$/, '').replace(/#.*$/, '')) });
  const toast = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => []);
  note('alerts', { texts: toast.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6) });
  for (const c of checkouts) note('checkout', c);
  for (const r of requests) note('request-shape', r);
  // Visible text only: never scan <script>/<style>/<template>, which carry inline page data (tokens).
  const price = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .filter((e) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(e.tagName) && e.childElementCount === 0)
    .map((e) => e.innerText?.trim() || '').filter((t) => t && t.length < 120 && /₱|PHP|VAT|tax/i.test(t)).slice(0, 12));
  note('visible-price-lines', { lines: price });
} catch (error) {
  note('error', { message: String(error.message || error).slice(0, 300) });
} finally {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${EVIDENCE_DIR}pricing-modal-plus.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
