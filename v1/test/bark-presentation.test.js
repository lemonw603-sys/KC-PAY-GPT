import test from 'node:test';
import assert from 'node:assert/strict';
import {presentBarkNotification as present} from '../src/notifications/bark-presentation.js';
import {dispatchOneBarkNotification} from '../src/notifications/bark-dispatcher.js';
import {summaryMessage} from '../src/services/daily-reconciliation-service.js';
const order='PJV1-test-order';
test('customer email replaces the order heading, backend source remains untouched',()=>{
  const input={type:'BROWSER_HUMAN_REQUIRED',publicNo:order,customerEmail:'alice@example.test',title:'待核',message:`订单 ${order}｜付款后系统自己查了几次仍无法确定结果（TIMEOUT）。`};
  const r=present(input);assert.match(r.message,/^账号 alice@example.test\n/);assert.doesNotMatch(r.message,/PJV1-test-order/);assert.match(r.message,/勿重复付款/);assert.match(input.message,/PJV1-test-order/);
});
test('missing, malformed, multiline or contradictory identity keeps the order fallback',()=>{
  for(const customerEmail of [null,'','not-an-email','a@example.test\npassword=hidden','a\u202e@example.test']){
    const r=present({type:'BROWSER_HUMAN_VERIFICATION',publicNo:order,customerEmail,message:`订单 ${order}｜待人工验证`});
    assert.match(r.message,new RegExp(`^订单 ${order}`));assert.equal(r.customerEmail,undefined);
  }
  const r=present({type:'BROWSER_HUMAN_VERIFICATION',publicNo:'PJV1-different',customerEmail:'wrong@example.test',message:`订单 ${order}｜待人工验证`});
  assert.doesNotMatch(r.message,/wrong@example/);assert.equal(r.customerEmail,undefined);
});
test('linked non-browser alert without legacy order prefix still shows email',()=>{
  const r=present({type:'ORDER_PAYMENT_UNKNOWN_REVIEW',customerEmail:'bob@example.test',message:'扣款16 USD尚未确认，请核实，勿重付。'});
  assert.match(r.message,/^账号 bob@example.test\n/);assert.match(r.message,/16 USD/);assert.match(r.message,/勿重付/);
});
test('balance remains exact and readable, including tiny/negative changes; no invented reason',()=>{
  for(const [a,b,expected]of [['89.480000','38.730000','89.48 → 38.73 USD'],['0.000001','-0.000001','0.000001 → -0.000001 USD'],['0.000000','100.000000','0 → 100 USD']]){
    const input={type:'PROVIDER_BALANCE_CHANGED',severity:'info',title:'余额发生变化',message:`HNSKJ余额由 ${a} USD 变为 ${b} USD。`};
    assert.equal(present(input).message,expected);assert.equal(present(input).severity,'info');assert.match(input.message,/余额由/);
  }
});
test('unknown balance schema/currency mismatch falls back instead of losing values',()=>{
  const input={type:'PROVIDER_BALANCE_CHANGED',title:'余额',message:'钱包由 1 USD 变为 2 EUR。'};
  assert.equal(present(input).message,input.message);
});
test('token reminder drops internal code/decision and retains affected work and action',()=>{
  const r=present({type:'PROVIDER_TOKEN_EXPIRED',title:'长标题',message:'highvcc 的访问 token 已失效（HIGHVCC_TOKEN_EXPIRED）。后面的技术过程（D-249）。'});
  assert.match(r.message,/highvcc/);assert.match(r.message,/付款核对/);assert.match(r.message,/更新登录/);assert.doesNotMatch(r.message,/D-249|HIGHVCC_TOKEN_EXPIRED/);
});
test('human verification and uncertain payment keep order and no-repay warning',()=>{
  for(const input of [
    {type:'BROWSER_HUMAN_VERIFICATION',message:`订单 ${order}｜付款已经点过一次，等待人工。`},
    {type:'BROWSER_HUMAN_REQUIRED',message:`订单 ${order}｜付款后系统自己查了几次仍无法确定结果（TIMEOUT）。`},
    {type:'BROWSER_HUMAN_REQUIRED',message:`订单 ${order}｜客户已交付，内部取消续费或对账未完成（REVIEW）。`}
  ]){const r=present({...input,severity:'critical'});assert.match(r.message,new RegExp(order));assert.match(r.message,/勿重复付款|勿重新付款/);assert.equal(r.severity,'critical');}
});
test('failure without recognized no-charge evidence is not rewritten as no-charge',()=>{
  const r=present({type:'BROWSER_ORDER_FAILED',title:'失败待核',message:`订单 ${order}｜结果未知，有16 USD扣款待核。`});
  assert.match(r.message,/结果未知/);assert.match(r.message,/16 USD/);assert.doesNotMatch(r.message,/未扣款|未付款/);
});
test('human-review summary cannot drop a money amount embedded in evidence',()=>{
  const r=present({type:'BROWSER_HUMAN_REQUIRED',title:'待核实',message:`订单 ${order}｜付款后系统自己查了几次仍无法确定结果（TIMEOUT）。两路证据：卡台扣款16.00 USD；请核实，不得重新付款。`});
  assert.match(r.message,/16.00 USD/);assert.match(r.message,/不得重新付款/);
});
test('daily summary preserves every producer count and caveat',()=>{
  const message=summaryMessage({cardCount:30,discrepancyCount:2,persistentCount:1,unexplainedChargeCount:3,pendingRegistrationCount:4,inputUnverifiedCount:5,retirementDueCount:6});
  const r=present({type:'DAILY_RECONCILIATION_SUMMARY',title:'今日对账',message});
  for(const pattern of [/30 张/,/差异 2 张/,/1 张连续两天/,/无主扣款 3 张/,/待补记 4 张/,/暂不升级的 5 张/,/待销到期 6 张/])assert.match(r.message,pattern);
  assert(r.message.length<message.length);
});
test('fallback is redacted and retains unrelated financial details',()=>{
  const r=present({type:'CARD_CHARGEBACK',title:'拒付',message:'卡尾号1234 拒付16 USD access_token=not-a-real-token'});
  assert.match(r.message,/16 USD/);assert.doesNotMatch(r.message,/not-a-real-token/);
});
test('dispatcher uses phone presentation while preserving incident version',async()=>{
  let sent,marked;
  await dispatchOneBarkNotification({repository:{enqueueOpenAlerts:async()=>{},claimNext:async()=>({id:1,alertId:'a',incidentVersion:3,type:'PROVIDER_BALANCE_CHANGED',title:'余额变化',message:'HNSKJ余额由 2.000000 USD 变为 1.000000 USD。'}),markSent:async(...a)=>{marked=a}},client:{send:async p=>{sent=p}}});
  assert.equal(sent.message,'2 → 1 USD');assert.deepEqual(marked,[1,{incidentVersion:3}]);
});
