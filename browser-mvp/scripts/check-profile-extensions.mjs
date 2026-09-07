#!/usr/bin/env node
// Read-only: open a BitBrowser profile (or reuse it if already open), connect over CDP,
// and list extension targets (MV3 service workers / background pages).
// NOTE: popup-only extensions such as the session loader have NO background target, so
// their absence here proves nothing. The authoritative check is the Chromium launch
// argument: `ps -axo command | grep <profileId> | tr ' ' '\n' | grep load-extension`
// must list BitBrowser's stored copy under BitExtensions/<uuid>.
//   BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/check-profile-extensions.mjs [--reopen]
import { chromium } from 'playwright';

const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
const REOPEN = process.argv.includes('--reopen');
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }

async function bit(path, body = {}) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j?.success !== true) throw new Error(`BitBrowser ${path} failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data;
}

if (REOPEN) { await bit('/browser/close', { id: PROFILE }).catch(() => {}); await new Promise((r) => setTimeout(r, 2500)); }
const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
try {
  // Chromium exposes extension targets on the browser-level CDP session.
  const session = await browser.newBrowserCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const ext = targetInfos.filter((t) => t.url.startsWith('chrome-extension://'));
  const ids = [...new Set(ext.map((t) => new URL(t.url).host))];
  console.log(JSON.stringify({ profileId: PROFILE, extensionTargets: ext.map((t) => ({ type: t.type, url: t.url, title: t.title })), extensionIds: ids }, null, 2));
  // Try to read each extension's manifest name via its service worker / page.
  for (const id of ids) {
    const page = await browser.contexts()[0].newPage();
    try {
      await page.goto(`chrome-extension://${id}/manifest.json`, { timeout: 8000 });
      const text = await page.evaluate(() => document.body.innerText);
      const m = JSON.parse(text);
      console.log(`extension ${id}: ${m.name} v${m.version}`);
    } catch (e) { console.log(`extension ${id}: manifest not readable (${String(e.message).slice(0, 80)})`); }
    finally { await page.close().catch(() => {}); }
  }
} finally {
  await browser.close().catch(() => {}); // detach only; profile stays open
}
