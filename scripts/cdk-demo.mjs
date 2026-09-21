// Interactive local CDK demo. Actual application handlers, isolated DB, no worker/providers.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mysql from '../v1/node_modules/mysql2/promise.js';
import { createApp } from '../v1/src/app/create-app.js';
import { createDatabasePool } from '../v1/src/db/pool.js';
import { createAdminSessionAuth, hashAdminPassword } from '../v1/src/security/admin-session.js';
import { createAdminReadService } from '../v1/src/services/admin-read-service.js';
import { encryptSecret } from '../v1/src/security/secret-box.js';
import { createAdminCdkService, listCdkCodes, summarizeCdkLiability, updateCdkCodes,
  listCdkBatches, listCdkBatchOptions, updateCdkBatchMetadata, downloadCdkBatch,
  inspectCdkBatch, markCdkIssued, revokeCdkCode } from '../v1/src/services/cdk-service.js';

const uri = process.env.CDK_DEMO_DATABASE_URL;
const url = new URL(uri);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/step6_cdk_demo') throw Error('Only local step6_cdk_demo allowed');
const password = (await readFile(process.env.CDK_DEMO_PASSWORD_FILE, 'utf8')).trim();
if (!password) throw Error('Local demo password file required');
const cdkHashKey = Buffer.from(process.env.CDK_HASH_KEY_V1_BASE64, 'base64');
const cdkRecoveryKey = Buffer.from(process.env.CDK_RECOVERY_KEY_BASE64, 'base64');
const sessionEncryptionKey = Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64');
for (const key of [cdkHashKey, cdkRecoveryKey, sessionEncryptionKey]) if (key.length !== 32) throw Error('Local fixture keys required');
const setup = await mysql.createConnection({ uri: new URL('/',url).href, timezone:'Z' });
await setup.query('CREATE DATABASE IF NOT EXISTS step6_cdk_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
await setup.end();
const migration=spawn(process.execPath,['v1/scripts/migrate.js'],{env:{...process.env,MIGRATION_DATABASE_URL:uri},stdio:['ignore','pipe','pipe']});
let migrationLog='';migration.stdout.on('data',s=>{migrationLog+=s;});migration.stderr.on('data',s=>{migrationLog+=s;});
const [exitCode]=await once(migration,'exit');if(exitCode!==0)throw Error('Isolated migration failed: '+migrationLog);
const pool=createDatabasePool({url:uri,tls:{enabled:false}});
const keys={cdkHashKey,cdkRecoveryKey};
const generate=createAdminCdkService({pool,...keys});
const [[existing]]=await pool.query('SELECT COUNT(*) n FROM cdks');
if(Number(existing.n)===0){
  await generate({count:8,requestKey:randomUUID(),note:'演示·客户现买现生成'});
  await generate({count:5,requestKey:randomUUID(),issuanceKind:'RESERVE',note:'演示·手机备用'});
  await generate({count:5,requestKey:randomUUID(),issuanceKind:'MARKETPLACE',expiryMode:'NEVER',note:'演示·卡网投放'});
  for(const kind of ['expired','revoked','done','failed','processing']){
    const b=await generate({count:1,requestKey:randomUUID(),note:'演示·'+kind});
    const [rows]=await pool.query('SELECT id FROM cdks WHERE batch_no=?',[b.batchNo]);const id=rows[0].id;
    if(kind==='expired')await pool.query('UPDATE cdks SET expires_at=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?',[id]);
    else if(kind==='revoked')await revokeCdkCode(pool,id,{reason:'演示作废'});
    else{
      const oid=randomUUID();const status={done:'RECHARGE_SUCCESS',failed:'RECHARGE_FAILED',processing:'CREATED'}[kind];
      await pool.query(`INSERT INTO orders (id,public_no,cdk_id,status,customer_email,session_ciphertext,card_purchase_idempotency_key,finished_at)
        VALUES (?,?,?,?,?,?,?,?)`,[oid,'DEMO-'+oid,id,status,kind+'@example.test',encryptSecret('{}',sessionEncryptionKey),oid,kind==='processing'?null:new Date()]);
      await pool.query("UPDATE cdks SET status='REDEEMED',order_id=?,redeemed_at=CURRENT_TIMESTAMP(3) WHERE id=?",[oid,id]);
    }
  }
}
const read=createAdminReadService({pool,sessionEncryptionKey,cdkHashKey,panHmacKey:randomBytes(32),deliveryTrackingEnabled:false});
const auth=createAdminSessionAuth({passwordHash:await hashAdminPassword(password),sessionSecret:randomBytes(32),secureCookies:false});
const app=createApp({
  adminAuth:auth,
  readiness:async()=>{await pool.query('SELECT 1');return {ready:true};},
  getAdminOverview:read.getOverview,listAdminOrders:read.listOrders,getAdminOrder:read.getOrder,getAdminOrderTimeline:read.getOrderTimeline,
  createAdminCdkBatch:generate,
  listAdminCdkCodes:input=>listCdkCodes(pool,input,keys),
  summarizeAdminCdkLiability:()=>summarizeCdkLiability(pool),
  updateAdminCdkCodes:input=>updateCdkCodes(pool,input),
  listAdminCdkBatchOptions:input=>listCdkBatchOptions(pool,input),
  listAdminCdkBatches:input=>listCdkBatches(pool,input),
  updateAdminCdkBatchMetadata:(batch,input)=>updateCdkBatchMetadata(pool,batch,input),
  downloadAdminCdkBatch:batch=>downloadCdkBatch(pool,batch,cdkRecoveryKey),
  inspectAdminCdkBatch:batch=>inspectCdkBatch(pool,batch,cdkHashKey,cdkRecoveryKey),
  markAdminCdkIssued:(id,input)=>markCdkIssued(pool,id,input),
  revokeAdminCdkCode:(id,input)=>revokeCdkCode(pool,id,input)
});
const server=app.listen(8804,'127.0.0.1',()=>console.log('CDK_DEMO_READY http://127.0.0.1:8804/admin/ — isolated data; no payment/provider endpoints'));
async function stop(){server.close(async()=>{await pool.end();process.exit(0);});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
