import {SharedPostPaymentSessionSource} from '../../../browser-mvp/src/shared-encrypted-materials.js';
import {encryptSecret} from '../../../v1/src/security/secret-box.js';
const key=Buffer.alloc(32,41),now=Date.parse('2026-09-16T12:00:00Z');
const jwt=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({iat:now/1000-60,exp:now/1000+3600})).toString('base64url'),'fixture-signature'].join('.');
const session={user:{id:'fixture-user',email:'fixture@example.test'},account:{id:'fixture-account'},accessToken:jwt,sessionToken:'fixture.jwe.encrypted.payload.tag',expires:new Date(now+3600000).toISOString()};
const row={run_status:'RUNNING',payment_state:'PAYMENT_CONFIRMED',attempt_status:'SUBMITTING',funds_risk_state:'ACTIVE',executor_kind:'BROWSER',route_executor_kind:'BROWSER',run_profile_id:'p',attempt_profile_id:'p',route_id:'r',attempt_route_id:'r',order_route_id:'r',session_ciphertext:encryptSecret(JSON.stringify(session),key)};
for(const [status,elapsedMs] of [['RECHARGE_PROCESSING',0],['RECHARGE_SUCCESS',0],['RECHARGE_PROCESSING',31*60000]]){
 const source=new SharedPostPaymentSessionSource({db:{execute:async()=>[[{...row,order_status:status}]]},encryptionKey:key,now:()=>now+elapsedMs});
 try{await source.load('browser-run:fixture');console.log(JSON.stringify({fixtureOnly:true,orderStatus:status,elapsedMs,loaded:true}))}
 catch(e){console.log(JSON.stringify({fixtureOnly:true,orderStatus:status,elapsedMs,loaded:false,code:e.code,message:e.message}))}
}
