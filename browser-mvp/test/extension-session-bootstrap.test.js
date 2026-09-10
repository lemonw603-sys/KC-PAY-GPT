import test from 'node:test';
import assert from 'node:assert/strict';

import { ContractError } from '../src/contracts.js';
import { ExtensionSessionBootstrapAdapter, DEFAULT_EXTENSION_PATH } from '../src/extension-session-bootstrap.js';
import { extensionIdFromPath } from '../src/extension-session-runtime.js';

const EXTENSION_ID = extensionIdFromPath(DEFAULT_EXTENSION_PATH);

function fakeLocator(overrides = {}) {
  return {
    count: async () => 1,
    fill: async () => undefined,
    click: async () => undefined,
    waitFor: async () => undefined,
    getAttribute: async () => null,
    textContent: async () => '',
    ...overrides,
  };
}

// Minimal stand-in for the extension popup page plus the resident BrowserContext
// it opens from. `locators` maps a CSS-ish selector string (as passed to
// popup.locator(...)) to a fakeLocator() so each test only overrides the calls
// it cares about.
function fakeContext({ existingCookies = [], locators = {}, popupClosesOnClick = true, newPageAfterClick = 'https://chatgpt.com/' } = {}) {
  const cleared = [];
  let popupClosed = false;
  const popupPage = {
    goto: async (url) => { popupPage.lastUrl = url; },
    locator: (selector) => locators[selector] || fakeLocator(),
    isClosed: () => popupClosed,
    close: async () => { popupClosed = true; },
  };
  // wrap the token/login locators so click() can flip popupClosed, matching the
  // real popup.js calling window.close() itself on success.
  const tokenField = locators['#sessionToken'] || fakeLocator();
  const loginButton = locators['#loginButton'] || fakeLocator({
    click: async () => { if (popupClosesOnClick) popupClosed = true; },
  });
  popupPage.locator = (selector) => {
    if (selector === '#sessionToken') return tokenField;
    if (selector === '#loginButton') return loginButton;
    return locators[selector] || fakeLocator();
  };
  const context = {
    cookies: async () => existingCookies,
    clearCookies: async (filter) => cleared.push(filter),
    newPage: async () => popupPage,
    waitForEvent: async () => (newPageAfterClick ? { url: () => newPageAfterClick } : null),
  };
  return { context, popupPage, cleared, isPopupClosed: () => popupClosed };
}

test('ExtensionSessionBootstrapAdapter preserves an existing active Profile session without opening the popup', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'token-value' }) }, clock: () => 10_000 });
  const lease = await adapter.open('session-ref:fixture', { ttlMs: 5_000 });
  let popupOpened = false;
  const { context } = fakeContext({
    existingCookies: [{ name: '__Secure-next-auth.session-token', domain: '.chatgpt.com', path: '/' }],
  });
  context.newPage = async () => { popupOpened = true; throw new Error('should not be called'); };
  const result = await adapter.bootstrap(lease, context);
  assert.equal(result.existingSessionPreserved, true);
  assert.equal(result.cookieCount, 1);
  assert.equal(result.replacedCookieCount, 0);
  assert.equal(popupOpened, false, 'the popup must not be touched when the resident session is preserved');
});

test('ExtensionSessionBootstrapAdapter rejects sources with no session material', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => null } });
  await assert.rejects(() => adapter.open('session-ref:empty'), ContractError);
  const adapter2 = new ExtensionSessionBootstrapAdapter({ source: { load: async () => '' } });
  await assert.rejects(() => adapter2.open('session-ref:blank'), ContractError);
});

test('ExtensionSessionBootstrapAdapter drives the popup to replace a session and reports the extension-backed shape', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'fresh-token' }) }, clock: () => 10_000 });
  const lease = await adapter.open('session-ref:replace', { ttlMs: 5_000 });
  let filledWith = null;
  const { context, popupPage } = fakeContext({
    existingCookies: [{ name: '__Secure-next-auth.session-token', domain: '.chatgpt.com', path: '/' }],
    locators: {
      '#sessionToken': fakeLocator({ fill: async (value) => { filledWith = value; } }),
      '#statusMessage': fakeLocator({ getAttribute: async () => 'success' }),
    },
  });
  const result = await adapter.bootstrap(lease, context, { replaceExisting: true });
  assert.equal(popupPage.lastUrl, `chrome-extension://${EXTENSION_ID}/popup.html`);
  assert.equal(filledWith, JSON.stringify({ sessionToken: 'fresh-token' }));
  assert.equal(result.existingSessionPreserved, false);
  assert.equal(result.replacedCookieCount, 1);
  assert.equal(result.viaExtension, true);
  assert.equal(result.sessionDigest, lease.sessionDigest);
});

test('ExtensionSessionBootstrapAdapter surfaces the popup\'s own error message instead of hanging on a rejected token', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'bad-token' }) } });
  const lease = await adapter.open('session-ref:bad');
  const { context } = fakeContext({
    existingCookies: [],
    popupClosesOnClick: false,
    newPageAfterClick: null,
    locators: {
      '#statusMessage': fakeLocator({ getAttribute: async () => 'error', textContent: async () => '登录数据缺少必要内容' }),
    },
  });
  await assert.rejects(
    () => adapter.bootstrap(lease, context, { replaceExisting: true }),
    (error) => error instanceof ContractError && error.message.includes('登录数据缺少必要内容'),
  );
});

test('ExtensionSessionBootstrapAdapter fails closed when the popup controls are missing (wrong extension version or not loaded)', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'token' }) } });
  const lease = await adapter.open('session-ref:missing-controls');
  const { context } = fakeContext({
    existingCookies: [],
    locators: { '#sessionToken': fakeLocator({ count: async () => 0 }) },
  });
  await assert.rejects(
    () => adapter.bootstrap(lease, context, { replaceExisting: true }),
    (error) => error instanceof ContractError && /extension popup controls were not found/.test(error.message),
  );
});

test('ExtensionSessionBootstrapAdapter clearSession drops only session/login cookies, same as the direct-cookie adapter', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'x' }) } });
  const { context, cleared } = fakeContext({
    existingCookies: [
      { name: '__Secure-next-auth.session-token', domain: '.chatgpt.com', path: '/' },
      { name: 'oai-client-auth-info', domain: 'chatgpt.com', path: '/' },
      { name: 'cf_clearance', domain: '.chatgpt.com', path: '/' },
    ],
  });
  const result = await adapter.clearSession(context);
  assert.equal(result.clearedCookieCount, 1);
  assert.equal(result.clearedLoginCookieCount, 1);
  assert.equal(cleared.length, 2);
  const preservedOnly = await adapter.clearSession({ ...context, cookies: async () => [{ name: 'cf_clearance' }] });
  assert.equal(preservedOnly.clearedCookieCount, 0);
  assert.equal(preservedOnly.clearedLoginCookieCount, 0);
});

test('ExtensionSessionBootstrapAdapter rejects bootstrap after the lease is closed', async () => {
  const adapter = new ExtensionSessionBootstrapAdapter({ source: { load: async () => ({ sessionToken: 'x' }) } });
  const lease = await adapter.open('session-ref:closed');
  await adapter.close(lease);
  const { context } = fakeContext();
  await assert.rejects(() => adapter.bootstrap(lease, context), ContractError);
});
