import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { GoogleChromeControlRuntimeAdapter } from './chrome-control-runtime.js';
import { ContractError } from './contracts.js';

function assertExtensionPath(value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('extensionPath is required');
  return value;
}

function extensionIdFromServiceWorker(url) {
  const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(url || '');
  return match?.[1] || null;
}

/**
 * Explicit lane for the local MV3 "上号器" extension. This adapter only
 * proves extension loading and Session Cookie bootstrap; it never submits a
 * Checkout or exposes the Session input in a result/event.
 */
export class ChromeExtensionSessionRuntimeAdapter extends GoogleChromeControlRuntimeAdapter {
  constructor({ extensionPath, ...options } = {}) {
    const path = assertExtensionPath(extensionPath);
    const launchOptions = { headless: false, ...(options.launchOptions || {}) };
    if (launchOptions.headless === true) throw new ContractError('extension lane requires headed Chromium');
    const args = [...(launchOptions.args || [])];
    if (!args.some((arg) => arg.startsWith('--disable-extensions-except='))) {
      args.push(`--disable-extensions-except=${path}`);
    }
    if (!args.some((arg) => arg.startsWith('--load-extension='))) {
      args.push(`--load-extension=${path}`);
    }
    super({ ...options, launchOptions: { ...launchOptions, args } });
    this.extensionPath = path;
  }

  async validateExtension() {
    await access(this.extensionPath);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(`${this.extensionPath}/manifest.json`, 'utf8'));
    } catch (error) {
      throw new ContractError(`cannot read extension manifest: ${error.message}`);
    }
    if (manifest.manifest_version !== 3 || typeof manifest.action?.default_popup !== 'string') {
      throw new ContractError('extension must be a Manifest V3 action extension with a popup');
    }
    try {
      await access(join(this.extensionPath, manifest.action.default_popup));
    } catch {
      throw new ContractError('extension popup file is missing');
    }
    return { name: manifest.name || null, version: manifest.version || null, popup: manifest.action.default_popup };
  }

  async bootstrapViaPopup(runtime, sessionInput, { cookieType = 'auto', timeoutMs = 5_000 } = {}) {
    if (!runtime?.context) throw new TypeError('runtime handle is required');
    if (typeof sessionInput !== 'string' || sessionInput.trim().length === 0) throw new TypeError('sessionInput is required');
    const extension = await this.validateExtension();
    const workers = runtime.context.serviceWorkers?.() || [];
    let worker = workers.find((candidate) => extensionIdFromServiceWorker(candidate.url()));
    if (!worker && typeof runtime.context.waitForEvent === 'function') {
      try {
        worker = await runtime.context.waitForEvent('serviceworker', { timeout: timeoutMs });
      } catch {
        // A disabled/headless browser may not expose extension service workers.
      }
    }
    const extensionId = extensionIdFromServiceWorker(worker?.url?.());
    if (!extensionId) throw new ContractError('extension service worker was not observed; use headed Chromium for the extension lane');
    const popup = await runtime.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/${extension.popup}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await popup.locator('#sessionToken').fill(sessionInput);
    const typeControl = popup.locator('#cookieType');
    if (await typeControl.count()) await typeControl.selectOption(cookieType);
    await popup.locator('#loginButton').click();
    return { extensionId, popupUrl: popup.url(), sessionWritten: true, openedChatGPT: true };
  }
}

export { extensionIdFromServiceWorker };
