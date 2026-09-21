// Real local MySQL outbox + real dispatcher/presenter; mocked phone transport only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import mysql from '../v1/node_modules/mysql2/promise.js';
import {createAlertNotificationRepository} from '../v1/src/db/repositories/alert-notification-repository.js';
import {dispatchOneBarkNotification} from '../v1/src/notifications/bark-dispatcher.js';
const name='bark_copy_'+crypto.randomBytes(4).toString('hex');
const info=JSON.parse(execFileSync('docker',['inspect','pojia-stage1-mysql'],{encoding:'utf8'}))[0];
const binding=info.NetworkSettings.Ports['3306/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');assert.notEqual(binding.HostPort,'13306');
const url=new URL(`mysql://root@127.0.0.1:${binding.HostPort}/`);url.password=info.Config.Env.find(x=>x.startsWith('MYSQL_ROOT_PASSWORD=')).slice('MYSQL_ROOT_PASSWORD='.length);
let owner,pool,created=false;const sent=[];let checks=0;
const pass=x=>{checks++;console.log('PASS',x)};
try{
  owner=await mysql.createConnection({uri:url.href,timezone:'Z'});await owner.query(`CREATE DATABASE ${name}`);created=true;url.pathname='/'+name;
  execFileSync(process.execPath,['v1/scripts/migrate.js'],{env:{...process.env,MIGRATION_DATABASE_URL:url.href,MIGRATION_DATABASE_TLS:'false'},stdio:['ignore','pipe','pipe']});
  pool=mysql.createPool({uri:url.href,timezone:'Z',connectionLimit:2});
  const ids={balance:crypto.randomUUID(),submitted:crypto.randomUUID(),human:crypto.randomUUID()};
  const orderId=crypto.randomUUID(),cdkId=crypto.randomUUID();
  await pool.query("INSERT INTO cdks(id,code_hash,status) VALUES (?,?,'REDEEMED')",[cdkId,crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query("INSERT INTO orders(id,public_no,cdk_id,status,session_ciphertext,card_purchase_idempotency_key,customer_email) VALUES (?,'PJV1-DEMO',?,'RECHARGE_PROCESSING',?,?,?)",[orderId,cdkId,Buffer.from('isolated-session'),orderId,'customer@example.test']);
  for(const [key,type,title,message,severity]of [
    ['balance','PROVIDER_BALANCE_CHANGED','余额发生变化','HNSKJ余额由 89.480000 USD 变为 38.730000 USD。','info'],
    ['submitted','BROWSER_ORDER_SUBMITTED','客户提交','测试来单','info'],
    ['human','BROWSER_HUMAN_REQUIRED','自动核实查不出来','订单 PJV1-DEMO｜付款后系统自己查了几次仍无法确定结果（TIMEOUT）。','critical']
  ])await pool.query("INSERT INTO operator_alerts(id,alert_type,dedupe_key,title,message,severity,status) VALUES (?,?,?,?,?,?,'OPEN')",[ids[key],type,ids[key],title,message,severity]);
  await pool.query('UPDATE operator_alerts SET order_id=? WHERE id=?',[orderId,ids.human]);
  // Old pending submission survives upgrade, but must not be claimed/sent anymore.
  await pool.query("INSERT INTO alert_notifications(alert_id,channel,status) VALUES (?,'BARK','PENDING')",[ids.submitted]);
  const repository=createAlertNotificationRepository(pool),client={send:async payload=>sent.push(payload)};
  const dispatch=()=>dispatchOneBarkNotification({repository,client});
  await dispatch();await dispatch();assert.equal((await dispatch()).handled,false);
  assert.equal(sent.length,2);assert(sent.some(p=>p.message==='89.48 → 38.73 USD'));assert(sent.some(p=>p.message.includes('勿重复付款')));pass('balance and human-required push; routine submission including old queue is silent');
  assert(sent.some(p=>p.message.startsWith('账号 customer@example.test\n')&&!p.message.includes('PJV1-DEMO')));pass('actual order-linked email flows through repository and dispatcher');
  await dispatch();assert.equal(sent.length,2);pass('same OPEN incident does not repeat');
  const [[raw]]=await pool.query('SELECT message,status FROM operator_alerts WHERE id=?',[ids.balance]);assert.equal(raw.message,'HNSKJ余额由 89.480000 USD 变为 38.730000 USD。');assert.equal(raw.status,'OPEN');pass('phone wording leaves original backend alert intact');
  await pool.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id=?",[ids.balance]);await repository.enqueueOpenAlerts();
  await pool.query("UPDATE operator_alerts SET status='OPEN' WHERE id=?",[ids.balance]);await repository.enqueueOpenAlerts();
  const [[notification]]=await pool.query('SELECT id,status,incident_version FROM alert_notifications WHERE alert_id=?',[ids.balance]);assert.equal(notification.incident_version,2);
  assert.equal(await repository.markSent(notification.id,{incidentVersion:1}),false);pass('late acknowledgement cannot mark a new incident delivered');
  await dispatch();assert.equal(sent.length,3);assert.equal((await dispatch()).handled,false);pass('recovered then recurring incident sends exactly once again');
  const [[normal]]=await pool.query('SELECT attempt_count FROM alert_notifications WHERE alert_id=?',[ids.submitted]);assert.equal(normal.attempt_count,0);pass('routine event remains recorded without phone attempts');
  console.log(JSON.stringify({checks,passed:true,actualPhoneRequests:0,database:name}));
}finally{if(pool)await pool.end();if(created)await owner.query(`DROP DATABASE ${name}`);if(owner)await owner.end();console.log('CLEANUP isolated database removed');}
