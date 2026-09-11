import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserExecutionService } from '../src/executor.js';
import { BrowserOrderPreflightRepository, createBrowserOrderPreflightWorker } from '../src/browser-order-preflight.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';
import { ExtensionSessionBootstrapAdapter } from '../src/extension-session-bootstrap.js';
import { encryptSecret } from '../../v1/src/security/secret-box.js';
import { sessionFixture } from '../../v1/test-support/session-fixture.js';

// Exercise actual lane composition -> preflight -> chosen adapter.open/bootstrap.
// Only task persistence, browser UI and the rest of executor are substituted.
// No BitBrowser connection, real account, shared state directory or payment.
for (const mode of ['COOKIE', 'EXTENSION']) {
  test(`pool ${mode} preflight invokes the selected adapter with order-scoped material`, async (t) => {
    const { createLaneWorker } = await import('../src/production-live-pool-worker.js');
    const stateDir = await mkdtemp(join(tmpdir(), 'preflight-provider-'));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    const encryptionKey = Buffer.alloc(32, 7);
    const session = sessionFixture();
    let cookieWrites = 0, extensionClicks = 0, completed = 0, sourceReads = 0;
    let popupUrl = '', popupClosed = false, cookieValues = [];
    const popup = {
      goto: async (url) => { popupUrl = url; },
      locator: (selector) => ({
        count: async () => 1,
        fill: async (value) => { assert.equal(selector, '#sessionToken'); assert.equal(JSON.parse(value).sessionToken, session.sessionToken); },
        click: async () => { extensionClicks++; popupClosed = true; cookieValues = [{name:'__Secure-next-auth.session-token',value:session.sessionToken}]; },
        waitFor: async () => {}, getAttribute: async () => null,
      }),
      isClosed: () => popupClosed, close: async () => { popupClosed = true; },
    };
    const context = {
      cookies: async () => cookieValues, clearCookies: async () => {},
      addCookies: async (values) => { cookieWrites++; cookieValues = values; },
      newPage: async () => popup, waitForEvent: async () => ({url:()=> 'https://chatgpt.com/'}),
    };
    const pool = {
      getConnection() { throw Error('unexpected real task transaction'); },
      async query(sql, values) {
        assert.match(sql, /FROM orders o/);
        assert.doesNotMatch(sql, /FROM browser_runs/);
        assert.deepEqual(values, ['fixture-order']); sourceReads++;
        return [[{status:'CARD_READY',executor_kind:'BROWSER',session_ciphertext:encryptSecret(JSON.stringify(session),encryptionKey)}]];
      },
    };
    t.mock.method(BrowserOrderPreflightRepository.prototype, 'claim', async () => ({task_id:'fixture-task',order_id:'fixture-order'}));
    t.mock.method(BrowserOrderPreflightRepository.prototype, 'loadIdentity', async () => ({}));
    t.mock.method(BrowserOrderPreflightRepository.prototype, 'complete', async () => { completed++; });
    t.mock.method(BrowserOrderPreflightRepository.prototype, 'fail', async (_task,error) => { throw error; });
    t.mock.method(BrowserExecutionService.prototype, 'execute', async function (job) {
      assert.equal(this.sessionProvider.constructor, mode === 'EXTENSION' ? ExtensionSessionBootstrapAdapter : CookieSessionBootstrapAdapter);
      assert.equal(job.metadata.sessionRef, 'browser-order:fixture-order');
      const lease = await this.sessionProvider.open(job.metadata.sessionRef);
      try {
        const result = await this.sessionProvider.bootstrap(lease,context);
        assert.equal(result.viaExtension === true, mode === 'EXTENSION');
      } finally { await this.sessionProvider.close(lease); }
      return {submitCalls:0};
    });
    const unusedProvider = {open:async()=>{throw Error('run-scoped provider used for preflight');},bootstrap:async()=>{},close:async()=>{}};
    const lane = await createLaneWorker({
      lane:{laneId:'fixture-lane',bitbrowserProfileId:'a'.repeat(32)},
      config:{stateDir,workerIdPrefix:'test',bitbrowserApiBaseUrl:'http://127.0.0.1:54345',executorProfileId:'fixture-profile',materialEncryptionKey:encryptionKey,sessionProviderMode:mode,runtimeHmacKey:Buffer.alloc(32,1),artifactKey:Buffer.alloc(32,2),resourceHmacKey:Buffer.alloc(32,3),verificationIntervalMs:5000,verificationWindowMs:300000,executionTimeoutMs:30000,leaseSeconds:120,stopBeforeSubmit:true},
      pool,browserType:{connectOverCDP:async()=>{throw Error('unexpected Browser connection');}},
      shared:{enrichedCardSource:{load:async()=>{throw Error('unexpected card read');}},sessionProvider:unusedProvider,postPaymentSessionProvider:unusedProvider},
    });
    const result = await lane.steps.find(step=>step.name==='order-preflight').run();
    assert.equal(result.status,'COMPLETED'); assert.equal(result.externalPaymentCalls,0);
    assert.equal(sourceReads,1); assert.equal(completed,1);
    assert.equal(extensionClicks,mode==='EXTENSION'?1:0); assert.equal(cookieWrites,mode==='COOKIE'?1:0);
    if(mode==='EXTENSION') assert.match(popupUrl,/^chrome-extension:\/\/[a-p]{32}\/popup\.html$/);
  });
}

test('standalone preflight retains COOKIE default and rejects a malformed injected provider', (t) => {
  const base={pool:{getConnection(){},query(){}},workerId:'test',executorProfileId:'fixture',encryptionKey:Buffer.alloc(32,7),runtimeAdapter:{open(){},close(){}},observation:{},evidenceSink:{append(){}}};
  assert.doesNotThrow(()=>createBrowserOrderPreflightWorker(base));
  assert.throws(()=>createBrowserOrderPreflightWorker({...base,sessionProvider:{}}),/sessionProvider.open/);
  assert.throws(()=>createBrowserOrderPreflightWorker({...base,sessionProvider:{open(){},bootstrap(){},close(){}}}),/sessionProvider.clearSession/);
});
