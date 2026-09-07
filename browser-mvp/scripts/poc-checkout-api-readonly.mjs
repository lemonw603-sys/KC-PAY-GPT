#!/usr/bin/env node
// Read-only PoC (2026-09-07 baseline step 1): inside an already logged-in BitBrowser
// profile, call ChatGPT's own backend from the page context and answer two questions:
//   1. can the checkout be created by API from within the resident browser identity?
//   2. can a free account open a Pro (5x/20x) checkout directly, without buying Plus first?
// It never fills a card, never navigates to Stripe submit, never pays. Creating a checkout
// session is the only account-side side effect and it simply expires unused.
//
// Usage:
//   BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/poc-checkout-api-readonly.mjs [--observe]
//   --observe  also open each returned checkout URL in a new tab and read the visible price
//   POC_PLANS=plus,pro_5x,pro_20x  subset of plans to try (default all)
//              lines (subtotal / tax / total), then close that tab.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const EVIDENCE_DIR = fileURLToPath(new URL('../../artifacts/poc-checkout-api-20260907/', import.meta.url));

const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
const OBSERVE = process.argv.includes('--observe');
const COUNTRY = process.env.POC_COUNTRY || 'PH';
const CURRENCY = process.env.POC_CURRENCY || 'PHP';
const ALL_PLANS = { plus: 'chatgptplusplan', pro_5x: 'chatgptprolite', pro_20x: 'chatgptpro' };
// POC_PLANS=plus,pro_5x limits which checkouts are created (default: all three).
const PLANS = Object.fromEntries(Object.entries(ALL_PLANS).filter(([k]) => !process.env.POC_PLANS || process.env.POC_PLANS.split(',').includes(k)));
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }

const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
async function bit(path, body = {}) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j?.success !== true) throw new Error(`BitBrowser ${path} failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data;
}

const evidence = { startedAt: new Date().toISOString(), profileIdDigest: digest(PROFILE), country: COUNTRY, currency: CURRENCY, steps: [] };
const note = (step, data) => { evidence.steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`[${step}]`, JSON.stringify(data)); };

const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
try {
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().startsWith('https://chatgpt.com/'));
  if (!page) { page = await context.newPage(); await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 }); }
  note('page', { url: page.url().split('?')[0], title: await page.title() });

  // 1. identity + access token, from the page's own cookie session
  const session = await page.evaluate(async () => {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, hasToken: Boolean(j?.accessToken), email: j?.user?.email || null, expires: j?.expires || null };
  });
  note('session', { status: session.status, hasToken: session.hasToken, emailDigest: session.email ? digest(session.email) : null, expires: session.expires });
  if (!session.hasToken) throw new Error('profile is not logged in (no accessToken)');

  // 2. account plan state
  const account = await page.evaluate(async () => {
    const s = await (await fetch('/api/auth/session', { credentials: 'include' })).json();
    const r = await fetch('/backend-api/accounts/check/v4-2023-04-27', { headers: { Authorization: `Bearer ${s.accessToken}` } });
    const j = await r.json().catch(() => ({}));
    const acc = j?.accounts?.default?.account || j?.account || {};
    return { status: r.status, plan: acc.plan_type || j?.accounts?.default?.entitlement?.subscription_plan || null, hasActive: j?.accounts?.default?.entitlement?.has_active_subscription ?? null, keys: Object.keys(j || {}) };
  });
  note('account', account);

  // 3. checkout creation by API for each plan, inside the browser identity
  for (const [planType, planName] of Object.entries(PLANS)) {
    const result = await page.evaluate(async ({ planName, country, currency }) => {
      const s = await (await fetch('/api/auth/session', { credentials: 'include' })).json();
      const r = await fetch('/backend-api/payments/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ entry_point: 'all_plans_pricing_modal', plan_name: planName, billing_details: { country, currency }, checkout_ui_mode: 'custom' }),
      });
      const text = await r.text();
      let j = {}; try { j = JSON.parse(text); } catch {}
      const url = j?.url || j?.checkout_url || null;
      return { status: r.status, keys: Object.keys(j || {}), hasSessionId: Boolean(j?.checkout_session_id || j?.session_id || j?.id), url, detail: r.status === 200 ? null : String(j?.detail?.message || j?.detail || j?.message || text).slice(0, 300) };
    }, { planName, country: COUNTRY, currency: CURRENCY });
    const urlHost = result.url ? new URL(result.url).host : null;
    note(`checkout:${planType}`, { planName, status: result.status, keys: result.keys, hasSessionId: result.hasSessionId, urlHost, urlDigest: result.url ? digest(result.url) : null, detail: result.detail });

    if (OBSERVE && result.url) {
      const tab = await context.newPage();
      try {
        await tab.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await tab.waitForTimeout(6000);
        const lines = await tab.evaluate(() => Array.from(document.querySelectorAll('body *'))
          .map((e) => (e.childElementCount === 0 ? e.textContent.trim() : ''))
          .filter((t) => /(₱|PHP|\$|USD|Tax|VAT|Total|Subtotal|Due|month|Pro|Plus)/i.test(t) && t.length < 80)
          .slice(0, 40));
        note(`observe:${planType}`, { finalHost: new URL(tab.url()).host, title: await tab.title(), lines });
      } catch (error) {
        note(`observe:${planType}`, { error: String(error.message).slice(0, 200) });
      } finally { await tab.close().catch(() => {}); }
    }
  }
} finally {
  // detach only: leave the profile and its login visible for the operator
  await browser.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  const dir = `artifacts/poc-checkout-api-${evidence.startedAt.slice(0, 10).replace(/-/g, '')}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/result.json`, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${dir}/result.json`);
}
