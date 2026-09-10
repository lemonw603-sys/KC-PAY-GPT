// Release a resident lane's login: drop the ChatGPT session token and the
// login-state cookies, keep device/Cloudflare cookies (session-bootstrap.clearSession).
// Needed before a rehearsal or real order whose account is the SAME one the lane
// already holds: the executor preserves a matching resident session and would
// skip its own injection, so the injection path would go unverified.
// Usage: BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/clear-lane-session.mjs
import { chromium } from 'playwright';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';

const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const res = await fetch(API + '/browser/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: PROFILE }) });
const json = await res.json();
if (!json.success) throw new Error('browser/open failed: ' + (json.msg || ''));
const browser = await chromium.connectOverCDP('http://' + json.data.http);
try {
  const context = browser.contexts()[0];
  // Close chatgpt.com tabs first so no live page writes a rotated token back.
  let closedTabs = 0;
  for (const page of context.pages()) if (page.url().startsWith('https://chatgpt.com')) { await page.close().catch(() => undefined); closedTabs += 1; }
  const adapter = new CookieSessionBootstrapAdapter({ source: { load: async () => { throw new Error('not used'); } } });
  const cleared = await adapter.clearSession(context);
  const remaining = (await context.cookies('https://chatgpt.com/')).map((c) => c.name);
  console.log(JSON.stringify({ profile: PROFILE, closedTabs, ...cleared, remainingCookies: remaining, remainingSession: remaining.filter((n) => /session-token/.test(n)) }));
} finally {
  await browser.close().catch(() => undefined);
}
