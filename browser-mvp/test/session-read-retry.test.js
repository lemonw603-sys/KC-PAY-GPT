import test from 'node:test';
import assert from 'node:assert/strict';
import {probeSessionIdentity} from '../src/session-identity-probe.js';
function fixture(statuses, extra = {}) {
 let calls=0; const waits=[];
 return {get calls(){return calls}, waits, page:{
  async evaluate(_fn,args){
   if(!args)return {authStatus:'logged_in'};
   const status=statuses[Math.min(calls++,statuses.length-1)];
   return {ok:status===200,status,contentType:status===200?'application/json':'text/html',server:'cloudflare',hasCfRay:true,
    ...(status===200?{email:'fixture@example.test',userId:'user-1',accountId:'acct-1'}:{}),...extra};
  },async waitForTimeout(ms){waits.push(ms)}
 }};
}
const id={email:'fixture@example.test'};
const options={retryDelaysMs:[0,0]};
test('403/503/network failure can recover on a second readonly probe',async()=>{
 for(const status of [403,503,0]){const f=fixture([status,200]);const r=await probeSessionIdentity(f.page,id,options);assert.equal(r.identityMatched,true);assert.equal(f.calls,2)}
});
test('persistent 403 is bounded to three probes; no payment mechanism exists',async()=>{
 const f=fixture([403]);await assert.rejects(()=>probeSessionIdentity(f.page,id,options),e=>e.code==='CHATGPT_ACCESS_BLOCKED'&&e.details.probeAttempts===3);assert.equal(f.calls,3)
});
test('401 and identity mismatch never retry',async()=>{
 for(const [status,extra,code] of [[401,{},'SESSION_INVALID'],[200,{email:'other@example.test'},'SESSION_IDENTITY_MISMATCH']]){
 const f=fixture([status],extra);await assert.rejects(()=>probeSessionIdentity(f.page,id,options),e=>e.code===code);assert.equal(f.calls,1)}
});
test('Retry-After beyond the total budget never triggers an early retry',async()=>{
 const f=fixture([429],{retryAfter:'120'});await assert.rejects(()=>probeSessionIdentity(f.page,id,options),e=>e.details.probeAttempts===1);assert.equal(f.calls,1);assert.equal(f.waits.length,0)
});
test('lost lease interrupts before another request',async()=>{
 const f=fixture([403]);let checks=0;await assert.rejects(()=>probeSessionIdentity(f.page,id,{retryDelaysMs:[500,1000],assertContinue:async()=>{if(++checks>=3)throw Error('LEASE_LOST')}}),/LEASE_LOST/);assert.equal(f.calls,1)
});
