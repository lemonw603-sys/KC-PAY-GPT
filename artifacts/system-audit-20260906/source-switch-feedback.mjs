import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const s=fs.readFileSync('v1/public/admin/assets/admin.js','utf8');const a=s.indexOf("elements.providerRoutesTable?.addEventListener('click'");const b=s.indexOf('\n});',a)+4;
let fn;let mutations=0;const messages=[];
vm.runInNewContext(s.slice(a,b),{elements:{providerRoutesTable:{addEventListener(_,h){fn=h}}},api:async()=>{mutations++;return{actualTakeoverCount:0}},showNotice:x=>messages.push(x),loadProviderRoutes:async()=>{throw Error('simulated read failure')}});
const button={disabled:false,dataset:{sourceId:'fixture-source',takeover:'false'}};
await fn({target:{closest:()=>button}});
assert.equal(mutations,1);assert(messages.some(x=>x.includes('原选择未改变')));
console.log(JSON.stringify({mode:'ACTUAL_HANDLER_MOCK_API',successfulMutationCalls:mutations,messages,bug:'read failure after successful write incorrectly reports unchanged selection'},null,2));
