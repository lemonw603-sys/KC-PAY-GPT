// Local-only diagnostics. Exercises real migrations and Session replacement; no provider/worker.
// Usage: REHEARSAL_MYSQL_URL=<local root URI> node scripts/step6-prepublish-rehearsal.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from '../v1/node_modules/mysql2/promise.js';
import { createDatabasePool } from '../v1/src/db/pool.js';
import { createAdminCdkService } from '../v1/src/services/cdk-service.js';
import { createSessionReplacementService } from '../v1/src/services/session-replacement-service.js';
import { createWorkflowRepository } from '../v1/src/db/repositories/workflow-repository.js';
import { createWorkflowHandlers } from '../v1/src/workers/workflow-handlers.js';
import { claimNextTask, completeTask } from '../v1/src/db/repositories/task-repository.js';
import { step6MigrationPlan } from '../v1/src/db/step6-migration-guard.js';
import { eligibleInventoryCardSql } from '../v1/src/services/card-inventory-eligibility.js';
import { sessionFixture } from '../v1/test-support/session-fixture.js';
import { encryptSecret } from '../v1/src/security/secret-box.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../output/step6-prepublish/', import.meta.url);
const rootUrl = new URL(process.env.REHEARSAL_MYSQL_URL);
const expectFixed = process.env.EXPECT_RECOVERY_FIXED === '1';
assert.equal(rootUrl.hostname, '127.0.0.1');
assert.ok(rootUrl.port && rootUrl.port !== '13306', 'production tunnel forbidden');
const databases = [], connections = [];
const suffix = randomBytes(4).toString('hex');
const username = `step6_gate_${suffix}`;
const password = randomBytes(24).toString('hex');
const revision = await command('git', ['rev-parse', 'HEAD']);
const sourceDiff = await command('git', ['diff', '--name-only', '--', 'v1']);
const report = { startedAt: new Date().toISOString(), baselineCommit: revision.stdout.trim(),
  sourceWorkingTreeDiff: sourceDiff.stdout.trim(), migrations: [], sessionRecovery: [], databases, testAccount: username };
let owner, accountCreated = false;
await mkdir(output, { recursive: true });
const save = () => writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
async function command(bin, args, env = {}) {
  const child = spawn(bin, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const [code] = await once(child, 'exit'); return { code, stdout, stderr };
}
function uri(db, restricted = false) {
  const u = new URL(rootUrl); u.pathname = '/' + db;
  if (restricted) { u.username = username; u.password = password; }
  return u.href;
}
async function connect(db) {
  const c = await mysql.createConnection({ uri: uri(db), multipleStatements: true, timezone: 'Z' }); connections.push(c); return c;
}
async function makeDb(tag, dump = null) {
  const name = `step6_gate_${suffix}_${tag}`;
  await owner.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databases.push(name); await save();
  const c = await connect(name); if (dump) await c.query(dump); return { name, c };
}
const migrationDir = new URL('../v1/migrations/', import.meta.url);
const all = (await readdir(migrationDir)).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
const pending = await Promise.all(all.filter(f => /^(055|056|057)_/.test(f)).map(async file => ({ file, sql: await readFile(new URL(file,migrationDir),'utf8') })));
// These seven additive DDL statements have no semicolons inside quoted literals.
const statements = pending.flatMap(m => m.sql.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(sql=>({file:m.file,sql})));
assert.equal(statements.length,7);
async function runner(db, restricted = false) {
  const result = await command(process.execPath,['v1/scripts/migrate.js'],{ MIGRATION_DATABASE_URL:uri(db,restricted), MIGRATION_DATABASE_TLS:'false' });
  return { exitCode:result.code, error:result.stderr.match(/code: '([^']+)'/)?.[1] || (result.code ? 'RUNNER_FAILED' : null),
    output:result.stdout.trim().split('\n').slice(-4),
    errno:Number(result.stderr.match(/errno: (\d+)/)?.[1]) || null };
}
async function snapshot(c) {
  const [versions] = await c.query("SELECT version FROM schema_migrations WHERE version >= '055' ORDER BY version");
  const [columns] = await c.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN ('issued_at','expires_at','issuance_kind','generation_fingerprint','incident_version') ORDER BY TABLE_NAME,COLUMN_NAME");
  const [triggers] = await c.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
  return { versions:versions.map(r=>r.version), columns, triggers:triggers.map(r=>r.TRIGGER_NAME) };
}
try {
  const port=await command('docker',['port','pojia-stage1-mysql','3306/tcp']);
  assert.equal(port.code,0);assert.ok(port.stdout.includes(`127.0.0.1:${rootUrl.port}`));
  owner=await mysql.createConnection({uri:rootUrl.href,multipleStatements:true,timezone:'Z'});
  const [[settings]]=await owner.query('SELECT @@version AS version,@@log_bin AS log_bin,@@log_bin_trust_function_creators AS trust_creators');
  report.mysql=settings;assert.equal(Number(settings.log_bin),1);assert.equal(Number(settings.trust_creators),0);
  const baseline=await makeDb('base');
  for(const file of all.filter(f=>f<'055')){
    await baseline.c.query(await readFile(new URL(file,migrationDir),'utf8'));
    await baseline.c.query('INSERT INTO schema_migrations(version) VALUES (?)',[file.replace(/\.sql$/,'')]);
  }
  // Sentinel verifies new migrations do not silently rewrite old code state.
  const sentinel=randomUUID();
  await baseline.c.query("INSERT INTO cdks(id,code_hash,status) VALUES (?,?,'AVAILABLE')",[sentinel,randomBytes(32).toString('hex')]);
  const dumpResult=await command('docker',['exec','-e',`MYSQL_PWD=${decodeURIComponent(rootUrl.password)}`,'pojia-stage1-mysql','mysqldump','-u',decodeURIComponent(rootUrl.username),'--single-transaction','--no-tablespaces','--set-gtid-purged=OFF',baseline.name]);
  assert.equal(dumpResult.code,0);const dump=dumpResult.stdout;
  await owner.query('CREATE USER ?@? IDENTIFIED BY ?',[username,'%',password]);accountCreated=true;
  const limited=await makeDb('limited',dump);
  await owner.query(`GRANT ALL PRIVILEGES ON \`${limited.name}\`.* TO ?@?`,[username,'%']);
  const first=await runner(limited.name,true);
  const afterFailure=await snapshot(limited.c);
  if(expectFixed){assert.equal(first.error,'MIGRATION_TRIGGER_PRIVILEGE_REQUIRED');assert.deepEqual(afterFailure,await snapshot(baseline.c),'preflight must make zero schema changes');}
  const retryLimited=await runner(limited.name,true);
  const retryRoot=await runner(limited.name,false);
  if(expectFixed)assert.equal(retryRoot.exitCode,0);
  report.migrations.push({scenario:'production-like schema privileges',first,afterFailure,retryLimited,retryRoot});
  console.log('limited account:',first.error,'retry:',retryLimited.error);await save();

  const clean=await makeDb('clean',dump);
  const complete=await runner(clean.name);const repeated=await runner(clean.name);
  assert.equal(complete.exitCode,0);assert.equal(repeated.exitCode,0);
  const [[legacy]]=await clean.c.query('SELECT status,issued_at,expires_at,issuance_kind FROM cdks WHERE id=?',[sentinel]);
  assert.deepEqual(legacy,{status:'AVAILABLE',issued_at:null,expires_at:null,issuance_kind:'LEGACY'});
  report.migrations.push({scenario:'privileged clean run and repeat',complete,repeated,legacy,final:await snapshot(clean.c)});
  console.log('clean privileged run and completed rerun: pass');
  for(let cut=1;cut<=statements.length;cut++){
    const scenario=await makeDb('cut'+cut,dump);
    for(let i=0;i<cut;i++){
      await scenario.c.query(statements[i].sql);
      // All fully finished earlier files have ledger records. Target file does not:
      // this also covers a crash after its last DDL but before its version INSERT.
      if(i<cut-1 && statements[i+1]?.file!==statements[i].file){
        await scenario.c.query('INSERT INTO schema_migrations(version) VALUES (?)',[statements[i].file.replace(/\.sql$/,'')]);
      }
    }
    const resumed=await runner(scenario.name);
    if(expectFixed)assert.equal(resumed.exitCode,0,`original DDL cut ${cut}`);
    report.migrations.push({scenario:`interrupted after DDL ${cut}/7`,file:statements[cut-1].file,resumed,final:await snapshot(scenario.c)});
    console.log('DDL cut',cut,'resume:',resumed.exitCode===0?'pass':resumed.error);await save();
  }

  if(expectFixed){
    const steps=pending.flatMap(m=>step6MigrationPlan(m.file,m.sql).map(s=>({file:m.file,sql:s.sql})));
    for(let cut=1;cut<=steps.length;cut++){
      const scenario=await makeDb('step'+cut,dump);
      for(let i=0;i<cut;i++){
        await scenario.c.query(steps[i].sql);
        if(i<cut-1&&steps[i+1]?.file!==steps[i].file)await scenario.c.query('INSERT INTO schema_migrations(version) VALUES (?)',[steps[i].file.replace(/\.sql$/,'')]);
      }
      const resumed=await runner(scenario.name);assert.equal(resumed.exitCode,0,`new granular cut ${cut}`);
      report.migrations.push({scenario:`granular step ${cut}/${steps.length}`,resumed});
      console.log('granular cut',cut,'pass');await save();
    }
    for(const kind of ['column','index','trigger']){
      const bad=await makeDb('bad_'+kind,dump);
      if(kind==='column')await bad.c.query('ALTER TABLE cdks ADD COLUMN issued_at VARCHAR(30) NULL');
      if(kind==='index'){
        await bad.c.query('ALTER TABLE cdks ADD COLUMN issued_at TIMESTAMP(3) NULL DEFAULT NULL');
        await bad.c.query('ALTER TABLE cdks ADD KEY idx_cdks_status_issued(status)');
      }
      if(kind==='trigger'){
        await bad.c.query('ALTER TABLE operator_alerts ADD COLUMN incident_version INT UNSIGNED NOT NULL DEFAULT 1');
        await bad.c.query('ALTER TABLE alert_notifications ADD COLUMN incident_version INT UNSIGNED NOT NULL DEFAULT 1');
        await bad.c.query('CREATE TRIGGER operator_alert_incident_version_before_update BEFORE UPDATE ON operator_alerts FOR EACH ROW SET NEW.incident_version=OLD.incident_version');
      }
      const before=await snapshot(bad.c);const result=await runner(bad.name);assert.equal(result.error,'MIGRATION_SCHEMA_MISMATCH');assert.deepEqual(await snapshot(bad.c),before);
      report.migrations.push({scenario:`reject wrong ${kind} without writes`,result});
    }
    const held=await makeDb('locked',dump);
    const lockName=`pojia-migrate:${createHash('sha256').update(held.name).digest('hex').slice(0,32)}`;
    await held.c.query('SELECT GET_LOCK(?,0)',[lockName]);
    const locked=await runner(held.name);assert.equal(locked.error,'MIGRATION_ALREADY_RUNNING');
    await held.c.query('SELECT RELEASE_LOCK(?)',[lockName]);report.migrations.push({scenario:'concurrent migration rejected',result:locked});
  }

  const pool=createDatabasePool({url:uri(clean.name),tls:{enabled:false}});connections.push(pool);
  const key=randomBytes(32), hash=randomBytes(32), recovery=randomBytes(32);
  const create=createAdminCdkService({pool,cdkHashKey:hash,cdkRecoveryKey:recovery});
  const replace=createSessionReplacementService({pool,sessionEncryptionKey:key,cdkHashKey:hash});
  const provider='00000000-0000-4000-8000-000000000101';
  const card=randomUUID();
  await pool.query(`INSERT INTO cards(id,provider_account_id,provider_card_id,external_card_id,card_type_id,last4,status,
    inventory_status,intake_status,sync_tier,funded_amount,current_balance,currency,refund_status,card_credentials_ciphertext,last_transaction_synced_at)
    VALUES (?,?,?,?,'7','4242','active','AVAILABLE','ACCEPTED','AVAILABLE',50,50,'USD','MONITORING',?,CURRENT_TIMESTAMP(3))`,
  [card,provider,card,card,encryptSecret(JSON.stringify({cardNumber:'4242424242424242',cvv:'123',expMonth:12,expYear:2032}),key)]);
  const [[eligible]]=await pool.query(`SELECT COUNT(*) n FROM cards c WHERE c.id=? AND ${eligibleInventoryCardSql('c','16')}`,[card]);
  assert.equal(Number(eligible.n),1);
  const workflow=createWorkflowRepository(pool,{sessionEncryptionKey:key});
  const handlers=createWorkflowHandlers({workflow,rechargeAttemptRepository:{},cardProvider:{},rechargeProvider:{},recordCall:()=>{throw Error('provider forbidden');}});
  for(const scenario of ['no-assignment-task','completed-assignment-task',...(expectFixed?['expired-assignment-lease','live-assignment-lease','unknown-funds']:[]),'already-has-card']){
    const b=await create({count:1,requestKey:randomUUID()});
    const [[cdk]]=await pool.query('SELECT id FROM cdks WHERE batch_no=?',[b.batchNo]);
    const order=randomUUID(), publicNo='PJV1-'+randomBytes(15).toString('base64url');
    const assigned=scenario==='already-has-card'?card:null;
    await pool.query(`INSERT INTO orders(id,public_no,cdk_id,status,session_ciphertext,card_purchase_idempotency_key,
      product_id,fulfillment_route_id,frozen_card_provider_account_id,route_resolution_status,assigned_card_id,
      card_type_id,open_card_amount,minimum_required_card_balance)
      VALUES (?,?,?,'WAITING_FOR_SESSION',?,?, '00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301',?,'RESOLVED',?,'7',16,16)`,
    [order,publicNo,cdk.id,encryptSecret(JSON.stringify(sessionFixture()),key),order,provider,assigned]);
    await pool.query("UPDATE cdks SET status='REDEEMED',order_id=? WHERE id=?",[order,cdk.id]);
    for(const type of ['PREPARE_RECHARGE','SUBMIT_RECHARGE']) await pool.query("INSERT INTO tasks(order_id,task_type,status,dedupe_key,max_attempts) VALUES (?,?,'DEAD',?,5)",[order,type,type.toLowerCase().replaceAll('_','-')+':'+order]);
    if(scenario==='completed-assignment-task')await pool.query("INSERT INTO tasks(order_id,task_type,status,dedupe_key,max_attempts) VALUES (?,'ASSIGN_CARD','COMPLETED',?,10080)",[order,'assign-card:'+order]);
    if(scenario==='expired-assignment-lease'||scenario==='live-assignment-lease'){
      await pool.query(`INSERT INTO tasks(order_id,task_type,status,dedupe_key,max_attempts,leased_by,leased_until)
        VALUES (?,'ASSIGN_CARD','RUNNING',?,10080,'other-worker',DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND))`,[order,'assign-card:'+order,scenario==='live-assignment-lease'?3600:-1]);
    }
    if(scenario==='unknown-funds')await pool.query("INSERT INTO recharge_attempts(id,order_id,executor_kind,status,funds_risk_state) VALUES (?,?,'API','UNKNOWN','UNKNOWN')",[randomUUID(),order]);
    if(scenario==='live-assignment-lease'||scenario==='unknown-funds'){
      const before=(await pool.query('SELECT task_type,status,leased_by,leased_until FROM tasks WHERE order_id=? ORDER BY id',[order]))[0];
      const code=scenario==='live-assignment-lease'?'SESSION_REPLACEMENT_CONFLICT':'FUNDS_STATE_UNSAFE';
      await assert.rejects(()=>replace({publicNo,session:sessionFixture()}),{code,status:409});
      assert.deepEqual((await pool.query('SELECT task_type,status,leased_by,leased_until FROM tasks WHERE order_id=? ORDER BY id',[order]))[0],before);
      const [[unchanged]]=await pool.query('SELECT status,session_replacement_count FROM orders WHERE id=?',[order]);
      assert.equal(unchanged.status,'WAITING_FOR_SESSION');assert.equal(Number(unchanged.session_replacement_count),0);
      report.sessionRecovery.push({scenario,rejected:code,orderAndTasksUnchanged:true});console.log('session guard:',scenario,'pass');await save();continue;
    }
    const response=await replace({publicNo,session:sessionFixture()});
    const [[state]]=await pool.query('SELECT status,assigned_card_id FROM orders WHERE id=?',[order]);
    const [tasks]=await pool.query('SELECT task_type,status FROM tasks WHERE order_id=? ORDER BY task_type',[order]);
    const claim=await claimNextTask(pool,{workerId:'isolated-rehearsal',allowedTaskTypes:['ASSIGN_CARD'],allowedRechargeExecutorKinds:['API'],rechargeDispatchMode:'AUTOMATIC'});
    let preparation=null,afterAssignment=null;
    if(!assigned){try{await handlers.PREPARE_RECHARGE({order_id:order,attempts:1});preparation='unexpected success';}catch(e){preparation=e.code||e.message;}}
    if(expectFixed&&!assigned){
      assert.ok(claim);assert.equal(claim.order_id,order);assert.equal(tasks.filter(t=>t.task_type==='ASSIGN_CARD').length,1);
      assert.ok(tasks.filter(t=>['PREPARE_RECHARGE','SUBMIT_RECHARGE'].includes(t.task_type)).every(t=>t.status==='DEAD'));
      const early=await claimNextTask(pool,{workerId:'early-prepare',allowedTaskTypes:['PREPARE_RECHARGE'],allowedRechargeExecutorKinds:['API'],rechargeDispatchMode:'AUTOMATIC'});assert.equal(early,null);
      await assert.rejects(()=>replace({publicNo,session:sessionFixture()}),{code:'SESSION_REPLACEMENT_NOT_ALLOWED'});
      await handlers.ASSIGN_CARD(claim);
      await completeTask(pool,{taskId:claim.id,workerId:'isolated-rehearsal'});
      const [[done]]=await pool.query('SELECT status,assigned_card_id FROM orders WHERE id=?',[order]);assert.equal(done.status,'CARD_READY');assert.ok(done.assigned_card_id);
      const next=await claimNextTask(pool,{workerId:'isolated-prepare',allowedTaskTypes:['PREPARE_RECHARGE'],allowedRechargeExecutorKinds:['API'],rechargeDispatchMode:'AUTOMATIC'});assert.equal(next.order_id,order);
      afterAssignment={orderStatus:done.status,hasAssignedCard:true,preparationTaskClaimed:true};
      // Release only fixture allocations for the next independent scenario, not a business API.
      await pool.query("UPDATE card_assignment_history SET status='RELEASED',released_at=CURRENT_TIMESTAMP(3) WHERE order_id=?",[order]);
      await pool.query("UPDATE card_consumption_ledger SET status='RELEASED' WHERE order_id=?",[order]);
    }
    report.sessionRecovery.push({scenario,responseStatus:response.status,orderStatus:state.status,hasAssignedCard:!!state.assigned_card_id,tasks,assignTaskClaimed:!!claim,eligibleCardCount:Number(eligible.n),preparation,afterAssignment});
    console.log('session:',scenario,'state:',state.status,'assign-task:',!!claim,'prepare:',preparation);await save();
  }
  report.finishedAt=new Date().toISOString();report.status=expectFixed?'recovery checks passed':'diagnostics completed';
}catch(error){report.status='harness failed';report.error={code:error.code||error.name,message:error.code?undefined:error.message};process.exitCode=1;console.error(report.error);}
finally{
  for(const c of connections.reverse())await c.end().catch(()=>{});
  if(owner){
    for(const db of databases.reverse())await owner.query(`DROP DATABASE \`${db}\``);
    if(accountCreated)await owner.query('DROP USER ?@?',[username,'%']);
    await owner.end();
  }
  report.cleanedUp=true;await save();console.log('local-only rehearsal finished; owned databases/account removed');
}
