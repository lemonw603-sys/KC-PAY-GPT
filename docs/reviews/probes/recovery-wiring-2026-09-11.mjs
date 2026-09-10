// Offline audit only. Fake DB/runtime; no network, Browser, credentials or orders.
import assert from 'node:assert/strict';
import { BrowserExecutionService } from '../../../browser-mvp/src/executor.js';
import { BrowserOrderPreflightRepository, createBrowserOrderPreflightWorker } from '../../../browser-mvp/src/browser-order-preflight.js';
import { CookieSessionBootstrapAdapter } from '../../../browser-mvp/src/session-bootstrap.js';
import { SharedPostPaymentSessionSource } from '../../../browser-mvp/src/shared-encrypted-materials.js';
import { LivePostPaymentRecoveryVerifier } from '../../../browser-mvp/src/live-post-payment-recovery.js';
import { encryptSecret } from '../../../v1/src/security/secret-box.js';
import { sessionFixture } from '../../../v1/test-support/session-fixture.js';
const results = {};
const originals = { claim: BrowserOrderPreflightRepository.prototype.claim, identity: BrowserOrderPreflightRepository.prototype.loadIdentity, complete: BrowserOrderPreflightRepository.prototype.complete, execute: BrowserExecutionService.prototype.execute };
try {
  BrowserOrderPreflightRepository.prototype.claim = async () => ({task_id: 'fixture-task',order_id:'fixture-order'});
  BrowserOrderPreflightRepository.prototype.loadIdentity = async () => ({});
  BrowserOrderPreflightRepository.prototype.complete = async () => {};
  BrowserExecutionService.prototype.execute = async function () { results.preflightProvider = this.sessionProvider.constructor.name; return {submitCalls:0}; };
  process.env.BROWSER_SESSION_PROVIDER = 'EXTENSION';
  await createBrowserOrderPreflightWorker({pool:{getConnection(){throw Error('unexpected DB');},query(){throw Error('unexpected DB');}}, workerId:'fixture-worker',executorProfileId:'fixture-profile',encryptionKey:Buffer.alloc(32,7),runtimeAdapter:{open(){throw Error('unexpected runtime');},close(){}},manifest:{allowWrites:false},observation:{},evidenceSink:{append(){}}}).runOnce();
  assert.equal(results.preflightProvider,'CookieSessionBootstrapAdapter');
} finally {
  BrowserOrderPreflightRepository.prototype.claim = originals.claim;
  BrowserOrderPreflightRepository.prototype.loadIdentity = originals.identity;
  BrowserOrderPreflightRepository.prototype.complete = originals.complete;
  BrowserExecutionService.prototype.execute = originals.execute;
}
async function recovery(lifetimeSeconds) {
  const nowMs=Date.parse('2026-09-11T00:00:00Z'),key=Buffer.alloc(32,7);
  const row={run_status:'RECONCILE_ONLY',payment_state:'PAYMENT_UNKNOWN',attempt_status:'SUBMIT_UNKNOWN',funds_risk_state:'UNKNOWN',order_status:'SUBMIT_UNKNOWN',executor_kind:'BROWSER',route_executor_kind:'BROWSER',run_profile_id:'fixture-profile',attempt_profile_id:'fixture-profile',route_id:'fixture-route',attempt_route_id:'fixture-route',order_route_id:'fixture-route',session_ciphertext:encryptSecret(JSON.stringify(sessionFixture({nowMs,lifetimeSeconds})),key)};
  let browserCookieReads=0,confirmCalls=0;
  const page={goto:async()=>{},close:async()=>{},isClosed:()=>false};
  const context={clearCookies:async()=>{throw Error("must not clear resident");},cookies:async()=>{browserCookieReads++;return [{name:'__Secure-next-auth.session-token',value:'synthetic-resident-session'}];},addCookies:async()=>{throw Error('must preserve resident cookie');},newPage:async()=>page};
  const verifier=new LivePostPaymentRecoveryVerifier({runtimeAdapter:{open:async()=>({context}),close:async()=>{}},manifest:{allowWrites:false},sessionProvider:new CookieSessionBootstrapAdapter({source:new SharedPostPaymentSessionSource({db:{execute:async()=>[[row]]},encryptionKey:key,now:()=>nowMs})}),resolveSessionIdentity:async()=>({}),transactionReaderFactory:async()=>({}),verifierFactory:()=>({confirmPlus:async()=>{confirmCalls++;return {confirmed:false,evidence:{synthetic:true}};}})});
  let result;
  try{result=await verifier.verify({runId:'fixture-run',executorProfileId:'fixture-profile'});}catch(error){result={error:error.code};}
  return {lifetimeSeconds,browserCookieReads,confirmCalls,result};
}
results.recoveryFresh=await recovery(3600);
results.recoveryNearExpiry=await recovery(299);
assert.equal(results.recoveryFresh.confirmCalls,1);
assert.equal(results.recoveryNearExpiry.confirmCalls,0);
assert.equal(results.recoveryNearExpiry.browserCookieReads,0);
assert.equal(results.recoveryNearExpiry.result.error,'SESSION_INVALID');
console.log(JSON.stringify(results,null,2));
