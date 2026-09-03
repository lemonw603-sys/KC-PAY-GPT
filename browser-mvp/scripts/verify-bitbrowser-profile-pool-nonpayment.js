#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';

import { chromium } from 'playwright';

import { BitBrowserLocalApiClient } from '../src/bitbrowser-profile-runtime.js';

const OPERATIONAL_COOKIE_NAMES = new Set([
  '__cf_bm', '__cflb', '_cfuvid', 'cf_clearance', 'oai-did',
]);

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

async function loadProfileIds(path) {
  const info = await stat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('profile config must be a caller-owned 0600 regular file');
  }
  const line = (await readFile(path, 'utf8')).split(/\r?\n/)
    .find((candidate) => candidate.startsWith('BROWSER_BITBROWSER_PROFILE_IDS='));
  const ids = String(line || '').split('=', 2)[1]?.split(',').map((id) => id.trim()).filter(Boolean) || [];
  if (ids.length < 1 || ids.length > 6 || new Set(ids).size !== ids.length
    || ids.some((id) => !/^[a-zA-Z0-9_-]{8,128}$/.test(id))) {
    throw new Error('between one and six unique BitBrowser Profile IDs are required');
  }
  return ids;
}

function parseTrace(value) {
  const fields = Object.fromEntries(String(value || '').split('\n')
    .map((line) => line.split('=', 2)).filter((parts) => parts.length === 2));
  return { location: fields.loc || null, ipDigest: fields.ip ? digest(fields.ip) : null };
}

async function clearCustomerState(context) {
  const operationalCookies = (await context.cookies()).filter((cookie) => (
    OPERATIONAL_COOKIE_NAMES.has(cookie.name)
      && /(^|\.)(chatgpt|openai)\.com$/i.test(String(cookie.domain || '').replace(/^\./, ''))
  )).map((cookie) => Object.fromEntries(Object.entries({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  }).filter(([, value]) => value !== undefined)));
  await context.clearCookies({ domain: /(^|\.)(chatgpt|openai)\.com$/i });
  if (operationalCookies.length) await context.addCookies(operationalCookies);
  const anchor = context.pages()[0] || await context.newPage();
  const session = await context.newCDPSession(anchor);
  try {
    for (const origin of ['https://chatgpt.com', 'https://openai.com', 'https://auth.openai.com']) {
      await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    }
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function runtimeFingerprint(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 80;
    const canvasContext = canvas.getContext('2d');
    canvasContext.textBaseline = 'top';
    canvasContext.font = '18px Arial';
    canvasContext.fillStyle = '#f60';
    canvasContext.fillRect(3, 3, 120, 40);
    canvasContext.fillStyle = '#069';
    canvasContext.fillText('BitBrowser lane fingerprint 2026', 6, 9);
    canvasContext.strokeStyle = 'rgba(102, 204, 0, 0.7)';
    canvasContext.arc(210, 35, 28, 0, Math.PI * 2);
    canvasContext.stroke();

    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    let webgl = null;
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        extensions: gl.getSupportedExtensions(),
      };
    }

    const fontCandidates = [
      'Arial', 'Helvetica Neue', 'Times New Roman', 'Courier New', 'Menlo',
      'PingFang SC', 'Hiragino Sans', 'YuMincho', 'K2D', 'Sarabun', 'Mukta',
    ];
    const fonts = Object.fromEntries(fontCandidates.map((font) => [
      font,
      document.fonts?.check?.(`16px "${font}"`) === true,
    ]));

    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      language: navigator.language,
      languages: navigator.languages,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
      maxTouchPoints: navigator.maxTouchPoints,
      screen: [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.colorDepth, devicePixelRatio],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      plugins: [...navigator.plugins].map((plugin) => [plugin.name, plugin.filename]),
      canvas: canvas.toDataURL(),
      webgl,
      fonts,
    };
  });
}

async function verifyLane(runtime, index) {
  if (runtime.browser.contexts().length !== 1) throw new Error(`lane ${index + 1} exposed multiple BrowserContexts`);
  const context = runtime.browser.contexts()[0];
  await clearCustomerState(context);
  const page = await context.newPage();
  const response = await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const title = await page.title();
  if (response?.status() !== 200 || /just a moment|请稍候/i.test(title)) {
    throw new Error(`lane ${index + 1} did not reach ChatGPT normally`);
  }
  const marker = `lane-${index + 1}-${digest(runtime.profileId).slice(0, 10)}`;
  await context.addCookies([{
    name: 'codex_lane_isolation', value: marker, url: 'https://chatgpt.com/', secure: true, sameSite: 'Lax',
  }]);
  await page.evaluate((value) => localStorage.setItem('codex_lane_isolation', value), marker);
  const cookieMarkers = (await context.cookies('https://chatgpt.com/'))
    .filter((cookie) => cookie.name === 'codex_lane_isolation').map((cookie) => cookie.value);
  const storageMarker = await page.evaluate(() => localStorage.getItem('codex_lane_isolation'));
  if (cookieMarkers.length !== 1 || cookieMarkers[0] !== marker || storageMarker !== marker) {
    throw new Error(`lane ${index + 1} isolation marker mismatch`);
  }
  const fingerprint = await runtimeFingerprint(page);
  const traceText = await page.evaluate(async () => {
    const result = await fetch('/cdn-cgi/trace', { credentials: 'omit' });
    return result.ok ? result.text() : '';
  }).catch(() => '');
  return {
    chatgptHttpStatus: response.status(),
    fingerprintDigest: digest(JSON.stringify(fingerprint)),
    ...parseTrace(traceText),
  };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath?.startsWith('/')) {
    throw new Error('usage: verify-bitbrowser-profile-pool-nonpayment.js /absolute/0600-profile-config');
  }
  const ids = await loadProfileIds(configPath);
  const api = new BitBrowserLocalApiClient({ timeoutMs: 60_000 });
  const runtimes = [];
  const startedProfileIds = [];
  try {
    await api.health();
    // BitBrowser's local service can reject a burst of concurrent /browser/open
    // calls after starting only part of the pool. Start sequentially so every
    // successfully started profile is known and can be closed on any failure.
    for (const profileId of ids) {
      const item = { profileId, ...(await api.openProfile(profileId)) };
      startedProfileIds.push(profileId);
      const browser = await chromium.connectOverCDP(item.cdpEndpoint);
      runtimes.push({ ...item, browser });
    }
    const laneResults = await Promise.allSettled(runtimes.map(verifyLane));
    const failedLane = laneResults.find((result) => result.status === 'rejected');
    if (failedLane) throw failedLane.reason;
    const lanes = laneResults.map((result) => result.value);
    process.stdout.write(`${JSON.stringify({
      status: 'PROFILE_POOL_NONPAYMENT_VERIFIED',
      profileCount: lanes.length,
      chatgptHttp200Count: lanes.filter((lane) => lane.chatgptHttpStatus === 200).length,
      isolatedCookieCount: lanes.length,
      isolatedStorageCount: lanes.length,
      uniqueRuntimeFingerprintDigestCount: new Set(lanes.map((lane) => lane.fingerprintDigest)).size,
      exitLocationSet: [...new Set(lanes.map((lane) => lane.location).filter(Boolean))],
      uniqueExitDigestCount: new Set(lanes.map((lane) => lane.ipDigest).filter(Boolean)).size,
      sessionInjected: false,
      cardFieldsWritten: 0,
      submitCalls: 0,
    })}\n`);
  } finally {
    await Promise.all(runtimes.map(async ({ browser }) => {
      const context = browser.contexts()[0];
      if (context) await clearCustomerState(context).catch(() => undefined);
      await browser.close().catch(() => undefined);
    }));
    await Promise.all(startedProfileIds.map((id) => api.closeProfile(id).catch(() => undefined)));
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    status: 'FAILED_SAFE',
    errorCode: error?.code || error?.name || 'ERROR',
    message: String(error?.message || error),
    submitCalls: 0,
  })}\n`);
  process.exitCode = 1;
});
