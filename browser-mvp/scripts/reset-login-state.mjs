// Reset a resident identity's stale login state while keeping its session token
// and device/Cloudflare cookies: closes chatgpt.com tabs, removes every other
// chatgpt.com cookie, reloads, and reports whether the app renders logged in.
// Usage: BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/reset-login-state.mjs
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const PROFILE = process.env.BITBROWSER_PROFILE_ID; if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const SESSION = /^__Secure-(next-auth|authjs)\.session-token(\.\d+)?$/;
const KEEP = /^(cf_clearance|__cf_bm|_cfuvid|__cflb|__oailb|oai-did|__stripe_mid)$/;
const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const r = await fetch('http://127.0.0.1:54345/browser/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: PROFILE }) });
const j = await r.json(); if (!j.success) throw new Error(j.msg);
const browser = await chromium.connectOverCDP(`http://${j.data.http}`); const context = browser.contexts()[0];
const before = await context.cookies('https://chatgpt.com/');
const stale = [...new Set(before.filter((c) => !SESSION.test(c.name) && !KEEP.test(c.name)).map((c) => c.name))];
for (const p of context.pages()) if (p.url().includes('chatgpt.com')) await p.close();
for (const name of stale) await context.clearCookies({ name });
const page = await context.newPage();
await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(4000);
const who = await page.evaluate(async () => { const res = await fetch('/api/auth/session', { credentials: 'include' }); const s = await res.json().catch(() => ({})); return { status: res.status, email: s?.user?.email || null, hasToken: Boolean(s?.accessToken) }; });
const title = await page.title();
console.log(JSON.stringify({ sessionCookies: before.filter((c) => SESSION.test(c.name)).map((c) => c.name), cleared: stale, title, appLoaded: !/Chat, Work, Create/.test(title), sessionStatus: who.status, emailDigest: who.email ? digest(who.email) : null, hasToken: who.hasToken }));
await browser.close();
