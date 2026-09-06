import {spawn} from 'node:child_process';import {once} from 'node:events';import {createCardFundingAdminService} from '../../v1/src/services/card-funding-admin-service.js';
import mysql from '../../node_modules/mysql2/promise.js';
import assert from 'node:assert/strict';
import {createCardFundingRepository} from '../../v1/src/db/repositories/card-funding-repository.js';
const port=Number(process.env.AUDIT_MYSQL_PORT);if(!port)throw Error('explicit isolated port required');
const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:'audit_fixture',connectionLimit:4});
try{
 await pool.query('CREATE TABLE card_funding_attempts(id VARCHAR(40) PRIMARY KEY,card_id VARCHAR(40),order_id VARCHAR(40),provider_account_id VARCHAR(40),amount DECIMAL(12,6),currency VARCHAR(3),status VARCHAR(32),funds_risk_state VARCHAR(32),submit_intent_at DATETIME(3))');
 await pool.query('CREATE TABLE provider_calls(id INT AUTO_INCREMENT PRIMARY KEY, order_id VARCHAR(40),card_funding_attempt_id VARCHAR(40),provider VARCHAR(40),provider_account_id VARCHAR(40),operation VARCHAR(40),request_key VARCHAR(191),attempt_no INT,outcome VARCHAR(40),started_at DATETIME(3))');
 await pool.query("INSERT INTO card_funding_attempts VALUES ('attempt-fixture','internal-card-uuid','order-fixture','provider-fixture',12,'USD','PREPARED','NONE',NULL)");
 const repo=createCardFundingRepository(pool);
 await pool.query('ALTER TABLE card_funding_attempts ADD idempotency_key VARCHAR(191), ADD created_at DATETIME DEFAULT CURRENT_TIMESTAMP, ADD last_reconciled_at DATETIME, ADD external_reference VARCHAR(100)');
 await pool.query('CREATE TABLE cards(id VARCHAR(40) PRIMARY KEY,provider_card_id VARCHAR(40),card_type_id VARCHAR(40),funded_amount DECIMAL(12,6))');
 await pool.query("INSERT INTO cards VALUES ('internal-card-uuid','external-card-id','fixture',0)");
 const childCode=`import mysql from './node_modules/mysql2/promise.js';
 import {createCardFundingRepository} from './v1/src/db/repositories/card-funding-repository.js';
 const p=mysql.createPool({host:'127.0.0.1',port:${port},user:'root',database:'audit_fixture'});
 await createCardFundingRepository(p).begin({attemptId:'attempt-fixture',provider:'hnskj',providerAccountId:'provider-fixture',requestKey:'fixture-request-001',startedAt:new Date()});
 process.stdout.write('INTENT_COMMITTED\\n'); setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',childCode],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>{if(c!==null)reject(Error('child ended '+c))});});
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const nextPrepared=await repo.nextPrepared({providerAccountId:'provider-fixture'});
 const nextPending=await repo.nextPending({providerAccountId:'provider-fixture'});
 assert.equal(nextPrepared,null);assert.equal(nextPending,null);
 const [[state]]=await pool.query('SELECT status,funds_risk_state FROM card_funding_attempts');
 let manualCode;try{await createCardFundingAdminService({pool}).resolveUnknown({attemptId:'attempt-fixture',action:'CONFIRM_NOT_CHARGED',actorId:'fixture',note:'Synthetic crash test, no provider called',confirmation:'确认卡充值对账 attempt-fixture'});}catch(e){manualCode=e.code;}
 assert.equal(manualCode,'CARD_FUNDING_NOT_UNKNOWN');
 console.log(JSON.stringify({mode:'ISOLATED_MYSQL_REAL_CHILD_SIGKILL',state,nextPrepared,nextPending,manualCode,providerRequests:0,limits:'Minimal schema; actual repository and manual service; no external debit or full production runner.'},null,2));
}finally{await pool.end();}
