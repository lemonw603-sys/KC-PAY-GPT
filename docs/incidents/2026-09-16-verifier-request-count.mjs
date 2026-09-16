// Offline fixture only: counts requests made by the current production verifier.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {ChatGptPostPaymentVerifier} from '../../browser-mvp/src/chatgpt-post-payment-verifier.js';
let renew=true;const requests=[];
const server=createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});return res.end('<title>fixture</title>')}
 requests.push({method:req.method,path:req.url});res.writeHead(200,{'content-type':'application/json'});
 if(req.url==='/api/auth/session')return res.end(JSON.stringify({user:{id:'u1',email:'fixture@example.test'},account:{id:'a1'},accessToken:'fixture-only'}));
 if(req.url.startsWith('/backend-api/accounts/check/'))return res.end(JSON.stringify({accounts:{default:{account:{account_id:'a1'},entitlement:{has_active_subscription:true,subscription_plan:'chatgptplusplan'},last_active_subscription:{will_renew:renew,purchase_origin_platform:'web'}}}}));
 if(req.url==='/backend-api/subscriptions/cancel'){renew=false;return res.end('{}')}
 res.end('{}');
});server.listen(0,'127.0.0.1');await once(server,'listening');
const b=await chromium.launch({headless:true});
try{
 const page=await b.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const v=new ChatGptPostPaymentVerifier({page,expectedIdentity:{email:'fixture@example.test',accountId:'a1'},transactionReader:{read:async()=>[],reconcile:async()=>({matched:true})}});
 const steps=[];for(const method of ['confirmPlus','confirmPlus','confirmCancellation']){const start=requests.length;const result=await v[method]();steps.push({method,confirmed:result.confirmed,requests:requests.slice(start)})}
 console.log(JSON.stringify({fixtureOnly:true,steps,total:requests.length},null,2));
}finally{await b.close();server.close();await once(server,'close')}
