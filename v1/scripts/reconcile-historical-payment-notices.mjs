// D-335 one-off maintenance. No public route; fixed approved IDs; dry-run by default.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createDatabasePool} from '../src/db/pool.js';

export const BATCH = 'D335-20260921-historical-notices';
export const APPROVED = {
  cases: [
    {id:'cf367b11-a188-4a8b-89a0-25396c2b3996',order:'PJV1-9TN0gGX-I5rRdhXxLrq7'},
    {id:'1286b5b3-9fe3-40b7-aff9-25cbaec03ff7',order:'PJV1-G4OZ2IwONAFtL7dUNokp'}
  ],
  alerts: [
    ['cd84a249-adb4-11f1-b261-96f4cc0be41b','PJV1-9TN0gGX-I5rRdhXxLrq7','NOT_CHARGED'],
    ['227e1006-adcd-11f1-b261-96f4cc0be41b','PJV1-CkFQM-aahxjZdJZX8vkY','NOT_CHARGED'],
    ['04aa9568-add2-11f1-b261-96f4cc0be41b','PJV1-ztS9FZ3QcwHopTmZRfDY','CHARGED'],
    ['e4307cac-aec9-11f1-b261-96f4cc0be41b','PJV1-G4OZ2IwONAFtL7dUNokp','NOT_CHARGED'],
    ['150e62ea-af1b-11f1-b261-96f4cc0be41b','PJV1-4U9xwJCCcbx_2qp7EX-1','NOT_CHARGED'],
    ['1e94ccca-af1f-11f1-b261-96f4cc0be41b','PJV1-KLZoklP0ZjTMhLIMVxYd','CHARGED'],
    ['3ecbf5b6-af25-11f1-b261-96f4cc0be41b','PJV1-L_fKJY_PJYxUx2ZlYatk','CHARGED'],
    ['40c81fee-af45-11f1-b261-96f4cc0be41b','PJV1-XrDZCfpakRwaoRQLrEbS','CHARGED'],
    ['fa7ee1b2-af53-11f1-b261-96f4cc0be41b','PJV1-4J5Oq9I-hdv69aLk59wY','CHARGED'],
    ['17c543b8-b1bf-11f1-b261-96f4cc0be41b','PJV1-x-tIsPB5ICHu6R9bzsSO','CHARGED']
  ].map(([id,order,outcome])=>({id,order,outcome}))
};
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const parsed = x => typeof x==='string'?JSON.parse(x):x;
const insist = (ok,code) => {if(!ok)throw new Error(code);};
const protectedKeys=['orders','cdks','attempts','runs','operations','ledger','assignments','cards','notifications'];

export async function reconcileHistoricalNotices(pool,{apply=false,expectedDigest='',targets=APPROVED,backupBeforeApply}={}) {
  insist(targets.cases.length===2&&targets.alerts.length===10,'EXACT_BATCH_REQUIRED');
  const publicNos=targets.alerts.map(t=>t.order).sort();
  insist(new Set(publicNos).size===10&&new Set(targets.alerts.map(t=>t.id)).size===10
    &&new Set(targets.cases.map(t=>t.id)).size===2&&targets.cases.every(t=>publicNos.includes(t.order)),'INVALID_MANIFEST');
  const connection=await pool.getConnection();
  const query=async(sql,args=[]) => (await connection.query(sql,args))[0];
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    const load=async()=>{
      const orders=await query('SELECT * FROM orders WHERE public_no IN (?) ORDER BY id FOR UPDATE',[publicNos]);
      insist(orders.length===10,'ORDER_SET_CHANGED');
      const ids=orders.map(o=>o.id);
      const cdks=await query('SELECT * FROM cdks WHERE id IN (?) ORDER BY id FOR UPDATE',[orders.map(o=>o.cdk_id)]);
      const attempts=await query('SELECT * FROM recharge_attempts WHERE order_id IN (?) ORDER BY id FOR UPDATE',[ids]);
      insist(attempts.length>0,'MISSING_ATTEMPTS');
      const runs=await query('SELECT * FROM browser_runs WHERE recharge_attempt_id IN (?) ORDER BY id FOR UPDATE',[attempts.map(a=>a.id)]);
      insist(runs.length>0,'MISSING_RUNS');
      const operations=await query('SELECT * FROM browser_operations WHERE browser_run_id IN (?) ORDER BY id FOR UPDATE',[runs.map(r=>r.id)]);
      const ledger=await query('SELECT * FROM card_consumption_ledger WHERE order_id IN (?) ORDER BY id FOR UPDATE',[ids]);
      const assignments=await query('SELECT * FROM card_assignment_history WHERE order_id IN (?) ORDER BY id FOR UPDATE',[ids]);
      const cardIds=[...new Set([...ledger.map(l=>l.card_id),...assignments.map(a=>a.card_id),...orders.map(o=>o.assigned_card_id)].filter(Boolean))];
      const cards=cardIds.length?await query('SELECT * FROM cards WHERE id IN (?) ORDER BY id FOR UPDATE',[cardIds]):[];
      const cases=await query('SELECT * FROM reconciliation_cases WHERE order_id IN (?) OR id IN (?) ORDER BY id FOR UPDATE',[ids,targets.cases.map(t=>t.id)]);
      const alerts=await query('SELECT * FROM operator_alerts WHERE order_id IN (?) OR id IN (?) ORDER BY id FOR UPDATE',[ids,targets.alerts.map(t=>t.id)]);
      const notifications=await query('SELECT * FROM alert_notifications WHERE alert_id IN (?) ORDER BY id FOR UPDATE',[targets.alerts.map(t=>t.id)]);
      const audits=await query("SELECT * FROM order_events WHERE order_id IN (?) AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=? ORDER BY id FOR UPDATE",[ids,BATCH]);
      return {orders,cdks,attempts,runs,operations,ledger,assignments,cards,cases,alerts,notifications,audits};
    };
    const before=await load();
    const targetCases=targets.cases.map(t=>before.cases.find(r=>r.id===t.id));
    const targetAlerts=targets.alerts.map(t=>before.alerts.find(r=>r.id===t.id));
    insist([...targetCases,...targetAlerts].every(Boolean),'MISSING_TARGET');
    const manifestDigest=digest(targets);
    if(before.audits.length){
      insist(before.audits.length===10&&new Set(before.audits.map(a=>a.order_id)).size===10
        &&before.audits.every(a=>parsed(a.metadata_json)?.manifestDigest===manifestDigest)
        &&[...targetCases,...targetAlerts].every(r=>r.status==='RESOLVED'),'APPLIED_BATCH_CHANGED');
      await connection.rollback();return {mode:apply?'apply':'dry-run',batch:BATCH,alreadyApplied:true,changedCases:0,changedAlerts:0};
    }
    insist([...targetCases,...targetAlerts].every(r=>r.status==='OPEN'),'TARGET_STATUS_CHANGED');
    insist(!before.cases.some(r=>['OPEN','ASSIGNED'].includes(r.status)&&!targets.cases.some(t=>t.id===r.id)),'EXTRA_OPEN_CASE');
    insist(!before.alerts.some(r=>r.status==='OPEN'&&r.alert_type==='BROWSER_PAYMENT_UNKNOWN'&&!targets.alerts.some(t=>t.id===r.id)),'EXTRA_UNKNOWN_ALERT');
    const proofs=[];
    for(const target of targets.alerts){
      const o=before.orders.find(o=>o.public_no===target.order), c=before.cdks.find(c=>c.id===o.cdk_id);
      const attempts=before.attempts.filter(a=>a.order_id===o.id), runs=before.runs.filter(r=>attempts.some(a=>a.id===r.recharge_attempt_id));
      const ledger=before.ledger.filter(l=>l.order_id===o.id);
      insist(o.finished_at&&!o.cancellation_review_required&&c&&attempts.length&&runs.length,'ORDER_NOT_SETTLED');
      insist(!attempts.some(a=>['ACTIVE','UNKNOWN'].includes(a.funds_risk_state)),'FUNDS_NOT_SETTLED');
      insist(attempts.every(a=>['SUCCESS','FAILED','CLEARED'].includes(a.status)&&['CLEARED','SETTLED'].includes(a.funds_risk_state)),'ATTEMPT_NOT_TERMINAL');
      insist(!ledger.some(l=>['RESERVED','RECONCILIATION'].includes(l.status)),'LEDGER_HELD');
      insist(!before.assignments.some(a=>a.order_id===o.id&&a.status==='ACTIVE'),'ASSIGNMENT_ACTIVE');
      insist(runs.every(r=>['COMPLETED','FAILED_SAFE'].includes(r.status)&&!['PAYMENT_UNKNOWN','PAYMENT_SUBMITTING','PAYMENT_ARMED'].includes(r.payment_state)),'RUN_NOT_SETTLED');
      let proof;
      if(target.outcome==='NOT_CHARGED'){
        insist(o.status==='CLOSED'&&o.failure_code==='HUMAN_VERIFIED_NOT_CHARGED'
          &&attempts.every(a=>a.funds_risk_state==='CLEARED')&&!ledger.some(l=>l.status==='CONSUMED')
          &&c.status==='AVAILABLE'&&c.order_id===null,'NO_CHARGE_STATE_CONFLICT');
        proof=before.operations.find(x=>runs.some(r=>r.id===x.browser_run_id&&r.payment_state==='PAYMENT_DECLINED'&&r.verification_state==='RESOLVED')
          &&x.operation_type==='MANUAL_VERIFICATION_RESOLVED'&&x.status==='COMMITTED'
          &&x.result_code==='MANUAL_VERIFICATION_NOT_CHARGED'&&parsed(x.public_result_json)?.verifiedOutcome==='NOT_CHARGED'
          &&parsed(x.public_result_json)?.actorId&&parsed(x.public_result_json)?.evidenceNote);
        insist(proof,'NO_MANUAL_ADJUDICATION');
      }else{
        insist(target.outcome==='CHARGED'&&o.status==='RECHARGE_SUCCESS'&&c.status==='REDEEMED'&&c.order_id===o.id,'SUCCESS_STATE_CONFLICT');
        const settled=attempts.filter(a=>a.status==='SUCCESS'&&a.funds_risk_state==='SETTLED');
        insist(settled.length===1&&ledger.some(l=>l.status==='CONSUMED'&&l.recharge_attempt_id===settled[0].id),'SUCCESS_LEDGER_MISSING');
        proof=runs.find(r=>r.recharge_attempt_id===settled[0].id&&r.status==='COMPLETED'&&r.payment_state==='PAYMENT_CONFIRMED'
          &&r.verification_state==='RESOLVED'&&r.post_payment_state==='CANCELLATION_CONFIRMED'&&r.cancellation_confirmed_at);
        insist(proof,'CANCELLATION_NOT_PROVEN');
      }
      const alert=before.alerts.find(a=>a.id===target.id);
      insist(alert.order_id===o.id&&alert.alert_type==='BROWSER_PAYMENT_UNKNOWN'
        &&alert.dedupe_key===`browser-browser_payment_unknown:${o.id}`&&Number(alert.incident_version)===1
        &&new Date(alert.updated_at)<=new Date(o.finished_at),'ALERT_EVIDENCE_CHANGED');
      for(const ct of targets.cases.filter(t=>t.order===target.order)){
        const row=before.cases.find(r=>r.id===ct.id),run=runs.find(r=>r.id===parsed(row.evidence_json)?.browserRunId);
        insist(row.order_id===o.id&&row.case_type==='BROWSER_PAYMENT_UNKNOWN'&&run
          &&row.recharge_attempt_id===run.recharge_attempt_id&&row.dedupe_key===`browser-payment-unknown:${row.recharge_attempt_id}`
          &&new Date(row.updated_at)<=new Date(o.finished_at),'CASE_EVIDENCE_CHANGED');
        insist((row.resolution_note||'').length<750,'RESOLUTION_NOTE_TOO_LONG');
      }
      proofs.push({order:o.public_no,orderId:o.id,outcome:target.outcome,proofId:proof.id});
    }
    const protectedHashes=Object.fromEntries(protectedKeys.map(k=>[k,digest(before[k])]));
    const planDigest=digest({targets,protectedHashes,cases:before.cases,alerts:before.alerts});
    const summary={batch:BATCH,mode:apply?'apply':'dry-run',manifestDigest,planDigest,proofs,protectedHashes,
      cases:targetCases.map(r=>({id:r.id,status:r.status,resolvedAt:r.resolved_at})),
      alerts:targetAlerts.map(r=>({id:r.id,status:r.status,acknowledgedAt:r.acknowledged_at,incidentVersion:r.incident_version}))};
    if(!apply){await connection.rollback();return {...summary,changedCases:0,changedAlerts:0};}
    insist(expectedDigest===planDigest,'PREVIEW_CHANGED');
    insist(typeof backupBeforeApply==='function','BACKUP_REQUIRED');
    await backupBeforeApply({batch:BATCH,planDigest,cases:targetCases,alerts:targetAlerts});
    const note=`${BATCH}: reconcile historical notice against existing adjudication; no payment or entitlement change`;
    for(const r of targetCases){const result=await query("UPDATE reconciliation_cases SET status='RESOLVED',resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP(3)),resolution_note=CONCAT_WS('\n',NULLIF(resolution_note,''),?),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND status='OPEN'",[note,r.id]);insist(result.affectedRows===1,'CASE_UPDATE_CONFLICT');}
    for(const r of targetAlerts){const result=await query("UPDATE operator_alerts SET status='RESOLVED',acknowledged_at=COALESCE(acknowledged_at,CURRENT_TIMESTAMP(3)) WHERE id=? AND status='OPEN' AND incident_version=1",[r.id]);insist(result.affectedRows===1,'ALERT_UPDATE_CONFLICT');}
    for(const proof of proofs){const o=before.orders.find(o=>o.id===proof.orderId);
      await query('INSERT INTO order_events (order_id,from_status,to_status,actor_type,actor_id,reason,metadata_json) VALUES (?,?,?,\'ADMIN\',?,?,?)',
        [o.id,o.status,o.status,`codex:${BATCH}`,note,JSON.stringify({maintenanceBatch:BATCH,manifestDigest,planDigest,proof,
          caseIds:targets.cases.filter(t=>t.order===o.public_no).map(t=>t.id),alertIds:targets.alerts.filter(t=>t.order===o.public_no).map(t=>t.id)})]);
    }
    const after=await load();
    insist(protectedKeys.every(k=>digest(after[k])===protectedHashes[k]),'PROTECTED_DATA_CHANGED');
    for(const key of ['cases','alerts']){
      const ids=new Set(targets[key].map(t=>t.id));
      insist(digest(before[key].filter(r=>!ids.has(r.id)))===digest(after[key].filter(r=>!ids.has(r.id))),'NON_TARGET_CHANGED');
      insist(after[key].filter(r=>ids.has(r.id)).every(r=>r.status==='RESOLVED'),'TARGET_NOT_RESOLVED');
    }
    insist(after.audits.length===10,'AUDIT_COUNT_MISMATCH');
    await connection.commit();
    return {...summary,changedCases:2,changedAlerts:10,auditEvents:10,protectedUnchanged:true};
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const args=process.argv.slice(2);let apply=false,expectedDigest='',backupFile='';const seen=new Set();
  for(let i=0;i<args.length;i++){
    const flag=args[i];insist(!seen.has(flag),'DUPLICATE_ARGUMENT');seen.add(flag);
    if(flag==='--apply')apply=true;
    else if(flag==='--dry-run')continue;
    else if(flag==='--expect-digest'){expectedDigest=args[++i]||'';insist(/^[a-f0-9]{64}$/.test(expectedDigest),'INVALID_DIGEST');}
    else if(flag==='--backup-file'){backupFile=args[++i]||'';insist(isAbsolute(backupFile),'ABSOLUTE_BACKUP_REQUIRED');}
    else throw Error('UNKNOWN_ARGUMENT');
  }
  insist(process.env.DATABASE_URL&&!(apply&&seen.has('--dry-run'))&&(!apply||(expectedDigest&&backupFile)),'Use --dry-run or --apply --expect-digest HASH --backup-file ABSOLUTE_PATH');
  const pool=createDatabasePool({url:process.env.DATABASE_URL,tls:{enabled:false}});
  try{console.log(JSON.stringify(await reconcileHistoricalNotices(pool,{apply,expectedDigest,
    backupBeforeApply:data=>writeFile(backupFile,JSON.stringify(data,null,2),{flag:'wx',mode:0o600})}),null,2));}
  catch(e){console.error('HISTORICAL_NOTICE_REFUSED',e.code||e.message);process.exitCode=1;}finally{await pool.end();}
}
