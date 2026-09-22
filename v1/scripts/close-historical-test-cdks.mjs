// D-343 one-off maintenance. No public route; fixed approved orders; dry-run by default.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDatabasePool} from '../src/db/pool.js';

export const BATCH='D343-20260922-historical-test-cdks';
export const TARGETS={
  orders:[
    'PJV1-m2wZr2ETzmiI8fTGfAT9','PJV1-bCv-NWwyhLEdU9FwxxVH','PJV1-4cK-yDhExDQbnpr8403G',
    'PJV1-TZmbNEpYNd0Gs_YgRKF_','PJV1-0RcrjBEOL6senGnzqW7e','PJV1-HfAEiq8dBpDLXzt4t96e',
    'PJV1-zqelgAB9K9TsiMdtq_Ox','PJV1-412JIT_yfiuBpZeC39_m','PJV1-zffo7WJvbKcPECKcCxzx',
    'PJV1-T4ZOp1MpFM0G6sXehOYX','PJV1-u696SEuwCQqyReHZ_FmP','PJV1-GodDHJHDQnURKz62CmYU',
    'PJV1-tw-hliEBgnOfdEVsxn5r','PJV1-eqTeit7QVMx-qPqIfjJi','PJV1-AH6M688B3Wfv5_vxISmp',
    'PJV1--j4AnE7fvfgkvaceSr0Z'
  ],
  ledgers:[
    {id:'ac7fcc59-3110-4cea-9338-bad9fe350f8e',order:'PJV1-412JIT_yfiuBpZeC39_m'},
    {id:'7509bb13-6c44-4b7f-b2d2-04e148bbfe28',order:'PJV1-u696SEuwCQqyReHZ_FmP'}
  ]
};

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parsed=value=>typeof value==='string'?JSON.parse(value):value;
const insist=(ok,code)=>{if(!ok)throw new Error(code);};

export async function closeHistoricalTestCdks(pool,{apply=false,expectedDigest='',backupBeforeApply,targets=TARGETS}={}){
  insist(targets.orders.length===16&&new Set(targets.orders).size===16,'EXACT_ORDER_SET_REQUIRED');
  insist(targets.ledgers.length===2&&new Set(targets.ledgers.map(x=>x.id)).size===2
    &&targets.ledgers.every(x=>targets.orders.includes(x.order)),'EXACT_LEDGER_SET_REQUIRED');
  const manifestDigest=digest(targets);
  const connection=await pool.getConnection();
  const query=async(sql,args=[])=>(await connection.query(sql,args))[0];
  try{
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    const orders=await query('SELECT * FROM orders WHERE public_no IN (?) ORDER BY public_no FOR UPDATE',[targets.orders]);
    insist(orders.length===16&&orders.every(o=>targets.orders.includes(o.public_no)),'ORDER_SET_CHANGED');
    insist(orders.every(o=>['CLOSED','RECHARGE_FAILED'].includes(o.status)),'ORDER_NOT_FAILED_OR_CLOSED');
    const orderIds=orders.map(o=>o.id);
    const cdks=await query('SELECT * FROM cdks WHERE id IN (?) ORDER BY id FOR UPDATE',[orders.map(o=>o.cdk_id)]);
    insist(cdks.length===16,'CDK_SET_CHANGED');
    const orderById=new Map(orders.map(o=>[o.id,o]));
    const cdkById=new Map(cdks.map(c=>[c.id,c]));
    insist(orders.every(o=>{const c=cdkById.get(o.cdk_id);return c&&c.status==='REDEEMED'&&c.order_id===o.id;}),'CDK_BINDING_CHANGED');
    const successEvents=await query("SELECT id,order_id FROM order_events WHERE order_id IN (?) AND to_status='RECHARGE_SUCCESS' FOR UPDATE",[orderIds]);
    insist(successEvents.length===0,'HISTORICAL_SUCCESS_FOUND');
    const attempts=await query('SELECT * FROM recharge_attempts WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]);
    insist(!attempts.some(a=>a.funds_risk_state!=='CLEARED'||!a.finished_at
      ||!['FAILED','CLEARED','REJECTED'].includes(a.status)),'ATTEMPT_NOT_TERMINAL');
    const assignments=await query('SELECT * FROM card_assignment_history WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]);
    insist(!assignments.some(a=>a.status==='ACTIVE'),'ACTIVE_ASSIGNMENT_FOUND');
    const refunds=await query('SELECT * FROM refund_cases WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]);
    insist(!refunds.some(r=>!['WITHDRAWN','CLOSED','RESOLVED'].includes(r.status)),'UNSETTLED_REFUND_FOUND');
    const providerCalls=await query("SELECT * FROM provider_calls WHERE order_id IN (?) AND operation='query_status' AND JSON_UNQUOTE(JSON_EXTRACT(response_summary_json,'$.status'))='failed' AND JSON_UNQUOTE(JSON_EXTRACT(response_summary_json,'$.paymentResult.success'))='false' ORDER BY id FOR UPDATE",[orderIds]);
    const ledgers=await query('SELECT * FROM card_consumption_ledger WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]);
    const ledgerTargets=targets.ledgers.map(t=>ledgers.find(l=>l.id===t.id));
    insist(ledgerTargets.every(Boolean),'LEDGER_TARGET_MISSING');
    insist(ledgers.filter(l=>l.status==='RECONCILIATION').length===2
      &&ledgerTargets.every(l=>l.status==='RECONCILIATION'&&Number(l.amount)===16),'LEDGER_STATE_CHANGED');
    const attemptById=new Map(attempts.map(a=>[a.id,a]));
    for(const target of targets.ledgers){
      const order=orders.find(o=>o.public_no===target.order),ledger=ledgers.find(l=>l.id===target.id);
      insist(order&&ledger.order_id===order.id,'LEDGER_ORDER_CHANGED');
      const attempt=attemptById.get(ledger.recharge_attempt_id);
      insist(attempt&&attempt.order_id===order.id&&attempt.status==='FAILED'&&attempt.funds_risk_state==='CLEARED','LEDGER_ATTEMPT_CHANGED');
      const failedProof=providerCalls.some(p=>p.order_id===order.id&&p.operation==='query_status'
        &&parsed(p.response_summary_json)?.status==='failed'
        &&parsed(p.response_summary_json)?.paymentResult?.success===false);
      insist(failedProof,'PROVIDER_FAILURE_PROOF_MISSING');
    }
    const cardIds=[...new Set(ledgerTargets.map(l=>l.card_id))];
    const cards=await query('SELECT * FROM cards WHERE id IN (?) ORDER BY id FOR UPDATE',[cardIds]);
    insist(cards.length===2&&cards.every(c=>c.inventory_status==='RETIRED'),'LEDGER_CARD_NOT_RETIRED');
    const transactions=await query('SELECT * FROM card_transactions WHERE card_id IN (?) ORDER BY id FOR UPDATE',[cardIds]);
    insist(!transactions.some(t=>t.transaction_type==='PURCHASE'),'PURCHASE_FOUND');
    const cases=await query("SELECT * FROM reconciliation_cases WHERE order_id IN (?) AND status IN ('OPEN','ASSIGNED') ORDER BY id FOR UPDATE",[targets.ledgers.map(t=>orders.find(o=>o.public_no===t.order).id)]);
    const alerts=await query("SELECT * FROM operator_alerts WHERE order_id IN (?) AND status='OPEN' ORDER BY id FOR UPDATE",[targets.ledgers.map(t=>orders.find(o=>o.public_no===t.order).id)]);
    insist(cases.length===0&&alerts.length===0,'OPEN_REVIEW_ITEM_FOUND');
    const cdkAudits=await query("SELECT * FROM cdk_admin_events WHERE event_type='CDK_REVOKED' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=? ORDER BY id FOR UPDATE",[BATCH]);
    const ledgerAudits=await query("SELECT * FROM order_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=? ORDER BY id FOR UPDATE",[BATCH]);
    if(cdkAudits.length||ledgerAudits.length){
      insist(cdkAudits.length===16&&ledgerAudits.length===2
        &&cdks.every(c=>c.status==='REVOKED')&&ledgerTargets.every(l=>l.status==='RELEASED'),'APPLIED_BATCH_CHANGED');
      await connection.rollback();return {batch:BATCH,mode:apply?'apply':'dry-run',alreadyApplied:true,changedCdks:0,changedLedgers:0};
    }
    const protectedRows={orders,attempts,assignments,refunds,providerCalls,cards,transactions};
    const protectedHashes=Object.fromEntries(Object.entries(protectedRows).map(([k,v])=>[k,digest(v)]));
    const planDigest=digest({targets,manifestDigest,protectedHashes,cdks,ledgers});
    const summary={batch:BATCH,mode:apply?'apply':'dry-run',manifestDigest,planDigest,
      cdks:orders.map(o=>({order:o.public_no,orderStatus:o.status,cdkId:o.cdk_id,cdkStatus:cdkById.get(o.cdk_id).status})),
      ledgers:targets.ledgers.map(t=>{const l=ledgers.find(x=>x.id===t.id);return {order:t.order,id:l.id,status:l.status,amount:String(l.amount),cardId:l.card_id};}),
      protectedHashes};
    if(!apply){await connection.rollback();return {...summary,changedCdks:0,changedLedgers:0};}
    insist(expectedDigest===planDigest,'PREVIEW_CHANGED');
    insist(typeof backupBeforeApply==='function','BACKUP_REQUIRED');
    await backupBeforeApply({batch:BATCH,manifestDigest,planDigest,orders:orders.map(o=>({id:o.id,publicNo:o.public_no,status:o.status,cdkId:o.cdk_id})),cdks,ledgers:ledgerTargets});
    const reason=`${BATCH}: Lemon-confirmed pre-launch test CDK; never return to saleable inventory`;
    for(const order of orders){
      const result=await query("UPDATE cdks SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP(3),revoke_reason=? WHERE id=? AND order_id=? AND status='REDEEMED'",[reason,order.cdk_id,order.id]);
      insist(result.affectedRows===1,'CDK_UPDATE_CONFLICT');
      await query("INSERT INTO cdk_admin_events (event_type,batch_no,actor_id,metadata_json) VALUES ('CDK_REVOKED',?,'codex:D-343',?)",
        [cdkById.get(order.cdk_id).batch_no,JSON.stringify({maintenanceBatch:BATCH,manifestDigest,planDigest,cdkId:order.cdk_id,orderPublicNo:order.public_no,reason:'pre-launch test code'})]);
    }
    const ledgerReason=`${BATCH}: provider failed, attempt cleared, retired card has no purchase`;
    for(const target of targets.ledgers){
      const ledger=ledgers.find(l=>l.id===target.id),order=orders.find(o=>o.public_no===target.order);
      const result=await query("UPDATE card_consumption_ledger SET status='RELEASED',released_at=CURRENT_TIMESTAMP(3),release_reason=? WHERE id=? AND order_id=? AND status='RECONCILIATION'",[ledgerReason,ledger.id,order.id]);
      insist(result.affectedRows===1,'LEDGER_UPDATE_CONFLICT');
      await query("INSERT INTO order_events (order_id,from_status,to_status,actor_type,actor_id,reason,metadata_json) VALUES (?,?,?,'ADMIN','codex:D-343',?,?)",
        [order.id,order.status,order.status,ledgerReason,JSON.stringify({maintenanceBatch:BATCH,manifestDigest,planDigest,ledgerId:ledger.id,previousStatus:'RECONCILIATION',status:'RELEASED'})]);
    }
    const protectedAfter={
      orders:await query('SELECT * FROM orders WHERE id IN (?) ORDER BY public_no FOR UPDATE',[orderIds]),
      attempts:await query('SELECT * FROM recharge_attempts WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]),
      assignments:await query('SELECT * FROM card_assignment_history WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]),
      refunds:await query('SELECT * FROM refund_cases WHERE order_id IN (?) ORDER BY id FOR UPDATE',[orderIds]),
      providerCalls:await query("SELECT * FROM provider_calls WHERE order_id IN (?) AND operation='query_status' AND JSON_UNQUOTE(JSON_EXTRACT(response_summary_json,'$.status'))='failed' AND JSON_UNQUOTE(JSON_EXTRACT(response_summary_json,'$.paymentResult.success'))='false' ORDER BY id FOR UPDATE",[orderIds]),
      cards:await query('SELECT * FROM cards WHERE id IN (?) ORDER BY id FOR UPDATE',[cardIds]),
      transactions:await query('SELECT * FROM card_transactions WHERE card_id IN (?) ORDER BY id FOR UPDATE',[cardIds])
    };
    insist(Object.keys(protectedHashes).every(k=>digest(protectedAfter[k])===protectedHashes[k]),'PROTECTED_DATA_CHANGED');
    const finalCdks=await query('SELECT id,status,order_id FROM cdks WHERE id IN (?) ORDER BY id FOR UPDATE',[orders.map(o=>o.cdk_id)]);
    const finalLedgers=await query('SELECT id,status FROM card_consumption_ledger WHERE id IN (?) ORDER BY id FOR UPDATE',[targets.ledgers.map(t=>t.id)]);
    const finalCdkAudits=await query("SELECT id FROM cdk_admin_events WHERE event_type='CDK_REVOKED' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=? FOR UPDATE",[BATCH]);
    const finalLedgerAudits=await query("SELECT id FROM order_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=? FOR UPDATE",[BATCH]);
    insist(finalCdks.length===16&&finalCdks.every(c=>c.status==='REVOKED'&&orderById.has(c.order_id)),'CDK_RESULT_MISMATCH');
    insist(finalLedgers.length===2&&finalLedgers.every(l=>l.status==='RELEASED'),'LEDGER_RESULT_MISMATCH');
    insist(finalCdkAudits.length===16&&finalLedgerAudits.length===2,'AUDIT_RESULT_MISMATCH');
    await connection.commit();
    return {...summary,changedCdks:16,changedLedgers:2,cdkAuditEvents:16,ledgerAuditEvents:2,protectedUnchanged:true};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const args=process.argv.slice(2);let apply=false,expectedDigest='',backupFile='';const seen=new Set();
  for(let i=0;i<args.length;i++){
    const flag=args[i];insist(!seen.has(flag),'DUPLICATE_ARGUMENT');seen.add(flag);
    if(flag==='--apply')apply=true;
    else if(flag==='--dry-run')continue;
    else if(flag==='--expect-digest'){expectedDigest=args[++i]||'';insist(/^[a-f0-9]{64}$/.test(expectedDigest),'INVALID_DIGEST');}
    else if(flag==='--backup-file'){backupFile=args[++i]||'';insist(isAbsolute(backupFile),'ABSOLUTE_BACKUP_REQUIRED');}
    else throw new Error('UNKNOWN_ARGUMENT');
  }
  insist(process.env.DATABASE_URL&&!(apply&&seen.has('--dry-run'))&&(!apply||(expectedDigest&&backupFile)),'Use --dry-run or --apply --expect-digest HASH --backup-file ABSOLUTE_PATH');
  const pool=createDatabasePool({url:process.env.DATABASE_URL,tls:{enabled:false}});
  try{
    console.log(JSON.stringify(await closeHistoricalTestCdks(pool,{apply,expectedDigest,
      backupBeforeApply:data=>writeFile(backupFile,JSON.stringify(data,null,2),{flag:'wx',mode:0o600})}),null,2));
  }catch(error){console.error('HISTORICAL_TEST_CDK_REFUSED',error.code||error.message);process.exitCode=1;}finally{await pool.end();}
}
