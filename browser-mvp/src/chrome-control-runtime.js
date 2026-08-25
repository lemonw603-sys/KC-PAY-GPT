import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { RuntimeAdapter } from './ports.js';
import { assertCohortManifest, assertRef, ContractError } from './contracts.js';

const DEFAULT_EXECUTABLE_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function profileDirectory(root, profileRef) {
  const digest = createHash('sha256').update(profileRef).digest('hex').slice(0, 32);
  return join(root, digest);
}

/**
 * Local Google Chrome control lane. It uses a dedicated persistent profile and
 * exposes only a BrowserContext; payment submission is intentionally not part
 * of this adapter yet.
 */
export class GoogleChromeControlRuntimeAdapter extends RuntimeAdapter {
  constructor({ browserType, profilesRoot, executablePath = DEFAULT_EXECUTABLE_PATH, launchOptions = {}, contextOptions = {} } = {}) {
    super();
    if (!browserType || typeof browserType.launchPersistentContext !== 'function') {
      throw new TypeError('browserType.launchPersistentContext is required');
    }
    if (typeof profilesRoot !== 'string' || profilesRoot.length === 0) {
      throw new TypeError('profilesRoot is required');
    }
    this.browserType = browserType;
    this.profilesRoot = profilesRoot;
    this.executablePath = executablePath;
    this.launchOptions = { headless: true, ...launchOptions };
    this.contextOptions = { ...contextOptions };
  }

  async open(manifest, { profileRef } = {}) {
    assertCohortManifest(manifest);
    if (manifest.mode !== 'CHROME_CONTROL') throw new ContractError('GoogleChromeControlRuntimeAdapter requires CHROME_CONTROL mode');
    if (manifest.capability !== 'CHECKOUT_OBSERVE') throw new ContractError('GoogleChromeControlRuntimeAdapter requires CHECKOUT_OBSERVE capability');
    if (manifest.allowWrites !== false) throw new ContractError('GoogleChromeControlRuntimeAdapter is read-only until the payment gate is enabled');
    const ref = assertRef(profileRef, 'profileRef');
    const userDataDir = profileDirectory(this.profilesRoot, ref);
    await mkdir(userDataDir, { recursive: true, mode: 0o700 });
    try {
      const context = await this.browserType.launchPersistentContext(userDataDir, {
        ...this.launchOptions,
        ...this.contextOptions,
        executablePath: this.executablePath,
      });
      return { context, profileRef: ref, userDataDir, ownsContext: true };
    } catch (error) {
      throw new Error(`failed to open Google Chrome control profile: ${error.message}`, { cause: error });
    }
  }

  async close(runtime) {
    if (!runtime?.context) throw new TypeError('runtime handle is required');
    await runtime.context.close().catch(() => undefined);
  }
}

export { DEFAULT_EXECUTABLE_PATH };
