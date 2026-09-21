// Real isolated MySQL test; uses no production configuration or providers.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import mysql from '../v1/node_modules/mysql2/promise.js';
import {createBrowserExecutionRepository} from '../v1/src/db/repositories/browser-execution-repository.js';
import {BATCH,reconcileHistoricalNotices} from '../v1/scripts/reconcile-historical-payment-notices.mjs';
import {createAlertNotificationRepository} from '../v1/src/db/repositories/alert-notification-repository.js';

const name='notice_test_'+crypto.randomBytes(4).toString('hex');
const inspect=JSON.parse(execFileSync('docker',['inspect','pojia-stage1-mysql'],{encoding:'utf8'}))[0];
const binding=inspect.NetworkSettings.Ports['3306/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');assert.notEqual(binding.HostPort,'13306');
const url=new URL(`mysql://root@127.0.0.1:${binding.HostPort}/`);
url.password=inspect.Config.Env.find(x=>x.startsWith('MYSQL_ROOT_PASSWORD=')).slice('MYSQL_ROOT_PASSWORD='.length);
let owner,pool,created=false;let checks=0;
const pass=label=>{checks++;console.log('PASS',label)};
try{
  owner=await mysql.createConnection({uri:url.href,timezone:'Z'});await owner.query(`CREATE DATABASE ${name}`);created=true;
  url.pathname='/'+name;pool=mysql.createPool({uri:url.href,timezone:'Z',connectionLimit:4});
  execFileSync(process.execPath,['v1/scripts/migrate.js'],{env:{...process.env,MIGRATION_DATABASE_URL:url.href,MIGRATION_DATABASE_TLS:'false'},stdio:['ignore','pipe','pipe']});
  const text=await readFile(new URL('../v1/test/browser-resolve-unknown-payment-mysql-integration.test.js',import.meta.url),'utf8');
  const start=text.indexOf('async function createFixture('),end=text.indexOf('// Puts the fixture',start);assert(start>0&&end>start);
  const createFixture=new Function('crypto','createBrowserExecutionRepository',`const productId='00000000-0000-4000-8000-000000000201',routeId='00000000-0000-4000-8000-000000000302',hnskjAccountId='00000000-0000-4000-8000-000000000101';${text.slice(start,end)};return createFixture;`)(crypto,createBrowserExecutionRepository);
  const targets={cases:[],alerts:[]},fixtures=[];
  for(let n=0;n<10;n++){
    const {ids}=await createFixture(pool,'notice-'+n,{seedCase:false});fixtures.push(ids);
    const success=n>=4,order='NOTICE-'+ids.orderId;
    await pool.query("UPDATE orders SET public_no=?,status=?,failure_code=?,cancellation_review_required=0,finished_at='2026-09-02 00:00:00' WHERE id=?",[order,success?'RECHARGE_SUCCESS':'CLOSED',success?null:'HUMAN_VERIFIED_NOT_CHARGED',ids.orderId]);
    await pool.query("UPDATE recharge_attempts SET status=?,funds_risk_state=?,finished_at='2026-09-02 00:00:00' WHERE id=?",[success?'SUCCESS':'FAILED',success?'SETTLED':'CLEARED',ids.attemptId]);
    await pool.query("UPDATE browser_runs SET status=?,payment_state=?,verification_state='RESOLVED',control_state='RELEASED',post_payment_state=?,cancellation_confirmed_at=?,finished_at='2026-09-02 00:00:00' WHERE id=?",[success?'COMPLETED':'FAILED_SAFE',success?'PAYMENT_CONFIRMED':'PAYMENT_DECLINED',success?'CANCELLATION_CONFIRMED':'NOT_STARTED',success?'2026-09-02 00:00:00':null,ids.runId]);
    await pool.query('UPDATE cdks SET status=?,order_id=? WHERE id=?',[success?'REDEEMED':'AVAILABLE',success?ids.orderId:null,ids.cdkId]);
    await pool.query("UPDATE card_consumption_ledger SET status=?,consumed_at=? WHERE order_id=?",[success?'CONSUMED':'RELEASED',success?'2026-09-02 00:00:00':null,ids.orderId]);
    await pool.query("UPDATE card_assignment_history SET status='RELEASED' WHERE order_id=?",[ids.orderId]);
    if(!success)await pool.query("INSERT INTO browser_operations (browser_run_id,operation_id,operation_type,status,result_code,public_result_json,completed_at) VALUES (?,?,'MANUAL_VERIFICATION_RESOLVED','COMMITTED','MANUAL_VERIFICATION_NOT_CHARGED',?,'2026-09-02 00:00:00')",[ids.runId,crypto.randomUUID(),JSON.stringify({verifiedOutcome:'NOT_CHARGED',actorId:'fixture',evidenceNote:'isolated adjudication'})]);
    const alert=crypto.randomUUID();targets.alerts.push({id:alert,order,outcome:success?'CHARGED':'NOT_CHARGED'});
    await pool.query("INSERT INTO operator_alerts (id,alert_type,dedupe_key,order_id,severity,title,message,status,created_at,updated_at) VALUES (?,'BROWSER_PAYMENT_UNKNOWN',?,?,'critical','fixture','fixture','OPEN','2026-09-01 00:00:00','2026-09-01 00:00:00')",[alert,`browser-browser_payment_unknown:${ids.orderId}`,ids.orderId]);
    if(n<2){const id=crypto.randomUUID();targets.cases.push({id,order});await pool.query("INSERT INTO reconciliation_cases (id,case_type,status,dedupe_key,order_id,recharge_attempt_id,evidence_json,detected_at,updated_at) VALUES (?,'BROWSER_PAYMENT_UNKNOWN','OPEN',?,?,?,?,'2026-09-01 00:00:00','2026-09-01 00:00:00')",[id,`browser-payment-unknown:${ids.attemptId}`,ids.orderId,ids.attemptId,JSON.stringify({browserRunId:ids.runId})]);}
  }
  const dry=()=>reconcileHistoricalNotices(pool,{targets});
  await pool.query("INSERT INTO alert_notifications (alert_id,channel,status,sent_at) VALUES (?,'bark','SENT',CURRENT_TIMESTAMP(3))",[targets.alerts[0].id]);
  const extraAlert=crypto.randomUUID();await pool.query("INSERT INTO operator_alerts(id,alert_type,dedupe_key,order_id,title,message,status) VALUES (?,'OTHER',?,?,'fixture','fixture','OPEN')",[extraAlert,extraAlert,fixtures[0].orderId]);
  const scalar=async(q,args=[])=>Object.values((await pool.query(q,args))[0][0])[0];
  const open=()=>scalar("SELECT COUNT(*) n FROM operator_alerts WHERE status='OPEN' AND alert_type='BROWSER_PAYMENT_UNKNOWN'");
  const initial=await dry();assert.equal(initial.changedCases,0);assert.equal(await open(),10);pass('dry-run is read-only and validates all 12 targets');
  await pool.query("UPDATE recharge_attempts SET funds_risk_state='UNKNOWN' WHERE id=?",[fixtures[0].attemptId]);
  await assert.rejects(dry,/FUNDS_NOT_SETTLED/);await pool.query("UPDATE recharge_attempts SET funds_risk_state='CLEARED' WHERE id=?",[fixtures[0].attemptId]);pass('unknown funds refuse');
  await pool.query("UPDATE card_consumption_ledger SET status='RECONCILIATION' WHERE order_id=?",[fixtures[0].orderId]);
  await assert.rejects(dry,/LEDGER_HELD/);await pool.query("UPDATE card_consumption_ledger SET status='RELEASED' WHERE order_id=?",[fixtures[0].orderId]);pass('held ledger refuses');
  await pool.query("UPDATE browser_runs SET cancellation_confirmed_at=NULL WHERE id=?",[fixtures[4].runId]);await assert.rejects(dry,/CANCELLATION_NOT_PROVEN/);
  await pool.query("UPDATE browser_runs SET cancellation_confirmed_at='2026-09-02 00:00:00' WHERE id=?",[fixtures[4].runId]);pass('unproven cancellation refuses');
  await pool.query("UPDATE browser_operations SET result_code='DIFFERENT' WHERE browser_run_id=? AND operation_type='MANUAL_VERIFICATION_RESOLVED'",[fixtures[0].runId]);await assert.rejects(dry,/NO_MANUAL_ADJUDICATION/);
  await pool.query("UPDATE browser_operations SET result_code='MANUAL_VERIFICATION_NOT_CHARGED' WHERE browser_run_id=? AND operation_type='MANUAL_VERIFICATION_RESOLVED'",[fixtures[0].runId]);pass('missing manual evidence refuses');
  const preview=await dry();await pool.query("UPDATE orders SET version=version+1 WHERE id=?",[fixtures[0].orderId]);
  await assert.rejects(()=>reconcileHistoricalNotices(pool,{targets,apply:true,expectedDigest:preview.planDigest}),/PREVIEW_CHANGED/);assert.equal(await open(),10);pass('changed evidence refuses before any writes');
  const fresh=await dry();let updates=0;
  const failing={async getConnection(){const c=await pool.getConnection();return new Proxy(c,{get(obj,key){if(key==='query')return async(sql,args)=>{if(sql.startsWith('UPDATE operator_alerts')&&++updates===3)throw Error('INJECTED_FAILURE');return obj.query(sql,args)};const v=obj[key];return typeof v==='function'?v.bind(obj):v;}})}};
  let backupCount=0;const backupBeforeApply=async data=>{assert.equal(data.cases.length,2);assert.equal(data.alerts.length,10);backupCount++;};
  await assert.rejects(()=>reconcileHistoricalNotices(pool,{targets,apply:true,expectedDigest:fresh.planDigest}),/BACKUP_REQUIRED/);pass('apply requires backup');
  await assert.rejects(()=>reconcileHistoricalNotices(pool,{targets,apply:true,expectedDigest:fresh.planDigest,backupBeforeApply:async()=>{throw Error('BACKUP_FAILED')}}),/BACKUP_FAILED/);assert.equal(await open(),10);pass('backup failure prevents writes');
  await assert.rejects(()=>reconcileHistoricalNotices(failing,{targets,apply:true,expectedDigest:fresh.planDigest,backupBeforeApply}),/INJECTED_FAILURE/);
  assert.equal(await open(),10);assert.equal(await scalar("SELECT COUNT(*) n FROM reconciliation_cases WHERE status='OPEN'"),2);pass('mid-batch failure rolls back all case and alert changes');
  const applied=await reconcileHistoricalNotices(pool,{targets,apply:true,expectedDigest:fresh.planDigest,backupBeforeApply});assert.equal(applied.changedCases,2);assert.equal(applied.changedAlerts,10);assert.equal(applied.protectedUnchanged,true);assert.equal(await open(),0);assert.equal(backupCount,2);
  assert.equal(await scalar("SELECT COUNT(*) n FROM order_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=?",[BATCH]),10);pass('exact 2+10 close with 10 audit events; protected rows unchanged');
  assert.equal(await scalar('SELECT status FROM operator_alerts WHERE id=?',[extraAlert]),'OPEN');assert.equal(await scalar('SELECT status FROM alert_notifications WHERE alert_id=?',[targets.alerts[0].id]),'SENT');pass('unapproved alert and existing notification unchanged');
  const [[notificationBefore]]=await pool.query('SELECT attempt_count,sent_at FROM alert_notifications WHERE alert_id=?',[targets.alerts[0].id]);
  await createAlertNotificationRepository(pool).enqueueOpenAlerts();
  const [[notificationAfter]]=await pool.query('SELECT status,attempt_count,sent_at FROM alert_notifications WHERE alert_id=?',[targets.alerts[0].id]);
  assert.equal(notificationAfter.status,'CANCELLED');assert.equal(notificationAfter.attempt_count,notificationBefore.attempt_count);assert.deepEqual(notificationAfter.sent_at,notificationBefore.sent_at);pass('existing notification worker cancels closed notice without resending or losing sent time');
  assert.equal((await reconcileHistoricalNotices(pool,{targets,apply:true})).alreadyApplied,true);pass('replay is no-op');
  await pool.query("UPDATE operator_alerts SET status='OPEN' WHERE id=?",[targets.alerts[0].id]);await assert.rejects(dry,/APPLIED_BATCH_CHANGED/);pass('reopened incident never silently closed again');
  console.log(JSON.stringify({checks,passed:true,productionTouched:false}));
}finally{
  if(pool)await pool.end();if(created)await owner.query(`DROP DATABASE ${name}`);if(owner)await owner.end();console.log('CLEANUP isolated database removed');
}
