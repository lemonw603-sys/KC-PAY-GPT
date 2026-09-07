// Copy the ChatGPT session cookies from one BitBrowser profile to another, in
// memory only (values are never printed or written to disk), then verify the
// target profile resolves to the same account by comparing email digests.
// Usage: SOURCE_PROFILE_ID=<id> TARGET_PROFILE_ID=<id> node browser-mvp/scripts/copy-session-between-profiles.mjs
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const SOURCE = process.env.SOURCE_PROFILE_ID; const TARGET = process.env.TARGET_PROFILE_ID;
if (!SOURCE || !TARGET || SOURCE === TARGET) { console.error('SOURCE_PROFILE_ID and TARGET_PROFILE_ID (different) are required'); process.exit(2); }
const SESSION = /^__Secure-(next-auth|authjs)\.session-token(\.\d+)?$/;
// CLEAR_CLIENT_AUTH=1 also drops the previous login's client-auth state so the
// new session is not paired with another account's oai-client-auth-info.
// Cloudflare, device id, load-balancer and Stripe device cookies are kept.
const KEEP = /^(cf_clearance|__cf_bm|_cfuvid|__cflb|__oailb|oai-did|__stripe_mid)$/;
const CLEAR_CLIENT_AUTH = process.env.CLEAR_CLIENT_AUTH === '1';
const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const bit = async (path, body) => { const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!j.success) throw new Error(`${path}: ${j.msg}`); return j.data; };
const connect = async (id) => { const o = await bit('/browser/open', { id }); const b = await chromium.connectOverCDP(`http://${o.http}`); return { browser: b, context: b.contexts()[0] }; };
const whoami = async (context) => {
  const page = context.pages().find((p) => p.url().startsWith('https://chatgpt.com')) || await context.newPage();
  if (!page.url().startsWith('https://chatgpt.com')) await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const r = await page.evaluate(async () => { const res = await fetch('/api/auth/session', { credentials: 'include' }); const j = await res.json().catch(() => ({})); return { status: res.status, email: j?.user?.email || null, hasToken: Boolean(j?.accessToken) }; });
  return { status: r.status, emailDigest: r.email ? digest(r.email) : null, hasToken: r.hasToken, title: await page.title() };
};
const src = await connect(SOURCE);
const cookies = (await src.context.cookies('https://chatgpt.com/')).filter((c) => SESSION.test(c.name));
if (cookies.length === 0) { console.error('source profile has no session cookie'); process.exit(1); }
const sourceIdentity = await whoami(src.context);
console.log(JSON.stringify({ step: 'source', cookies: cookies.map((c) => c.name), ...sourceIdentity }));
await src.browser.close();
const dst = await connect(TARGET);
const before = (await dst.context.cookies('https://chatgpt.com/')).filter((c) => SESSION.test(c.name));
for (const p of dst.context.pages()) if (p.url().includes('chatgpt.com')) await p.close();
const stale = (await dst.context.cookies('https://chatgpt.com/')).filter((c) => !KEEP.test(c.name) && !SESSION.test(c.name)).map((c) => c.name);
await dst.context.clearCookies({ name: SESSION });
if (CLEAR_CLIENT_AUTH) for (const name of new Set(stale)) await dst.context.clearCookies({ name });
await dst.context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })));
const targetIdentity = await whoami(dst.context);
const sameAccount = targetIdentity.emailDigest === sourceIdentity.emailDigest;
const appLoaded = !/Chat, Work, Create/.test(targetIdentity.title);
console.log(JSON.stringify({ step: 'target', replaced: before.map((c) => c.name), clearedClientAuth: CLEAR_CLIENT_AUTH ? [...new Set(stale)] : [], ...targetIdentity, sameAccount, appLoaded }));
await dst.browser.close();
if (!sameAccount || !appLoaded) process.exit(1);
