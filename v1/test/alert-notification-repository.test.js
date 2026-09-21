import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';

for(const failed of [false,true])test(`order email lookup happens after commit and safely falls back: failure=${failed}`,async()=>{
  let committed=false,lookups=0;
  const c={beginTransaction:async()=>{},commit:async()=>{committed=true},rollback:async()=>{},release(){},
    query:async(sql,args)=>{
      if(typeof sql==='object'){
        assert.equal(committed,true);assert.equal(sql.timeout,1500);assert.doesNotMatch(sql.sql,/FOR UPDATE/);assert.deepEqual(args,['order-id']);lookups++;
        if(failed)throw Error('read failed');return[[{public_no:'PJV1-test',customer_email:'a@example.test'}]];
      }
      if(sql.includes('FOR UPDATE'))return[[{id:1,alert_id:'a',attempt_count:0,incident_version:1,order_id:'order-id',alert_type:'BROWSER_HUMAN_REQUIRED',title:'待核',message:'原文'}]];
      return[{affectedRows:1}];
    }};
  const r=await createAlertNotificationRepository({getConnection:async()=>c}).claimNext();
  assert.equal(lookups,1);assert.equal(r.message,'原文');assert.equal(r.customerEmail,failed?null:'a@example.test');
});

test('Bark outbox sends once per open incident and only requeues after resolution', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return [{ affectedRows: 0 }, []];
    }
  };
  await createAlertNotificationRepository(pool).enqueueOpenAlerts();
  // 3 条：入队 + 复活 CANCELLED + 收掉已关闭告警的待推行。
  // D-275 ④：撤掉 DAILY_DIGEST 开关后白名单不再读 app_settings 设置，少了那次 SELECT（enqueue 行为不变）。
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT IGNORE INTO alert_notifications/);
  assert.match(calls[1].sql, /n\.status = 'CANCELLED'/);
  assert.match(calls[1].sql, /n\.incident_version < a\.incident_version/);
  assert.match(calls[1].sql, /n\.incident_version = a\.incident_version/);
  assert.doesNotMatch(calls[1].sql, /a\.acknowledged_at IS NOT NULL/);
  assert.match(calls[2].sql, /n\.status IN \('PENDING', 'RETRY', 'SENDING', 'SENT', 'DEAD'\)/);
});
