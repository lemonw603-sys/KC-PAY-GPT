import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {createBrowserExecutionRepository} from '../src/db/repositories/browser-execution-repository.js';
import {createOrderStatusService} from '../src/services/order-status-service.js';
import {readCdkReturnEvidence,cdkReturnBlockedBy} from '../src/db/repositories/cdk-return-repository.js';
const url=process.env.TEST_DATABASE_URL;
const hash=x=>createHash('sha256').update(x).digest('hex');
for(const plan of ['plus','pro_5x']) test(`durable early delivery and restart-safe cleanup: ${plan}`,{skip:!url},async()=>{
 const pool=mysql.createPool({uri:url,connectionLimit:2,timezone:'Z'});
 const [order,cdk,attempt,run,profile]=Array.from({length:5},()=>randomUUID());
 const evidenceHash=hash(run);
 const publicNo='PJV1-'+order.replace(/-/g,'').slice(0,20);
 try{
  await pool.query(`INSERT INTO executor_profiles(id,profile_code,profile_version,executor_kind,runtime_id,adapter_version,status,config_public_json) VALUES(?,?,1,'BROWSER','TEST','TEST','ACTIVE','{}')`,[profile,'d240-'+profile]);
  await pool.query(`INSERT INTO cdks(id,code_hash,status) VALUES(?,?,'REDEEMED')`,[cdk,hash(cdk)]);
  await pool.query(`INSERT INTO orders(id,public_no,cdk_id,status,plan_type,session_ciphertext,card_purchase_idempotency_key) VALUES(?,?,?,'RECHARGE_PROCESSING',?,?,?)`,[order,publicNo,cdk,plan,Buffer.from('test-only'),'d240-'+order]);
  await pool.query('UPDATE cdks SET order_id=? WHERE id=?',[order,cdk]);
  await pool.query(`INSERT INTO recharge_attempts(id,order_id,executor_kind,status,funds_risk_state) VALUES(?,?,'BROWSER','SUBMITTING','ACTIVE')`,[attempt,order]);
  await pool.query(`INSERT INTO browser_runs(id,recharge_attempt_id,executor_profile_id,run_no,start_operation_key,status,payment_state,post_payment_state,verification_state,verification_deadline_at,account_key_hmac,worker_id)
    VALUES(?,?,?,1,?,'RUNNING','PAYMENT_CONFIRMED','PLUS_PENDING','VERIFYING_PAYMENT',DATE_ADD(NOW(),INTERVAL 5 MINUTE),?,'pool:lane-test')`,[run,attempt,profile,'d240-'+run,hash(order)]);
  await pool.query(`INSERT INTO browser_operations(browser_run_id,operation_id,operation_type,status,prepared_at) VALUES(?,?,'PAYMENT_SUBMIT','COMMITTED',NOW())`,[run,'submit-'+run]);
  await pool.query(`INSERT INTO browser_run_events(job_id,order_id,browser_run_id,sequence_no,event_type,action,summary_json,payload_digest)
    VALUES(?,?,?,1,'checkpoint','payment-stage',?,?)`,['brjob:'+order,order,run,JSON.stringify({stage:'fill-billing-email'}),hash(run)]);
  const readStatus=createOrderStatusService({pool,cdkHashKey:Buffer.alloc(32,1)});
  assert.equal((await readStatus({publicNo})).stage.index,6);
  const repo=createBrowserExecutionRepository(pool);
  await repo.recordPlusActivation({runId:run,operationId:'plus-'+run,evidenceHash});
  const [[first]]=await pool.query('SELECT status,finished_at FROM orders WHERE id=?',[order]);
  assert.equal(first.status,plan==='plus'?'RECHARGE_SUCCESS':'RECHARGE_PROCESSING');
  const visible=await readStatus({publicNo});
  assert.equal(visible.status,plan==='plus'?'SUCCESS':'ACTIVATING');
  assert.equal(visible.stage.index,plan==='plus'?9:8);
  const [[pending]]=await pool.query('SELECT status,post_payment_state,active_account_key_hmac FROM browser_runs WHERE id=?',[run]);
  assert.equal(pending.status,'RUNNING');assert.equal(pending.post_payment_state,'CANCELLATION_PENDING');assert.ok(pending.active_account_key_hmac);
  assert.equal(cdkReturnBlockedBy(await readCdkReturnEvidence(pool,order)),true);
  // A new repository instance/connection still discovers cleanup after customer delivery.
  const restarted=createBrowserExecutionRepository(pool);
  const due=await restarted.listPaymentVerificationsDue({orderId:order});assert.equal(due.length,1);
  await restarted.recordPlusActivation({runId:run,operationId:'plus-'+run,evidenceHash});
  const [[deliveryEvents]]=await pool.query("SELECT COUNT(*) AS n FROM order_events WHERE order_id=? AND to_status='RECHARGE_SUCCESS'",[order]);
  assert.equal(Number(deliveryEvents.n),plan==='plus'?1:0);
  if(plan==='plus'){
    // Failed cleanup escalates internally but never revokes delivered success or CDK.
    await restarted.escalatePaymentVerification({runId:run,operationId:'escalate-'+run,reasonCode:'POST_PAYMENT_RECONCILIATION_REQUIRED',evidenceHash});
    const [[still]]=await pool.query('SELECT status FROM orders WHERE id=?',[order]);assert.equal(still.status,'RECHARGE_SUCCESS');
    // Simulate operator resuming the existing verification, never a payment replay.
    await pool.query("UPDATE browser_runs SET status='RUNNING',verification_state='VERIFYING_PAYMENT' WHERE id=?",[run]);
    await restarted.recordCancellationConfirmed({runId:run,operationId:'cancel-'+run,evidenceHash});
    await restarted.recordCancellationConfirmed({runId:run,operationId:'cancel-'+run,evidenceHash});
    const [[end]]=await pool.query('SELECT status,finished_at FROM orders WHERE id=?',[order]);assert.equal(end.status,'RECHARGE_SUCCESS');assert.equal(+end.finished_at,+first.finished_at);
    const [[br]]=await pool.query('SELECT status,active_account_key_hmac FROM browser_runs WHERE id=?',[run]);assert.equal(br.status,'COMPLETED');assert.equal(br.active_account_key_hmac,null);
    const [[submits]]=await pool.query("SELECT COUNT(*) AS n FROM browser_operations WHERE browser_run_id=? AND operation_type='PAYMENT_SUBMIT'",[run]);assert.equal(Number(submits.n),1);
  }
 }finally{
  for(const table of ['operator_alerts','reconciliation_cases','order_events'])await pool.query(`DELETE FROM ${table} WHERE order_id=?`,[order]);
  for(const table of ['browser_run_events','browser_post_payment_observations','browser_checkpoints','browser_operations'])await pool.query(`DELETE FROM ${table} WHERE browser_run_id=?`,[run]);
  await pool.query('DELETE FROM browser_runs WHERE id=?',[run]);await pool.query('DELETE FROM recharge_attempts WHERE id=?',[attempt]);
  await pool.query('UPDATE cdks SET order_id=NULL WHERE id=?',[cdk]);await pool.query('DELETE FROM orders WHERE id=?',[order]);await pool.query('DELETE FROM cdks WHERE id=?',[cdk]);await pool.query('DELETE FROM executor_profiles WHERE id=?',[profile]);await pool.end();
 }
});
