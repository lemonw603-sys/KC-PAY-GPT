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
  async function addAlert(type,key,title,severity='warning') {
    const id=crypto.randomUUID();await pool.query("INSERT INTO operator_alerts(id,alert_type,dedupe_key,title,message,severity,status) VALUES (?,?,?,?,?,?,'OPEN')",[id,type,key,title,'isolated',severity]);return id;
  }
  async function pair(account=crypto.randomUUID()) {
    const soft=await addAlert('PROVIDER_WALLET_LOW',`provider-wallet-low:${account}`,'soft-wallet');
    const hard=await addAlert('CARD_SUPPLY_WALLET_LOW',`card-supply-wallet-low:${account}`,'hard-wallet','critical');
    await repository.enqueueOpenAlerts();return{soft,hard};
  }
  async function resolveAlerts(list) {await pool.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id IN (?)",[list]);await repository.enqueueOpenAlerts();}
  const first=await pair();let previous=sent.length;
  await dispatch();assert.equal(sent.length,previous+1);assert.equal(sent.at(-1).title,'hard-wallet');assert.equal((await dispatch()).handled,false);
  const [[softPending]]=await pool.query('SELECT a.status,n.attempt_count FROM operator_alerts a JOIN alert_notifications n ON n.alert_id=a.id WHERE a.id=?',[first.soft]);assert.equal(softPending.status,'OPEN');assert.equal(softPending.attempt_count,0);pass('same account hard wallet notice covers softer warning without changing its alert');
  const other=await addAlert('PROVIDER_WALLET_LOW',`provider-wallet-low:${crypto.randomUUID()}`,'other-wallet');await dispatch();assert.equal(sent.at(-1).title,'other-wallet');pass('different account warning remains independent');
  const money=await addAlert('PROVIDER_BALANCE_CHANGED',crypto.randomUUID(),'balance-kept','info');await dispatch();assert.equal(sent.at(-1).title,'balance-kept');pass('balance changes remain eligible even while wallet warnings are covered');
  const chargeback=await addAlert('CARD_CHARGEBACK',crypto.randomUUID(),'chargeback-kept','critical');await dispatch();assert.equal(sent.at(-1).title,'chargeback-kept');pass('chargeback is never covered');
  await resolveAlerts([first.hard]);await dispatch();assert.equal(sent.at(-1).title,'soft-wallet');pass('remaining low-balance warning becomes eligible when hard issue resolves');
  await resolveAlerts([first.soft,other,money,chargeback]);
  for(const status of ['RETRY','DEAD']){
    const p=await pair();await pool.query('UPDATE alert_notifications SET status=?,next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE alert_id=?',[status,p.hard]);
    await dispatch();assert.equal(sent.at(-1).title,'soft-wallet');pass(`failed primary ${status} does not silence fallback warning`);await resolveAlerts([p.soft,p.hard]);
  }
  const old=await pair();await pool.query("UPDATE alert_notifications SET status='SENT' WHERE alert_id=?",[old.hard]);
  await pool.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id=?",[old.hard]);await pool.query("UPDATE operator_alerts SET status='OPEN' WHERE id=?",[old.hard]);
  const uncovered=await repository.claimNext();assert.equal(uncovered.alertId,old.soft);await repository.markSent(uncovered.id,{incidentVersion:uncovered.incidentVersion});pass('previous incident delivery cannot cover a new incident before enqueue catches up');await resolveAlerts([old.soft,old.hard]);
  const malformed=await pair('legacy-account');await pool.query("UPDATE alert_notifications SET status='SENT' WHERE alert_id=?",[malformed.hard]);
  const unknown=await repository.claimNext();assert.equal(unknown.alertId,malformed.soft);await repository.markSent(unknown.id,{incidentVersion:unknown.incidentVersion});pass('unrecognized account-key shape stays visible');await resolveAlerts([malformed.soft,malformed.hard]);
  const newer=await pair();await pool.query("UPDATE alert_notifications SET status='SENT' WHERE alert_id=?",[newer.hard]);
  await pool.query('UPDATE operator_alerts SET updated_at=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?',[newer.soft]);
  const newerClaim=await repository.claimNext();assert.equal(newerClaim.alertId,newer.soft);await repository.markSent(newerClaim.id,{incidentVersion:newerClaim.incidentVersion});pass('stale primary cannot hide a newer wallet observation');await resolveAlerts([newer.soft,newer.hard]);
  const concurrent=await pair();const claims=await Promise.all([repository.claimNext(),repository.claimNext()]);
  assert.equal(claims.filter(Boolean).length,1);assert.equal(claims.find(Boolean).alertId,concurrent.hard);pass('concurrent claimers do not claim the covered soft warning');await resolveAlerts([concurrent.soft,concurrent.hard]);
  console.log(JSON.stringify({checks,passed:true,actualPhoneRequests:0,database:name}));
}finally{if(pool)await pool.end();if(created)await owner.query(`DROP DATABASE ${name}`);if(owner)await owner.end();console.log('CLEANUP isolated database removed');}
