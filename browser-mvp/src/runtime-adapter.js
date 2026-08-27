import { RuntimeAdapter } from './ports.js';
import { assertCohortManifest, ContractError } from './contracts.js';

export class RuntimeOpenError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'RuntimeOpenError';
  }
}

/**
 * Playwright adapter kept behind dependency injection so the MVP contract layer
 * remains runnable without downloading a browser. The adapter only opens an
 * isolated context and exposes no payment-capable method.
 */
export class LocalPlaywrightRuntimeAdapter extends RuntimeAdapter {
  constructor({ browserType, launchOptions = { headless: true }, contextOptions = {} } = {}) {
    super();
    if (!browserType || typeof browserType.launch !== 'function') {
      throw new TypeError('browserType.launch is required');
    }
    this.browserType = browserType;
    this.launchOptions = { ...launchOptions };
    this.contextOptions = { ...contextOptions };
  }

  async open(manifest) {
    assertCohortManifest(manifest);
    if (manifest.mode !== 'LOCAL_MOCK' || manifest.allowWrites !== false) {
      throw new ContractError('LocalPlaywrightRuntimeAdapter only accepts LOCAL_MOCK read-only manifests');
    }
    let browser;
    try {
      browser = await this.browserType.launch(this.launchOptions);
      const context = await browser.newContext(this.contextOptions);
      return { browser, context };
    } catch (error) {
      if (browser) await browser.close().catch(() => undefined);
      throw new RuntimeOpenError('failed to open isolated BrowserContext', error);
    }
  }

  async close(runtime) {
    if (!runtime?.context || !runtime?.browser) throw new TypeError('runtime handle is required');
    await runtime.context.close().catch(() => undefined);
    await runtime.browser.close();
  }
}
