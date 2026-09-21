// Runs the actual shell restore_test and Node verifier with synthetic backups only.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, mkdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import mysql from '../v1/node_modules/mysql2/promise.js';
import { createAdminCdkService } from '../v1/src/services/cdk-service.js';
import { encryptSecret } from '../v1/src/security/secret-box.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'pojia-restore-rehearsal-'));
const output=new URL('../docs/reviews/2026-09-21-restore-fix/',import.meta.url);await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),checks:[]};
let owner,pool,created=false,containerCreated=false;
const db='restore_fix_'+randomBytes(4).toString('hex');
const container='pojia-restore-test-'+process.pid;
const keys={session:randomBytes(32),recovery:randomBytes(32),hash:randomBytes(32)};
async function command(bin,args,{env={},input}={}){
  const child=spawn(bin,args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});child.stdin.end(input);
  const [code]=await once(child,'exit');return{code,stdout,stderr};
}
async function checked(bin,args,opts){const r=await command(bin,args,opts);assert.equal(r.code,0,r.stderr);return r.stdout;}
const mark=(name,evidence)=>{report.checks.push({name,evidence});console.log('PASS',name);};
try{
  const info=JSON.parse(await checked('docker',['inspect','pojia-stage1-mysql']))[0];
  const port=info.NetworkSettings.Ports['3306/tcp'][0];assert.equal(port.HostIp,'127.0.0.1');assert.notEqual(port.HostPort,'13306');
  const password=info.Config.Env.find(e=>e.startsWith('MYSQL_ROOT_PASSWORD=')).slice('MYSQL_ROOT_PASSWORD='.length);
  const uri=new URL(`mysql://root@127.0.0.1:${port.HostPort}/`);uri.password=password;
  owner=await mysql.createConnection({uri:uri.href});await owner.query(`CREATE DATABASE ${db}`);created=true;uri.pathname='/'+db;
  pool=mysql.createPool({uri:uri.href,timezone:'Z'});
  await checked(process.execPath,['v1/scripts/migrate.js'],{env:{MIGRATION_DATABASE_URL:uri.href,MIGRATION_DATABASE_TLS:'false'}});
  const batch=await createAdminCdkService({pool,cdkHashKey:keys.hash,cdkRecoveryKey:keys.recovery})({count:2,requestKey:randomUUID()});
  const [[cdk]]=await pool.query('SELECT id FROM cdks WHERE batch_no=? LIMIT 1',[batch.batchNo]);const oid=randomUUID();
  await pool.query("INSERT INTO orders(id,public_no,cdk_id,status,session_ciphertext,card_purchase_idempotency_key) VALUES(?,?,?,'CREATED',?,?)",[oid,'RESTORE-'+oid,cdk.id,encryptSecret(JSON.stringify({synthetic:true}),keys.session),oid]);
  const [[trigger]]=await pool.query('SHOW CREATE TRIGGER operator_alert_incident_version_before_update');
  await pool.query('DROP TRIGGER operator_alert_incident_version_before_update');
  await pool.query(trigger['SQL Original Statement'].replace(/DEFINER=`[^`]+`@`[^`]+`/,'DEFINER=`pojia_migrator`@`172.17.0.1`'));
  const dump=await checked('docker',['exec','-e',`MYSQL_PWD=${password}`,'pojia-stage1-mysql','mysqldump','-uroot','--single-transaction','--routines','--events','--triggers','--hex-blob','--no-tablespaces',db]);
  const keyFile=join(dir,'backup-key'),runtime=join(dir,'runtime.env'),badRuntime=join(dir,'wrong.env'),backup=join(dir,'synthetic.sql.gz.enc');
  await writeFile(keyFile,randomBytes(32).toString('hex'),{mode:0o600});
  const text=`SESSION_ENCRYPTION_KEY_BASE64=${keys.session.toString('base64')}\nCDK_RECOVERY_KEY_BASE64=${keys.recovery.toString('base64')}\n`;
  await writeFile(runtime,text,{mode:0o600});await writeFile(badRuntime,text.replace(keys.session.toString('base64'),randomBytes(32).toString('base64')),{mode:0o600});
  await checked('openssl',['enc','-aes-256-cbc','-salt','-pbkdf2','-iter','600000','-pass','file:'+keyFile,'-out',backup],{input:gzipSync(dump)});
  await writeFile(backup+'.sha256',createHash('sha256').update(await readFile(backup)).digest('hex')+'  '+backup+'\n');
  const ops=join(root,'deploy/server/pojia-ops.sh'),verifier=join(root,'v1/scripts/verify-restored-backup.mjs');
  // Source official functions so only fixture paths change; production CLI still requires root.
  const shell='source "$1"; backup_key="$2"; restore_keys_file="$3"; restore_verifier="$4"; restore_test "$5"';
  for(const [name,file,expected] of [['official restore success',runtime,0],['wrong key fails without OK',badRuntime,1]]){
    const r=await command('bash',['-c',shell,'restore-test',ops,keyFile,file,verifier,backup]);
    assert.equal(r.code,expected,r.stderr);if(expected===0){assert.match(r.stdout,/restore_test=OK/);assert.match(r.stdout,/"incidentVersion":2/);assert.match(r.stdout,/"definerPrepared":true/);}else{assert.doesNotMatch(r.stdout,/restore_test=OK/);assert.match(r.stderr,/RESTORE_DECRYPTION_OR_SHAPE_FAILED/);}
    mark(name,{exitCode:r.code,functional:r.stdout.split('\n').filter(l=>l.startsWith('restore_functional=')||l.startsWith('restore_test=')),error:r.stderr.trim()});
  }
  // A persistent disposable clone for negative controls of the actual verifier.
  await checked('docker',['run','-d','--rm','--name',container,'--network','none','--label','com.pojia.restore-test=true','-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes',info.Config.Image,'--skip-networking']);containerCreated=true;
  const deadline=Date.now()+60000;
  while(true){const logs=await command('docker',['logs',container]);if((logs.stdout+logs.stderr).includes('MySQL init process done. Ready for start up.')){if((await command('docker',['exec',container,'mysqladmin','ping','-uroot','--silent'])).code===0)break;}if(Date.now()>deadline)throw Error('restore startup timeout');await new Promise(r=>setTimeout(r,500));}
  const query=q=>checked('docker',['exec','-i',container,'mysql','-uroot','--batch','--skip-column-names'],{input:q});
  await query('CREATE DATABASE pojia_restore_test;');await query('USE pojia_restore_test;\n'+dump);
  const verify=(mode=[],file=runtime)=>command(process.execPath,[verifier,container,file,...mode]);
  const absent=await verify();assert.equal(absent.code,1);assert.match(absent.stderr,/RESTORE_DEFINER_MISSING/);mark('missing definer fails by default',{error:absent.stderr.trim()});
  const fixed=await verify(['--prepare-definer']);assert.equal(fixed.code,0,fixed.stderr);
  const grants=await query("SHOW GRANTS FOR 'pojia_migrator'@'172.17.0.1';SELECT account_locked FROM mysql.user WHERE User='pojia_migrator' AND Host='172.17.0.1';");
  assert.match(grants,/SELECT, UPDATE, TRIGGER/);assert.doesNotMatch(grants,/SUPER|ALL PRIVILEGES/);assert.match(grants,/Y\s*$/);mark('only locked identity and table-level privileges restored',{grants:grants.trim()});
  const again=await verify(['--prepare-definer']);assert.equal(again.code,0,again.stderr);assert.match(again.stdout,/"definerPrepared":false/);mark('repeat verification passes without changing account',{result:again.stdout.trim()});
  await chmod(runtime,0o640);const groupRead=await verify();assert.equal(groupRead.code,0,groupRead.stderr);mark('0640 runtime configuration accepted',{exitCode:groupRead.code});
  await chmod(runtime,0o644);const publicKeys=await verify();assert.equal(publicKeys.code,1);assert.match(publicKeys.stderr,/RESTORE_KEYS_FILE_PERMISSIONS/);mark('world-readable key file rejected',{error:publicKeys.stderr.trim()});await chmod(runtime,0o600);
  const wrongCdk=join(dir,'wrong-cdk.env');await writeFile(wrongCdk,text.replace(keys.recovery.toString('base64'),randomBytes(32).toString('base64')),{mode:0o600});
  const wrongBatch=await verify([],wrongCdk);assert.equal(wrongBatch.code,1);assert.match(wrongBatch.stderr,/RESTORE_DECRYPTION_OR_SHAPE_FAILED/);mark('wrong CDK recovery key rejected',{error:wrongBatch.stderr.trim()});
  await query("REVOKE UPDATE ON pojia_restore_test.operator_alerts FROM 'pojia_migrator'@'172.17.0.1';");
  const denied=await verify(['--prepare-definer']);assert.equal(denied.code,1);assert.match(denied.stderr,/RESTORE_SQL_FAILED_/);mark('existing identity with insufficient rights is rejected, not silently broadened',{error:denied.stderr.trim()});
  await query("GRANT UPDATE ON pojia_restore_test.operator_alerts TO 'pojia_migrator'@'172.17.0.1';USE pojia_restore_test;DROP TRIGGER operator_alert_incident_version_before_update;");
  const missing=await verify();assert.equal(missing.code,1);assert.match(missing.stderr,/RESTORE_TRIGGER_MISMATCH/);mark('057 ledger without trigger fails',{error:missing.stderr.trim()});
  await query('USE pojia_restore_test;'+trigger['SQL Original Statement'].replace(/DEFINER=`[^`]+`@`[^`]+`/,'DEFINER=`unexpected_restore_user`@`localhost`')+';');
  const unknown=await verify(['--prepare-definer']);assert.equal(unknown.code,1);assert.match(unknown.stderr,/RESTORE_UNEXPECTED_DEFINER/);mark('unknown definer is not automatically created',{error:unknown.stderr.trim()});
  await query('USE pojia_restore_test;DROP TRIGGER operator_alert_incident_version_before_update;');
  await query("USE pojia_restore_test;DELETE FROM schema_migrations WHERE version='057_alert_incident_version';");
  const partial=await verify();assert.equal(partial.code,1);assert.match(partial.stderr,/RESTORE_PARTIAL_057/);mark('half-migrated schema cannot masquerade as pre057',{error:partial.stderr.trim()});
  // Old 054 backup requires no trigger; it still must prove business reads/decryption.
  await query("USE pojia_restore_test;DELETE FROM schema_migrations WHERE version='057_alert_incident_version';ALTER TABLE operator_alerts DROP COLUMN incident_version;ALTER TABLE alert_notifications DROP COLUMN incident_version;");
  const old=await verify();assert.equal(old.code,0,old.stderr);assert.match(old.stdout,/NOT_APPLICABLE_PRE057/);mark('pre057 backup explicitly reports trigger not applicable',{result:old.stdout.trim()});
  // Missing sample is exercised using an empty application schema copy in unit-independent SQL.
  await query('USE pojia_restore_test;DELETE FROM orders;');
  const empty=await verify();assert.equal(empty.code,1);assert.match(empty.stderr,/RESTORE_DECRYPTION_SAMPLE_MISSING/);mark('no decryption sample cannot masquerade as verified',{error:empty.stderr.trim()});
  report.status='passed';
}catch(e){report.status='failed';report.error=e.message;console.error(e);process.exitCode=1;}
finally{
  if(containerCreated)await checked('docker',['rm','-f',container]);if(pool)await pool.end();if(created)await owner.query(`DROP DATABASE ${db}`);
  if(owner){const [[r]]=await owner.query('SELECT COUNT(*) n FROM information_schema.schemata WHERE schema_name=?',[db]);report.databasesRemaining=Number(r.n);await owner.end();}
  await rm(dir,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(new URL('evidence.json',output),JSON.stringify(report,null,2));
}
