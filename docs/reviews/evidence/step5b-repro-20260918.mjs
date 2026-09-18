import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root='/Users/lemon/code/AI充值业务';
const require=createRequire(root+'/v1/package.json');
const mysql=require('mysql2/promise');
const {createAlertNotificationRepository}=await import(root+'/v1/src/db/repositories/alert-notification-repository.js');
const {upsertSupplyAlert,resolveSupplyAlert}=await import(root+'/v1/src/services/card-supply-scheduler-service.js');
const {reconciliationAlertPlan,createDailyReconciliationService}=await import(root+'/v1/src/services/daily-reconciliation-service.js');
const {createCardRetirementService,retirementCandidateSql}=await import(root+'/v1/src/services/card-retirement-service.js');
const info=JSON.parse(execFileSync('docker',['inspect','pojia-stage1-mysql'],{encoding:'utf8'}))[0];
const env=Object.fromEntries(info.Config.Env.map(x=>{let i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const c=await mysql.createConnection({host:'127.0.0.1',port:54186,user:'root',password:env.MYSQL_ROOT_PASSWORD,database:'mysql'});
try {
 await c.query(`CREATE TEMPORARY TABLE operator_alerts (id CHAR(36) PRIMARY KEY, alert_type VARCHAR(64), dedupe_key VARCHAR(191) UNIQUE, order_id CHAR(36), severity VARCHAR(16), title VARCHAR(255), message TEXT, status VARCHAR(24), acknowledged_at DATETIME(3),updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3))`);
 await c.query(`CREATE TEMPORARY TABLE alert_notifications (id INT AUTO_INCREMENT PRIMARY KEY,alert_id CHAR(36),channel VARCHAR(16),status VARCHAR(24),source_updated_at DATETIME(3),attempt_count INT DEFAULT 0,next_attempt_at DATETIME(3),locked_at DATETIME(3),sent_at DATETIME(3),last_error TEXT,UNIQUE KEY (alert_id,channel))`);
 const pool={query:c.query.bind(c),getConnection:async()=>({query:c.query.bind(c),beginTransaction:c.beginTransaction.bind(c),commit:c.commit.bind(c),rollback:c.rollback.bind(c),release(){}})};
 const n=createAlertNotificationRepository(pool);
 for(const [day,persistentCount] of [['2026-09-18',0],['2026-09-19',1]]){
  const plan=reconciliationAlertPlan({reconciliationDate:day,cardCount:1,discrepancyCount:1,persistentCount,pendingRegistrationCount:0,unexplainedChargeCount:0,unverifiableAmountCount:1,retirementDueCount:0});
  await upsertSupplyAlert(c,{type:'DAILY_RECONCILIATION_SUMMARY',...plan});
  await n.enqueueOpenAlerts(); const claim=await n.claimNext();if(claim)await n.markSent(claim.id);
  const [rows]=await c.query('SELECT a.severity,n.status FROM operator_alerts a JOIN alert_notifications n ON n.alert_id=a.id');
  console.log('DAILY_DELIVERY',day,JSON.stringify({claim:!!claim,rows}));
 }
 await upsertSupplyAlert(c,{type:'DAILY_RECONCILIATION_SUMMARY',key:'daily-reconciliation:2026-09-17',title:'legacy',message:'legacy'});
 await resolveSupplyAlert(c,reconciliationAlertPlan({discrepancyCount:0,pendingRegistrationCount:0,unexplainedChargeCount:0,retirementDueCount:0}).key);
 console.log('CLEAN_DAY',JSON.stringify((await c.query('SELECT dedupe_key,status FROM operator_alerts ORDER BY dedupe_key'))[0]));
} finally {await c.end();}
// Real service flow, in-memory query adapter. No database writes.
let stored=null;
const pool={query:async(sql,args=[])=>{
 if(sql.includes('SELECT c.id, c.last4'))return [[{id:'c1',last4:'0001',funded_amount:50,current_balance:35,inventory_status:'AVAILABLE',ledger_consumed:2,ledger_reconciliation:0,last_synced_at:'2026-09-17T00:00:00Z'}]];
 if(sql.includes('SELECT card_id, provider_transaction_id'))return [[{card_id:'c1',transaction_type:'PURCHASE',status:'COMPLETE',amount:15}]];
 if(sql.includes('SELECT setting_value FROM app_settings'))return [stored?[{setting_value:JSON.stringify(stored)}]:[]];
 if(sql.includes('INSERT INTO app_settings')){stored=JSON.parse(args[1]);return [{affectedRows:1}];}
 if(sql.includes('SELECT c.id, c.provider_account_id')||sql.includes('FROM card_state_events'))return [[]];
 throw new Error(sql);
}};
for(const [day,persist] of [['2026-09-18',true],['2026-09-19',false],['2026-09-19',true]]){
 const r=await createDailyReconciliationService({pool,clock:()=>new Date(day+'T04:00:00Z')}).run({persist});
 console.log('STALE_DATA',JSON.stringify({day,persist,persistentCount:r.persistentCount}));
}
const queries=[];
const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,params)=>{
 queries.push({sql,params});if(sql.includes('SELECT c.id'))return [[{id:'review-card',provider_account_id:'a',external_card_id:'x',inventory_status:'AVAILABLE',sync_tier:'MANUAL_IMPORT',source_present:1,current_balance:'20',active_assignment:0,created_at:new Date('2026-09-17T00:00:00Z')}]];
 return [{affectedRows:1}];
}};
await createCardRetirementService({pool:{getConnection:async()=>connection}}).confirmRetired({cardId:'review-card',note:'manual-used: 手动付20X',now:new Date('2026-09-18T04:00:00Z')});
console.log('MANUAL_USE',JSON.stringify({writtenInventoryStatus:queries.find(x=>x.sql.includes('UPDATE cards SET')).params[0],writtenEventType:queries.find(x=>x.sql.includes('INSERT INTO card_state_events')).params[1],candidateSqlExcludesRetired:retirementCandidateSql().includes("inventory_status <> 'RETIRED'")}));
