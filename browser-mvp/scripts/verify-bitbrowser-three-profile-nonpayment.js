#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';

import { chromium } from 'playwright';

import { BitBrowserLocalApiClient } from '../src/bitbrowser-profile-runtime.js';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

async function loadProfileIds(path) {
  const info = await stat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('profile config must be a caller-owned 0600 regular file');
  }
  const line = (await readFile(path, 'utf8')).split(/\r?\n/)
    .find((candidate) => candidate.startsWith('BROWSER_BITBROWSER_PROFILE_IDS='));
  const ids = String(line || '').split('=', 2)[1]?.split(',').map((id) => id.trim()).filter(Boolean) || [];
  if (ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => !/^[a-zA-Z0-9_-]{8,128}$/.test(id))) {
    throw new Error('exactly three unique BitBrowser Profile IDs are required');
  }
  return ids;
}

function parseTrace(value) {
  const fields = Object.fromEntries(String(value || '').split('\n').map((line) => line.split('=', 2)).filter((parts) => parts.length === 2));
  return { location: fields.loc || null, ipDigest: fields.ip ? digest(fields.ip) : null };
}

async function clearLane(context) {
  const keepNames = new Set(['__cf_bm', '__cflb', '_cfuvid', 'cf_clearance', 'oai-did']);
  const operationalCookies = (await context.cookies()).filter((cookie) => keepNames.has(cookie.name)
    && /(^|\.)(chatgpt|openai)\.com$/i.test(String(cookie.domain || '').replace(/^\./, '')))
    .map((cookie) => Object.fromEntries(Object.entries({
      name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || '/',
      expires: cookie.expires, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite,
    }).filter(([, value]) => value !== undefined)));
  await context.clearCookies({ domain: /(^|\.)(chatgpt|openai)\.com$/i });
  if (operationalCookies.length) await context.addCookies(operationalCookies);
  const anchor = context.pages()[0] || await context.newPage();
  const session = await context.newCDPSession(anchor);
  try {
    await session.send('Storage.clearDataForOrigin', { origin: 'https://chatgpt.com', storageTypes: 'all' });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function verifyLane(runtime, index) {
  if (runtime.browser.contexts().length !== 1) throw new Error(`lane ${index + 1} exposed multiple BrowserContexts`);
  const context = runtime.browser.contexts()[0];
  await clearLane(context);
  const page = await context.newPage();
  const response = await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const title = await page.title();
  if (response?.status() !== 200 || /just a moment|请稍候/i.test(title)) throw new Error(`lane ${index + 1} did not reach ChatGPT normally`);
  const marker = `lane-${index + 1}-${digest(runtime.profileId).slice(0, 10)}`;
  await context.addCookies([{ name: 'codex_lane_isolation', value: marker, url: 'https://chatgpt.com/', secure: true, sameSite: 'Lax' }]);
  await page.evaluate((value) => localStorage.setItem('codex_lane_isolation', value), marker);
  const cookies = await context.cookies('https://chatgpt.com/');
  const cookieMarkers = cookies.filter((cookie) => cookie.name === 'codex_lane_isolation').map((cookie) => cookie.value);
  const storageMarker = await page.evaluate(() => localStorage.getItem('codex_lane_isolation'));
  if (cookieMarkers.length !== 1 || cookieMarkers[0] !== marker || storageMarker !== marker) {
    throw new Error(`lane ${index + 1} isolation marker mismatch`);
  }
  const fingerprint = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
    screen: [screen.width, screen.height, screen.colorDepth],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  const traceText = await page.evaluate(async () => {
    const result = await fetch('/cdn-cgi/trace', { credentials: 'omit' });
    return result.ok ? result.text() : '';
  }).catch(() => '');
  return {
    contextCount: 1,
    chatgptHttpStatus: response.status(),
    challengeAbsent: true,
    cookieIsolation: true,
    storageIsolation: true,
    fingerprintDigest: digest(JSON.stringify(fingerprint)),
    ...parseTrace(traceText),
  };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath?.startsWith('/')) throw new Error('usage: verify-bitbrowser-three-profile-nonpayment.js /absolute/0600-profile-config');
  const ids = await loadProfileIds(configPath);
  const api = new BitBrowserLocalApiClient({ timeoutMs: 60_000 });
  const runtimes = [];
  try {
    await api.health();
    const opened = await Promise.all(ids.map(async (profileId) => ({
      profileId,
      ...(await api.openProfile(profileId)),
    })));
    for (const item of opened) {
      const browser = await chromium.connectOverCDP(item.cdpEndpoint);
      runtimes.push({ ...item, browser });
    }
    const lanes = await Promise.all(runtimes.map(verifyLane));
    const locations = [...new Set(lanes.map((lane) => lane.location).filter(Boolean))];
    const exits = [...new Set(lanes.map((lane) => lane.ipDigest).filter(Boolean))];
    const fingerprintCount = new Set(lanes.map((lane) => lane.fingerprintDigest)).size;
    process.stdout.write(`${JSON.stringify({
      status: 'THREE_PROFILE_NONPAYMENT_VERIFIED',
      profileCount: lanes.length,
      chatgptHttp200Count: lanes.filter((lane) => lane.chatgptHttpStatus === 200).length,
      isolatedCookieCount: lanes.filter((lane) => lane.cookieIsolation).length,
      isolatedStorageCount: lanes.filter((lane) => lane.storageIsolation).length,
      uniqueFingerprintDigestCount: fingerprintCount,
      exitLocationSet: locations,
      uniqueExitDigestCount: exits.length,
      sessionInjected: false,
      cardFieldsWritten: 0,
      submitCalls: 0,
    })}\n`);
  } finally {
    await Promise.all(runtimes.map(async ({ browser }) => {
      const context = browser.contexts()[0];
      if (context) await clearLane(context).catch(() => undefined);
      await browser.close().catch(() => undefined);
    }));
    await Promise.all(ids.map((id) => api.closeProfile(id).catch(() => undefined)));
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ status: 'FAILED_SAFE', errorCode: error?.code || error?.name || 'ERROR', message: String(error?.message || error), submitCalls: 0 })}\n`);
  process.exitCode = 1;
});
