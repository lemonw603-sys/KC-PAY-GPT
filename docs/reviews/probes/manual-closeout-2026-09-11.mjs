// Calls the real service with an explicitly simulated SQL connection.
// Records intended writes, not a database integration test. No network.
import assert from 'node:assert/strict';
import { createBrowserAdminService } from '../../../v1/src/services/browser-admin-service.js';
async function scenario(renewalCancelled) {
  const queries=[]; let committed=false;
  const row={id:'fixture-run',recharge_attempt_id:'fixture-attempt',order_id:'fixture-order',run_status:'HUMAN_REQUIRED',payment_state:'PAYMENT_CONFIRMED',control_state:'AUTOMATION',order_status:'RECHARGE_PROCESSING',order_version:1,attempt_status:'SUBMITTING',funds_risk_state:'ACTIVE',post_payment_state:'PLUS_PENDING',last_checkpoint_sequence:1};
  const connection={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release(){},async query(sql,values=[]){
    const text=sql.replace(/\s+/g,' ').trim(); queries.push({sql:text,values});
    if(text.startsWith('SELECT br.*'))return [[{...row}]];
    if(text.startsWith('SELECT operation_type, public_result_json'))return [[]];
    if(text.startsWith('SELECT * FROM browser_interventions'))return [[]];
    if(/^(UPDATE|INSERT) /.test(text))return [{affectedRows:1}];
    throw Error('Unexpected SQL: '+text);
  }};
  const service=createBrowserAdminService({pool:{query:connection.query,getConnection:async()=>connection},now:()=>new Date('2026-09-11T00:00:00Z')});
  const result=await service.controlRun('fixture-run',{action:'RESOLVE_UNKNOWN_PAYMENT',operationId:'fixture-op',confirmation:'确认核实结果 fixture-run',verifiedOutcome:'CHARGED',renewalCancelled,evidenceNote:'synthetic: charge confirmed; product activation not supplied'});
  const orderUpdate=queries.find(q=>q.sql.startsWith('UPDATE orders SET status = ?'));
  return {input:renewalCancelled,inputType:typeof renewalCancelled,committed,runStatus:result.runStatus,requestedOrderStatus:orderUpdate.values[0],requestedCancellationReview:orderUpdate.values[1],writesSubscriptionCancelled:queries.some(q=>/^UPDATE /.test(q.sql)&&/subscription_cancelled\s*=/.test(q.sql)),selectsProduct:queries.some(q=>/^SELECT /.test(q.sql)&&/plan_type|product_id|products/.test(q.sql)),writesPlusConfirmed:queries.some(q=>q.sql.includes("post_payment_state = 'PLUS_CONFIRMED'"))};
}
const results=[await scenario(false),await scenario('false'),await scenario(true)];
assert.equal(results[0].requestedOrderStatus,'CANCELLATION_REVIEW_REQUIRED');
assert.equal(results[1].requestedOrderStatus,'RECHARGE_SUCCESS');
assert.equal(results[2].writesSubscriptionCancelled,false);
assert.equal(results[2].selectsProduct,false);
assert.equal(results[2].writesPlusConfirmed,true);
console.log(JSON.stringify({scope:'actual service; simulated successful SQL; not persisted DB',results},null,2));
