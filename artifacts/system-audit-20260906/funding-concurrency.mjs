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
 const input={attemptId:'attempt-fixture',provider:'hnskj',providerAccountId:'provider-fixture',requestKey:'fixture-idempotency-key-001',startedAt:new Date()};
 const outcomes=await Promise.allSettled([repo.begin(input),repo.begin(input)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 const [calls]=await pool.query('SELECT COUNT(*) n FROM provider_calls');assert.equal(calls[0].n,1);
 const begun=outcomes.find(x=>x.status==='fulfilled').value;
 assert.equal(begun.cardId,'internal-card-uuid');
 console.log(JSON.stringify({mode:'ISOLATED_MYSQL_MINIMAL_SCHEMA',concurrentBeginSuccesses:1,concurrentBeginRejections:1,providerIntentRows:calls[0].n,returnedCardIdentity:'internal-card-uuid',notes:'Actual repository begin with minimal schema; no Provider invoked. Not full import/assignment concurrency coverage.'},null,2));
}finally{await pool.end();}
