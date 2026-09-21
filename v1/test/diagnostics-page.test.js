import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAdminJs } from './helpers/admin-dom-harness.js';
import { ORDER_RESOLUTION_CASE_TYPES } from '../src/services/reconciliation-case-service.js';

function harness(api) {
  const h=loadAdminJs();h.sandbox.__diagApi=api;
  const page=h.evalIn('window.createDiagnosticsPage({api:globalThis.__diagApi,escapeHtml,formatTime,formatMoney,openOrder:()=>{},openCard:()=>{},showNotice:()=>{},orderStatusLabel:code=>code})');
  return {page,html:()=>h.evalIn('document.querySelector("#diagnostics-card-report").innerHTML'),h};
}
const card={cardId:'c1',last4:'<img src=x>',providerAccountId:'p1',providerCardId:'card1',inputVerified:false,
  count:{finding:'UNEXPLAINED_CHARGE',ledgerConsumed:0,ledgerReconciliation:1,settled:2,pending:0},
  amount:{finding:'UNVERIFIABLE',unverifiableReason:'NEGATIVE_BALANCE',balance:'-1.25',charged:'31.44',chargebacks:'0.00'}};
const report={generatedAt:'2026-09-21T00:00:00Z',discrepancies:[card],pendingRegistration:[],cards:[card]};
test('real report fields are escaped, unknown evidence stays unknown and negative balance stays signed',async()=>{
  const h=harness(async url=>url.includes('card-sources')?{sources:[{id:'p1',label:'<script>bad</script>'}]}:report);
  await h.page.loadDaily();const html=h.html();
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<script>|<img/);
  assert.match(html,/-1\.25/);assert.match(html,/付款未定 1 笔/);assert.match(html,/输入证据存疑/);
  assert.match(html,/余额为负/);assert.match(html,/data-diagnostic-card="card1"/);
  assert.doesNotMatch(html,/data-diagnostic-order/,'report may not guess a related order');
});
test('failed reload removes stale report instead of claiming no discrepancies',async()=>{
  let broken=false;const h=harness(async url=>{if(url.includes('card-sources'))return{sources:[]};if(broken)throw Error('503');return report;});
  await h.page.loadDaily();assert.match(h.html(),/UNVERIFIABLE|金额|账本/);broken=true;await h.page.loadDaily();
  assert.match(h.html(),/读取失败/);assert.doesNotMatch(h.html(),/尾号|没有记录/);
});
test('late old response cannot overwrite a newer daily report',async()=>{
  let firstResolve,n=0;const h=harness(url=>url.includes('card-sources')?Promise.resolve({sources:[]}):++n===1?new Promise(r=>{firstResolve=r}):Promise.resolve({...report,discrepancies:[]}));
  const first=h.page.loadDaily();await h.page.loadDaily();firstResolve(report);await first;
  assert.match(h.html(),/没有记录/);assert.doesNotMatch(h.html(),/尾号/);
});
test('malformed report is a failed read, not zero',async()=>{
  const h=harness(async()=>({}));await h.page.loadDaily();assert.match(h.html(),/读取失败/);
});
test('all payment-unknown case types match between frontend fallbacks and backend policy',()=>{
  const h=loadAdminJs();const types=h.evalIn('[...PAYMENT_UNKNOWN_CASE_TYPES]');assert.deepEqual(Array.from(types),ORDER_RESOLUTION_CASE_TYPES);
});
test('diagnostics keeps four groups, low-frequency forms and original Browser controls',()=>{
  const html=fs.readFileSync(new URL('../public/admin/index.html',import.meta.url),'utf8');
  const src=fs.readFileSync(new URL('../public/admin/assets/admin.js',import.meta.url),'utf8');
  const section=html.slice(html.indexOf('<section id="diagnostics-view"'),html.indexOf('<section id="settings-view"'));
  assert.equal((section.match(/class="diag-panel(?: |")/g)||[]).length,4);
  for(const id of ['diagnostics-status','reconciliation-table','diagnostics-card-report','diagnostics-order-search','diagnostics-execution','browser-filters','browser-dispatch-table','browser-runs-table','diagnostics-tools','billing-address-settings','export-orders','export-reconciliation-diag'])assert.ok(section.includes(`id="${id}"`),id);
  assert.match(html,/diagnostics\.js\?v=1/);assert.match(html,/diagnostics\.css\?v=1/);
  assert.match(src,/RESOLVE_UNKNOWN_PAYMENT/);assert.match(src,/CONFIRM_MANUAL_PAYMENT/);assert.match(src,/RELEASE_SAFE/);
  assert.match(src,/diagnostics-tools'\)\.open = true/,'settings link must reveal the folded billing form');
});
