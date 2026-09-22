import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import {closeHistoricalTestCdks,TARGETS} from '../scripts/close-historical-test-cdks.mjs';

const databaseUrl=process.env.TEST_DATABASE_URL;
const productId='00000000-0000-4000-8000-000000000201';
const providerAccountId='00000000-0000-4000-8000-000000000101';

test('D-343 dry-run is read-only and apply changes only the approved CDKs and ledgers',{
  skip:!databaseUrl&&'TEST_DATABASE_URL 未配置；D-343只在隔离数据库运行'
},async()=>{
  const pool=mysql.createPool({uri:databaseUrl,connectionLimit:3,timezone:'Z'});
  const suffix=crypto.randomUUID();
  const fixtures=[];
  try{
    for(let index=0;index<TARGETS.orders.length;index++){
      const publicNo=TARGETS.orders[index],orderId=crypto.randomUUID(),cdkId=crypto.randomUUID();
      await pool.query("INSERT INTO cdks(id,code_hash,status,batch_no,plan_type,order_id,redeemed_at) VALUES(?,SHA2(?,256),'REDEEMED',?,'plus',?,CURRENT_TIMESTAMP(3))",
        [cdkId,`${suffix}:${publicNo}`,`D343-${suffix}`,orderId]);
      await pool.query("INSERT INTO orders(id,public_no,cdk_id,status,plan_type,product_id,session_ciphertext,card_purchase_idempotency_key,finished_at) VALUES(?,?,?,?,'plus',?,'fixture',?,CURRENT_TIMESTAMP(3))",
        [orderId,publicNo,cdkId,index%2?'RECHARGE_FAILED':'CLOSED',productId,`D343:${suffix}:${index}`]);
      fixtures.push({publicNo,orderId,cdkId});
    }
    for(const target of TARGETS.ledgers){
      const fixture=fixtures.find(x=>x.publicNo===target.order),attemptId=crypto.randomUUID(),cardId=crypto.randomUUID();
      await pool.query("INSERT INTO recharge_attempts(id,order_id,executor_kind,status,funds_risk_state,finished_at) VALUES(?,?,'API','FAILED','CLEARED',CURRENT_TIMESTAMP(3))",[attemptId,fixture.orderId]);
      await pool.query("INSERT INTO cards(id,provider_account_id,provider_card_id,external_card_id,card_type_id,last4,status,funded_amount,current_balance,currency,inventory_status,intake_status) VALUES(?,?,?,?,?,'0000','invalid',16,0.01,'USD','RETIRED','ACCEPTED')",
        [cardId,providerAccountId,`D343-${cardId}`,`D343-${cardId}`,'16']);
      await pool.query("INSERT INTO card_consumption_ledger(id,card_id,order_id,recharge_attempt_id,product_id,status,amount,currency) VALUES(?,?,?,?,?,'RECONCILIATION',16,'USD')",
        [target.id,cardId,fixture.orderId,attemptId,productId]);
      await pool.query("INSERT INTO provider_calls(order_id,provider,operation,request_key,attempt_no,outcome,response_summary_json,started_at,finished_at) VALUES(?,'hnskj','query_status',?,1,'SUCCESS',?,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))",
        [fixture.orderId,`D343-${fixture.orderId}`,JSON.stringify({status:'failed',paymentResult:{success:false}})]);
    }
    const before=await closeHistoricalTestCdks(pool,{apply:false});
    assert.equal(before.changedCdks,0);assert.equal(before.changedLedgers,0);
    const [[beforeCounts]]=await pool.query("SELECT SUM(status='REDEEMED') redeemed,SUM(status='REVOKED') revoked FROM cdks WHERE id IN (?)",[fixtures.map(x=>x.cdkId)]);
    assert.deepEqual([Number(beforeCounts.redeemed),Number(beforeCounts.revoked)],[16,0]);
    let backup=null;
    const applied=await closeHistoricalTestCdks(pool,{apply:true,expectedDigest:before.planDigest,backupBeforeApply:async value=>{backup=value;}});
    assert.equal(applied.changedCdks,16);assert.equal(applied.changedLedgers,2);assert.equal(applied.protectedUnchanged,true);
    assert.equal(backup.cdks.length,16);assert.equal(backup.ledgers.length,2);
    const [[afterCounts]]=await pool.query("SELECT SUM(status='REVOKED') revoked,SUM(order_id IS NOT NULL) bound FROM cdks WHERE id IN (?)",[fixtures.map(x=>x.cdkId)]);
    assert.deepEqual([Number(afterCounts.revoked),Number(afterCounts.bound)],[16,16]);
    const [[ledgerCounts]]=await pool.query("SELECT SUM(status='RELEASED') released,SUM(released_at IS NOT NULL) stamped FROM card_consumption_ledger WHERE id IN (?)",[TARGETS.ledgers.map(x=>x.id)]);
    assert.deepEqual([Number(ledgerCounts.released),Number(ledgerCounts.stamped)],[2,2]);
    const [[auditCounts]]=await pool.query("SELECT (SELECT COUNT(*) FROM cdk_admin_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))='D343-20260922-historical-test-cdks') cdk_audits,(SELECT COUNT(*) FROM order_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))='D343-20260922-historical-test-cdks') ledger_audits");
    assert.deepEqual([Number(auditCounts.cdk_audits),Number(auditCounts.ledger_audits)],[16,2]);
  }finally{
    const orderIds=fixtures.map(x=>x.orderId),cdkIds=fixtures.map(x=>x.cdkId);
    if(orderIds.length){
      await pool.query("DELETE FROM cdk_admin_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.maintenanceBatch'))=?",['D343-20260922-historical-test-cdks']);
      await pool.query('DELETE FROM order_events WHERE order_id IN (?)',[orderIds]);
      await pool.query('DELETE FROM provider_calls WHERE order_id IN (?)',[orderIds]);
      await pool.query('DELETE FROM card_consumption_ledger WHERE order_id IN (?)',[orderIds]);
      await pool.query('DELETE FROM recharge_attempts WHERE order_id IN (?)',[orderIds]);
      await pool.query('DELETE FROM cards WHERE provider_card_id LIKE ?',[`D343-%`]);
      await pool.query('DELETE FROM orders WHERE id IN (?)',[orderIds]);
      await pool.query('DELETE FROM cdks WHERE id IN (?)',[cdkIds]);
    }
    await pool.end();
  }
});
