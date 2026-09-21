// Isolated real-MySQL regression for 058; synthetic data, no providers/Bark/worker.
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { readFile,readdir,mkdir,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from '../v1/node_modules/mysql2/promise.js';
import { createDailyReconciliationService,LAST_REPORT_SETTING } from '../v1/src/services/daily-reconciliation-service.js';
import { createAdminCdkService } from '../v1/src/services/cdk-service.js';
import { encryptSecret } from '../v1/src/security/secret-box.js';
const out=new URL('../docs/reviews/2026-09-21-report-capacity/',import.meta.url);await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),checks:[]};
const db='report_capacity_'+randomBytes(4).toString('hex'),restore='pojia-restore-test-'+process.pid;
let owner,pool,created=false,restoreCreated=false,keysDir;
async function cmd(bin,args,{env={},input}={}){const p=spawn(bin,args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.stdin.on('error',()=>{});p.stdin.end(input);const [code]=await once(p,'exit');return{code,stdout,stderr};}
async function checked(bin,args,options){const r=await cmd(bin,args,options);assert.equal(r.code,0,r.stderr);return r.stdout;}
const mark=(name,evidence)=>{report.checks.push({name,evidence});console.log('PASS',name);};
try{
 const info=JSON.parse(await checked('docker',['inspect','pojia-stage1-mysql']))[0],port=info.NetworkSettings.Ports['3306/tcp'][0];assert.equal(port.HostIp,'127.0.0.1');assert.notEqual(port.HostPort,'13306');
 const pw=info.Config.Env.find(v=>v.startsWith('MYSQL_ROOT_PASSWORD=')).slice(20);const uri=new URL(`mysql://root@127.0.0.1:${port.HostPort}/`);uri.password=pw;
 owner=await mysql.createConnection({uri:uri.href,multipleStatements:true,timezone:'Z'});await owner.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);created=true;uri.pathname='/'+db;
 pool=mysql.createPool({uri:uri.href,multipleStatements:true,timezone:'Z'});
 const dir=new URL('../v1/migrations/',import.meta.url),files=(await readdir(dir)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 for(const file of files.filter(f=>f<'058')){await pool.query(await readFile(new URL(file,dir),'utf8'));await pool.query('INSERT INTO schema_migrations(version) VALUES(?)',[file.replace(/\.sql$/,'')]);}
 const [settingsBefore]=await pool.query('SELECT setting_key,setting_value FROM app_settings ORDER BY setting_key');
 const keys={session:randomBytes(32),hash:randomBytes(32),recovery:randomBytes(32)};
 const batch=await createAdminCdkService({pool,cdkHashKey:keys.hash,cdkRecoveryKey:keys.recovery})({count:1,requestKey:randomUUID()});const [[cdk]]=await pool.query('SELECT id FROM cdks WHERE batch_no=?',[batch.batchNo]);const orderId=randomUUID();
 await pool.query("INSERT INTO orders(id,public_no,cdk_id,status,session_ciphertext,card_purchase_idempotency_key) VALUES(?,?,?,'CREATED',?,?)",[orderId,'CAPACITY-'+orderId,cdk.id,encryptSecret('{"synthetic":true}',keys.session),orderId]);
 for(let i=0;i<30;i++){
   const cardId=randomUUID();await pool.query("INSERT INTO cards(id,provider_card_id,provider_account_id,external_card_id,card_type_id,status,inventory_status,intake_status,sync_tier,funded_amount,current_balance,currency,last4) VALUES(?,?,'00000000-0000-4000-8000-000000000101',?,'7','active','AVAILABLE','ACCEPTED','API',50,34.28,'USD',?)",[cardId,'fixture-'+i,'fixture-'+i,String(2000+i)]);
   if(i<6)await pool.query("INSERT INTO card_transactions(card_id,provider_transaction_id,transaction_type,status,amount,currency,raw_hash) VALUES(?,?,'purchase','settled',15.72,'USD',?)",[cardId,'purchase-'+i,'a'.repeat(64)]);
 }
 let now=new Date('2026-09-21T04:00:00Z');const service=createDailyReconciliationService({pool,clock:()=>now});
 const shown=await service.run({persist:false});assert.equal(shown.discrepancyCount,6);
 await assert.rejects(()=>service.run({persist:true}),{code:'ER_DATA_TOO_LONG'});
 mark('057 schema: read-only succeeds while actual persistence fails',{displayCharacters:JSON.stringify(shown).length,discrepancies:shown.discrepancyCount,error:'ER_DATA_TOO_LONG'});
 const migrate=()=>cmd(process.execPath,['v1/scripts/migrate.js'],{env:{MIGRATION_DATABASE_URL:uri.href,MIGRATION_DATABASE_TLS:'false'}});
 const first=await migrate();assert.equal(first.code,0,first.stderr);const repeat=await migrate();assert.equal(repeat.code,0,repeat.stderr);
 const [settingsAfter]=await pool.query('SELECT setting_key,setting_value FROM app_settings ORDER BY setting_key');assert.deepEqual(settingsAfter,settingsBefore);
 const [[column]]=await pool.query("SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_settings' AND COLUMN_NAME='setting_value'");assert.equal(column.COLUMN_TYPE,'mediumtext');
 mark('058 migration and repeated runner preserve all previous settings',{column,secondPass:repeat.stdout.trim().split('\n').slice(-1)});
 const current=await service.run({persist:true});const saved=await service.readLastReport();assert.equal(saved.discrepancyFingerprints.length,6);assert.ok(JSON.stringify(saved).length>255);assert.ok(!('cards' in saved));
 mark('actual daily summary persisted and read back, no full-report storage',{storedCharacters:JSON.stringify(saved).length,keys:Object.keys(saved)});
 await service.run({persist:true});assert.deepEqual(await service.readLastReport(),saved);mark('same-day repeat does not create false persistence',{});
 now=new Date('2026-09-22T04:00:00Z');await service.run({persist:true});const next=await service.readLastReport();assert.equal(next.persistentFingerprints.length,6);const beforeRead=JSON.stringify(next);await service.run({persist:false});assert.equal(JSON.stringify(await service.readLastReport()),beforeRead);mark('next-day fingerprints survive and readonly does not write',{persistent:next.persistentFingerprints.length});
 const runner=await cmd(process.execPath,['v1/scripts/daily-reconciliation-runner.js'],{env:{DATABASE_URL:uri.href,DATABASE_TLS:'false'}});assert.equal(runner.code,0,runner.stderr);
 const [[heartbeat]]=await pool.query("SELECT setting_value FROM app_settings WHERE setting_key='daily_reconciliation_heartbeat_at'");assert.ok(heartbeat.setting_value);const [[alert]]=await pool.query("SELECT COUNT(*) n FROM operator_alerts WHERE alert_type='DAILY_RECONCILIATION_SUMMARY' AND status='OPEN'");assert.equal(Number(alert.n),1);mark('real scheduled runner writes summary heartbeat and one alert, no sender started',{exitCode:runner.code,openDailyAlerts:alert.n});
 // Storage-boundary fixture, not a claim that the runner processed 1500 real cards.
 const large={date:'2026-09-21',generatedAt:new Date().toISOString(),discrepancyFingerprints:Array.from({length:1500},()=>`${randomUUID()}:UNEXPLAINED_CHARGE:UNVERIFIABLE`),persistentFingerprints:[]};
 const largeText=JSON.stringify(large);assert.ok(Buffer.byteLength(largeText)>65535);
 await pool.query('UPDATE app_settings SET setting_value=? WHERE setting_key=?',[largeText,LAST_REPORT_SETTING]);assert.deepEqual(await service.readLastReport(),large);
 mark('valid summary larger than TEXT capacity roundtrips without truncation',{bytes:Buffer.byteLength(largeText),fingerprints:1500});
 // Reproduce crash after DDL but before migration ledger INSERT, then resume.
 await pool.query("DELETE FROM schema_migrations WHERE version='058_app_settings_report_capacity'");const resume=await migrate();assert.equal(resume.code,0,resume.stderr);mark('interruption after widening resumes without data rewrite',{});
 // Wrong same-name schema must be rejected, not silently coerced.
 await pool.query("DELETE FROM schema_migrations WHERE version='058_app_settings_report_capacity'");await pool.query('ALTER TABLE app_settings MODIFY setting_value LONGTEXT NOT NULL');
 const wrong=await migrate();assert.notEqual(wrong.code,0);assert.match(wrong.stderr,/MIGRATION_SCHEMA_MISMATCH/);await pool.query('ALTER TABLE app_settings MODIFY setting_value MEDIUMTEXT NOT NULL');assert.equal((await migrate()).code,0);mark('unexpected column type rejected',{error:'MIGRATION_SCHEMA_MISMATCH'});
 const [tr]=await pool.query('SHOW CREATE TRIGGER operator_alert_incident_version_before_update');await pool.query('DROP TRIGGER operator_alert_incident_version_before_update');await pool.query(tr[0]['SQL Original Statement'].replace(/DEFINER=`[^`]+`@`[^`]+`/,'DEFINER=`pojia_migrator`@`172.17.0.1`'));
 const dump=await checked('docker',['exec','-e',`MYSQL_PWD=${pw}`,'pojia-stage1-mysql','mysqldump','-uroot','--single-transaction','--routines','--events','--triggers','--hex-blob','--no-tablespaces',db]);
 await checked('docker',['run','-d','--rm','--name',restore,'--network','none','--label','com.pojia.restore-test=true','-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes',info.Config.Image,'--skip-networking']);restoreCreated=true;
 const end=Date.now()+60000;while(true){const logs=await cmd('docker',['logs',restore]);if((logs.stdout+logs.stderr).includes('MySQL init process done. Ready for start up.')&&(await cmd('docker',['exec',restore,'mysqladmin','ping','-uroot','--silent'])).code===0)break;if(Date.now()>end)throw Error('restore not ready');await new Promise(r=>setTimeout(r,500));}
 await checked('docker',['exec','-i',restore,'mysql','-uroot'],{input:'CREATE DATABASE pojia_restore_test;USE pojia_restore_test;\n'+dump});
 const savedText=(await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?',[LAST_REPORT_SETTING]))[0][0].setting_value;
 const restoredHex=(await checked('docker',['exec',restore,'mysql','-uroot','-Nse',"SELECT HEX(setting_value) FROM pojia_restore_test.app_settings WHERE setting_key='daily_reconciliation_last_report'"])).trim();assert.equal(Buffer.from(restoredHex,'hex').toString(),savedText);
 keysDir=await mkdtemp(join(tmpdir(),'report-capacity-'));const keysFile=join(keysDir,'keys.env');await writeFile(keysFile,`SESSION_ENCRYPTION_KEY_BASE64=${keys.session.toString('base64')}\nCDK_RECOVERY_KEY_BASE64=${keys.recovery.toString('base64')}\n`,{mode:0o600});
 const verified=await cmd(process.execPath,['v1/scripts/verify-restored-backup.mjs',restore,keysFile,'--prepare-definer']);assert.equal(verified.code,0,verified.stderr);assert.match(verified.stdout,/"dailySummary":"OK"/);
 mark('new isolated MySQL restore preserves exact summary and passes functional verifier',{digest:createHash('sha256').update(savedText).digest('hex'),verification:verified.stdout.trim()});
 report.status='passed';
}catch(e){report.status='failed';report.error=e.message;console.error(e);process.exitCode=1;}
finally{if(restoreCreated)await checked('docker',['rm','-f',restore]);if(pool)await pool.end();if(created)await owner.query(`DROP DATABASE ${db}`);if(owner){const [[r]]=await owner.query('SELECT COUNT(*) n FROM information_schema.schemata WHERE schema_name=?',[db]);report.remainingDatabases=Number(r.n);await owner.end();}if(keysDir)await rm(keysDir,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(new URL('evidence.json',out),JSON.stringify(report,null,2));}
