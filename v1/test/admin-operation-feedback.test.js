import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../public/admin/assets/admin.js',import.meta.url),'utf8');
function snippet(marker){const a=src.indexOf(marker);assert(a>=0);const b=src.indexOf('\n});',a)+4;return src.slice(a,b);}
test('Diagnostics manual refresh actually awaits all five loaders',async()=>{
 let handler;const calls=[],notices=[];
 const ctx={document:{querySelector(){return{addEventListener(_,fn){handler=fn}}}},state:{view:'diagnostics'},elements:{syncTime:{}},hideNotice(){},showNotice(x){notices.push(x)},Promise};
 for(const n of ['loadDiagnostics','loadReconciliationCases','loadBrowserDispatchJobs','loadBrowserRuns','loadBillingAddressSettings'])ctx[n]=async()=>{await Promise.resolve();calls.push(n)};
 vm.runInNewContext(snippet("document.querySelector('#refresh-button').addEventListener"),ctx);
 await handler({currentTarget:{disabled:false,classList:{add(){},remove(){}}}});
 assert.equal(calls.length,5);assert(notices.includes('刷新完成。'));
});
test('successful source switch stays successful if the subsequent read fails',async()=>{
 let handler,writes=0;const messages=[];
 vm.runInNewContext(snippet("elements.providerRoutesTable?.addEventListener('click'"),{elements:{providerRoutesTable:{addEventListener(_,fn){handler=fn}}},api:async()=>{writes++;return{actualTakeoverCount:0}},showNotice:x=>messages.push(x),loadProviderRoutes:async()=>{throw Error('read failed')}});
 const button={disabled:false,dataset:{sourceId:'fixture',takeover:'false'}};
 await handler({target:{closest:()=>button}});
 assert.equal(writes,1);assert(messages.some(x=>x.includes('已切换，但列表刷新失败')));assert(!messages.some(x=>x.includes('原选择未改变')));assert.equal(button.disabled,false);
});
test('lost source-switch response does not claim the selection was unchanged',async()=>{
 let handler,reads=0;const messages=[];
 vm.runInNewContext(snippet("elements.providerRoutesTable?.addEventListener('click'"),{elements:{providerRoutesTable:{addEventListener(_,fn){handler=fn}}},api:async()=>{throw Error('lost response')},showNotice:x=>messages.push(x),loadProviderRoutes:async()=>{reads++}});
 await handler({target:{closest:()=>({disabled:false,dataset:{sourceId:'fixture'}})}});
 assert.equal(reads,1);assert(messages.some(x=>x.includes('未能确认')));assert(!messages.some(x=>x.includes('原选择未改变')));
});
