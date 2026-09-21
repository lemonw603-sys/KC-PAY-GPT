import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../public/admin/assets/admin.js',import.meta.url),'utf8');
function snippet(marker,end='\n});'){const a=src.indexOf(marker);assert(a>=0,`marker not found: ${marker}`);const b=src.indexOf(end,a)+end.length;return src.slice(a,b);}
test('wallet refresh reports failure truthfully and restores the button; retry succeeds', async () => {
 let handler, fail=true; const notices=[], requests=[];
 const ctx={elements:{highvccWalletStatus:{dataset:{},innerHTML:''},highvccRefreshWallet:{disabled:false,addEventListener(_,fn){handler=fn}}},
  api:async(path)=>{requests.push(path);if(fail)throw Error('expired');return{usdBalance:'38.73',usdDeposit:'0',usdConsume:'1'}},
  formatTime:x=>x,showNotice:(...args)=>notices.push(args)};
 vm.runInNewContext(snippet('async function loadHighvccWallet(', '\n}\n')+'\n'+snippet("elements.highvccRefreshWallet?.addEventListener('click'"),ctx);
 await handler();
 assert.match(ctx.elements.highvccWalletStatus.innerHTML,/未取得新余额/);
 assert(!notices.some(x=>x[1]==='success'));assert.equal(ctx.elements.highvccRefreshWallet.disabled,false);
 fail=false;await handler();
 assert.match(ctx.elements.highvccWalletStatus.innerHTML,/38.73/);
 assert.equal(notices.at(-1)[1],'success');assert.equal(ctx.elements.highvccRefreshWallet.disabled,false);
 assert.deepEqual(requests,Array(2).fill('/api/v1/admin/backup-cards/highvcc/wallet'));
});
for (const target of ['wallet','token']) test(`highvcc ${target} jump expands ancestors and focuses only the requested control even if page read fails`,async()=>{
 const outer={open:false,parentElement:null},section={open:false,parentElement:{closest:()=>outer}};
 const focused=[],scrolled=[],notices=[];
 const control=name=>({focus:()=>focused.push(name),scrollIntoView:()=>scrolled.push(name)});
 const ctx={state:{view:'overview'},document:{querySelector:()=>section},
  elements:{highvccTokenInput:control('token'),highvccRefreshWallet:control('wallet')},
  switchView:async(v)=>{ctx.state.view=v;throw Error('read failed')},showNotice:x=>notices.push(x)};
 vm.runInNewContext(snippet('async function openHighvccTarget(', '\n}\n')+'\nglobalThis.run=openHighvccTarget;',ctx);
 await ctx.run(target);
 assert.equal(section.open,true);assert.equal(outer.open,true);
 assert.deepEqual(focused,[target]);assert.deepEqual(scrolled,[target]);assert.equal(notices.length,1);
});
test('highvcc jump does not steal focus after navigation away while loading',async()=>{
 const ctx={state:{view:'overview'},switchView:async()=>{},document:{querySelector(){throw Error('unexpected focus')}},showNotice(){}};
 vm.runInNewContext(snippet('async function openHighvccTarget(', '\n}\n')+'\nglobalThis.run=openHighvccTarget;',ctx);
 await ctx.run('token');await ctx.run('invalid');
});
// 这条原来跑的是 `#refresh-button` 的 handler。查下来那个按钮从 7c1a5c0（工作台重做）
// 起就**不在页面上了**（HTML 0 处、JS 动态创建 0 处），handler 一直是死代码 ——
// 也就是说这条测试一直在给一段用户永远碰不到的代码发绿灯。**测试绿 ≠ 功能可达。**
// handler 已随 D-309 删除；它守的意图（进诊断页要 await 全部五个 loader，不能只等一个
// 就说「刷新完成」）仍然成立，对象换成真正活着的 switchView。
test('进诊断页要 await 全部五个 loader（原来这条守的是个死按钮）', () => {
  const src = fs.readFileSync(new URL('../public/admin/assets/admin.js', import.meta.url), 'utf8');
  const branch = src.slice(src.indexOf("} else if (view === 'diagnostics') {"),
    src.indexOf("} else if (view === 'settings') {"));
  assert.ok(branch, 'switchView 里的 diagnostics 分支不见了');
  const loaders = ['loadDiagnostics', 'loadReconciliationCases', 'loadBrowserDispatchJobs',
    'loadBrowserRuns', 'loadBillingAddressSettings'];
  assert.match(branch, /await refreshDiagnostics\(\{ daily: true \}\)/);
  const refresh = src.slice(src.indexOf('async function refreshDiagnostics('), src.indexOf("document.querySelector('#diagnostics-refresh').addEventListener"));
  for (const name of loaders) assert.ok(refresh.includes(name), `诊断页少 await 了 ${name}`);
  // 必须在同一个 Promise.all 里 await —— 少了 await 就会「页面还空着却说读完了」
  const all = refresh.match(/await Promise\.all\(\[([\s\S]*?)\]\)/);
  assert.ok(all, '五个 loader 必须在一个 await Promise.all 里');
  for (const name of loaders) assert.ok(all[1].includes(name), `${name} 没进那个 Promise.all`);
  assert.ok(all[1].includes('diagnosticsPage.loadDaily()'), '逐卡报告必须一起等完');
  // 页面上已经没有 #refresh-button 了，它的 handler 不许回来
  assert.doesNotMatch(src, /querySelector\('#refresh-button'\)/);
});
// D-280 ⑦ 后卡台切换统一在工作台（applyBrowserCardSource）。这两条保护的行为没变：
// 切成功后读失败仍算成功；响应丢了只能说「未能确认」，不能说「未改变」。
const switchCtx=(over)=>({document:{querySelector:(sel)=>sel==='#decision-card-source'?{value:'fixture'}:null},
 state:{browserSelectionVersion:0},switchCheckReasons:()=>'',...over});
test('successful source switch stays successful if the subsequent read fails',async()=>{
 let writes=0;const messages=[];
 const ctx=switchCtx({api:async()=>{writes++;return{actualTakeoverCount:0}},showNotice:x=>messages.push(x),
  loadOverview:async()=>{throw Error('read failed')}});
 vm.runInNewContext(snippet('async function applyBrowserCardSource(','\n}\n')+'\nglobalThis.__run=applyBrowserCardSource;',ctx);
 const button={disabled:false};
 await ctx.__run(button);
 assert.equal(writes,1);assert(messages.some(x=>x.includes('已切换，但列表刷新失败')));assert(!messages.some(x=>x.includes('原选择未改变')));assert.equal(button.disabled,false);
});
test('lost source-switch response does not claim the selection was unchanged',async()=>{
 let reads=0;const messages=[];
 const ctx=switchCtx({api:async()=>{throw Error('lost response')},showNotice:x=>messages.push(x),
  loadOverview:async()=>{reads++}});
 vm.runInNewContext(snippet('async function applyBrowserCardSource(','\n}\n')+'\nglobalThis.__run=applyBrowserCardSource;',ctx);
 await ctx.__run({disabled:false});
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
