// Read-only: list ChatGPT session cookies (name, domain, path, length, expiry) in a
// BitBrowser profile. Values are never printed.
// Usage: BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/list-session-cookies-readonly.mjs
import { chromium } from 'playwright';
const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const bit = async (path, body) => {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.success) throw new Error(`${path}: ${json.msg || 'failed'}`);
  return json.data;
};
const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
const context = browser.contexts()[0];
const cookies = (await context.cookies('https://chatgpt.com/'))
  .concat(await context.cookies('https://chat.openai.com/'))
  .filter((c) => /session-token/.test(c.name));
const seen = new Set();
for (const c of cookies) {
  const key = `${c.name}|${c.domain}|${c.path}`; if (seen.has(key)) continue; seen.add(key);
  console.log(JSON.stringify({ name: c.name, domain: c.domain, path: c.path, length: c.value.length, expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session', httpOnly: c.httpOnly, sameSite: c.sameSite }));
}
console.log(`tabs: ${context.pages().map((p) => p.url().replace(/\?.*$/, '')).join(' , ') || '(none)'}`);
await browser.close();
