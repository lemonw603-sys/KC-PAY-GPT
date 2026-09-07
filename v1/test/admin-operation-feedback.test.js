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
test('manual card import preview explains why the commit is blocked and translates row issues',async()=>{
 let handler;const notices=[];const panel={innerHTML:'',querySelector(){return null}};
 const preview={sourceName:'备用卡台 A',rowCount:2,insertCount:0,updateCount:1,unavailableCount:0,missingCount:0,activeRiskCount:0,conflictCount:0,rejectedCount:1,commitAllowed:false,confirmation:'x',
  rows:[{row:1,sequence:'ABC123',last4:'5501',balance:'16.00',state:'正常',status:'REJECTED',errors:['BALANCE_MISMATCH']},{row:2,sequence:'DEF456',last4:'0237',balance:'0.00',state:'正常',status:'UPDATE',errors:[]}]};
 const ctx={elements:{manualCardImportForm:{addEventListener(_,fn){handler=fn}},manualCardImportFile:{files:[{name:'cards.xlsx',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}]},manualCardImportSource:{value:'src-1'},manualCardImportPreview:panel},
  api:async()=>preview,escapeHtml:(v)=>String(v??''),showNotice:(x)=>notices.push(x),manualCardImportErrorMessage:(e)=>String(e),btoa:(b)=>Buffer.from(b,'binary').toString('base64'),Uint8Array,String,window:{confirm:()=>false},Promise,loadProviderRoutes:async()=>{},loadStock:async()=>{}};
 vm.runInNewContext(snippet("elements.manualCardImportForm?.addEventListener('submit'"),ctx);
 await handler({preventDefault(){}});
 assert.match(panel.innerHTML,/不能提交：1 行结构错误/);
 assert.match(panel.innerHTML,/第 1 行（尾号 5501）：累计充值 − 累计消费 ≠ 余额（仅提示，按余额列导入）/);
 assert.match(panel.innerHTML,/<em>结构错误<\/em>/);
 assert.match(panel.innerHTML,/id="commit-manual-card-import" disabled/);
 assert.doesNotMatch(panel.innerHTML,/BALANCE_MISMATCH/);
 assert.equal(notices.length,0);
 ctx.api=async()=>({...preview,rejectedCount:0,commitAllowed:true,rows:[preview.rows[1]]});
 await handler({preventDefault(){}});
 assert.match(panel.innerHTML,/可以提交/);
 assert.match(panel.innerHTML,/id="commit-manual-card-import" >/);
 ctx.api=async()=>{throw new Error('manual_card_file_invalid')};
 await handler({preventDefault(){}});
 assert.match(panel.innerHTML,/manual_card_file_invalid/);
 assert.equal(notices.length,1);
});

