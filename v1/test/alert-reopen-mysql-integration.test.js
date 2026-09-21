import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '../src/db/pool.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';

const url=process.env.ALERT_TEST_DATABASE_URL;
test('incident-aware outbox: missed close, normal updates, retries, stale callbacks and concurrent scans', {skip:!url&&'requires isolated ALERT_TEST_DATABASE_URL'}, async()=>{
  const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/step6_jfix');
  const pool=createDatabasePool({url,tls:{enabled:false}});const repo=createAlertNotificationRepository(pool);
  const ids=[];
  const make=async(type='PROVIDER_TOKEN_EXPIRED')=>{const id=randomUUID();ids.push(id);await pool.query("INSERT INTO operator_alerts(id,alert_type,dedupe_key,severity,title,message,status) VALUES (?,?,?,'warning','isolated incident','no external send','OPEN')",[id,type,id]);return id;};
  const state=async id=>(await pool.query('SELECT status,incident_version,attempt_count FROM alert_notifications WHERE alert_id=?',[id]))[0][0];
  const reopen=async id=>{await pool.query("UPDATE operator_alerts SET status='RESOLVED',acknowledged_at=CURRENT_TIMESTAMP(3) WHERE id=?",[id]);await pool.query("UPDATE operator_alerts SET status='OPEN',acknowledged_at=NULL WHERE id=?",[id]);};
  try{
    const id=await make();await repo.enqueueOpenAlerts();
    const first=await repo.claimNext();assert.equal(first.alertId,id);
    await repo.markSent(first.id,{incidentVersion:first.incidentVersion});
    // Poller never observes RESOLVED. No sleeps; clock precision must not matter.
    await reopen(id);await Promise.all([repo.enqueueOpenAlerts(),repo.enqueueOpenAlerts()]);
    assert.equal((await state(id)).status,'PENDING');assert.equal(Number((await state(id)).incident_version),2);
    const claims=await Promise.all([repo.claimNext(),repo.claimNext()]);assert.equal(claims.filter(Boolean).length,1);
    const second=claims.find(Boolean);assert.equal(second.incidentVersion,2);
    // A late response from the first generation cannot finish or fail generation two.
    assert.equal(await repo.markSent(first.id,{incidentVersion:first.incidentVersion}),false);
    await repo.markFailed(first.id,{incidentVersion:first.incidentVersion,error:new Error('stale'),retryable:false,attemptCount:1,maxAttempts:1});
    assert.equal((await state(id)).status,'SENDING');
    await repo.markSent(second.id,{incidentVersion:second.incidentVersion});
    await pool.query("UPDATE operator_alerts SET message='same incident updated' WHERE id=?",[id]);
    await repo.enqueueOpenAlerts();assert.equal((await state(id)).status,'SENT');assert.equal(await repo.claimNext(),null);
    await reopen(id);await repo.enqueueOpenAlerts();const third=await repo.claimNext();
    await repo.markFailed(third.id,{incidentVersion:third.incidentVersion,error:new Error('retry'),retryable:true,attemptCount:1,maxAttempts:3});
    await repo.enqueueOpenAlerts();assert.equal((await state(id)).status,'RETRY');
    await pool.query('UPDATE alert_notifications SET next_attempt_at=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE alert_id=?',[id]);
    const retry=await repo.claimNext();assert.equal(retry.incidentVersion,3);
    await repo.markFailed(retry.id,{incidentVersion:retry.incidentVersion,error:new Error('stop'),retryable:false,attemptCount:2,maxAttempts:3});
    await repo.enqueueOpenAlerts();assert.equal((await state(id)).status,'DEAD');assert.equal(await repo.claimNext(),null);
    await reopen(id);await repo.enqueueOpenAlerts();assert.equal((await state(id)).status,'PENDING');
    // Re-open without a scan yet: even the previous pending generation must not be claimable.
    await reopen(id);assert.equal(await repo.claimNext(),null);await repo.enqueueOpenAlerts();
    const fifth=await repo.claimNext();assert.equal(fifth.incidentVersion,5);await repo.markSent(fifth.id,{incidentVersion:5});
    await pool.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id=?",[id]);await repo.enqueueOpenAlerts();assert.equal((await state(id)).status,'CANCELLED');
    await pool.query("UPDATE operator_alerts SET status='OPEN' WHERE id=?",[id]);await repo.enqueueOpenAlerts();const sixth=await repo.claimNext();assert.equal(sixth.incidentVersion,6);await repo.markSent(sixth.id,{incidentVersion:6});
    // Actual producers use INSERT ON DUPLICATE KEY UPDATE; trigger covers that too.
    await pool.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id=?",[id]);
    await pool.query("INSERT INTO operator_alerts(id,alert_type,dedupe_key,severity,title,message,status) VALUES (?,'PROVIDER_TOKEN_EXPIRED',?,'warning','isolated','repeat','OPEN') ON DUPLICATE KEY UPDATE status=IF(status='RESOLVED','OPEN',status),acknowledged_at=NULL",[id,id]);
    await repo.enqueueOpenAlerts();const seventh=await repo.claimNext();assert.equal(seventh.incidentVersion,7);await repo.markSent(seventh.id,{incidentVersion:7});
    const silent=await make('BARK_TEST');await repo.enqueueOpenAlerts();assert.equal(await state(silent),undefined);await reopen(silent);await repo.enqueueOpenAlerts();assert.equal(await state(silent),undefined);
    // A callback that arrives after close/reopen but BEFORE the next scan is stale too.
    const inflight=await make();await repo.enqueueOpenAlerts();const old=await repo.claimNext();assert.equal(old.alertId,inflight);
    await reopen(inflight);
    assert.equal(await repo.markSent(old.id,{incidentVersion:old.incidentVersion}),false);
    await repo.enqueueOpenAlerts();assert.equal((await state(inflight)).status,'PENDING');
    const current=await repo.claimNext();assert.equal(current.incidentVersion,2);await repo.markSent(current.id,{incidentVersion:2});
  }finally{for(const id of ids){await pool.query('DELETE FROM alert_notifications WHERE alert_id=?',[id]);await pool.query('DELETE FROM operator_alerts WHERE id=?',[id]);}await pool.end();}
});
