import { access, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

// Chromium derives unpacked-extension IDs from the absolute extension path.
// This lane has no background service worker, so derive the ID when no worker
// target exists instead of assuming every MV3 extension exposes one.
function extensionIdFromPath(path) {
  const digest = createHash('sha256').update(path).digest();
  let id = '';
  for (let index = 0; index < 16; index += 1) {
    id += String.fromCharCode(97 + ((digest[index] >> 4) & 0x0f));
    id += String.fromCharCode(97 + (digest[index] & 0x0f));
  }
  return id;
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
    const canonicalPath = await realpath(this.extensionPath);
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
    return {
      name: manifest.name || null,
      version: manifest.version || null,
      popup: manifest.action.default_popup,
      extensionId: extensionIdFromPath(canonicalPath),
    };
  }

  async bootstrapViaPopup(runtime, sessionInput, { cookieType = 'auto', timeoutMs = 5_000 } = {}) {
    if (!runtime?.context) throw new TypeError('runtime handle is required');
    if (typeof sessionInput !== 'string' || sessionInput.trim().length === 0) throw new TypeError('sessionInput is required');
    const extension = await this.validateExtension();
    const popup = await this.verifyLoaded(runtime, { timeoutMs, extension });
    await popup.locator('#sessionToken').fill(sessionInput);
    const typeControl = popup.locator('#cookieType');
    if (await typeControl.count()) await typeControl.selectOption(cookieType);
    await popup.locator('#loginButton').click();
    return { extensionId: new URL(popup.url()).host, popupUrl: popup.url(), sessionWritten: true, openedChatGPT: true };
  }

  async verifyLoaded(runtime, { timeoutMs = 5_000, extension = null } = {}) {
    if (!runtime?.context) throw new TypeError('runtime handle is required');
    const validated = extension || await this.validateExtension();
    const workers = runtime.context.serviceWorkers?.() || [];
    const worker = workers.find((candidate) => extensionIdFromServiceWorker(candidate.url()));
    const extensionId = extensionIdFromServiceWorker(worker?.url?.()) || validated.extensionId;
    const popup = await runtime.context.newPage();
    try {
      await popup.goto(`chrome-extension://${extensionId}/${validated.popup}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (await popup.locator('#sessionToken').count() !== 1 || await popup.locator('#loginButton').count() !== 1) {
        throw new ContractError('extension popup controls were not found');
      }
      return popup;
    } catch (error) {
      await popup.close().catch(() => undefined);
      if (error instanceof ContractError) throw error;
      throw new ContractError(`extension is not loaded in this Chrome profile: ${error.message}`);
    }
  }
}

export { extensionIdFromServiceWorker };
export { extensionIdFromPath };
