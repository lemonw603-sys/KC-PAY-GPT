// Real local MySQL acceptance for D-339 (rehearsal rule D-395). Synthetic rows only; no provider/worker/payment calls.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import mysql from '../v1/node_modules/mysql2/promise.js';
import { createAdminReadService } from '../v1/src/services/admin-read-service.js';

const name = `recent_rate_${crypto.randomBytes(4).toString('hex')}`;
const info = JSON.parse(execFileSync('docker', ['inspect', 'pojia-stage1-mysql'], { encoding: 'utf8' }))[0];
const binding = info.NetworkSettings.Ports['3306/tcp'][0];
assert.equal(binding.HostIp, '127.0.0.1');
assert.notEqual(binding.HostPort, '13306');
const url = new URL(`mysql://root@127.0.0.1:${binding.HostPort}/`);
url.password = info.Config.Env.find((entry) => entry.startsWith('MYSQL_ROOT_PASSWORD='))
  .slice('MYSQL_ROOT_PASSWORD='.length);

let owner;
let connection;
let created = false;
let checks = 0;
const pass = (name, evidence) => { checks += 1; console.log('PASS', name, evidence || ''); };

try {
  owner = await mysql.createConnection({ uri: url.href, timezone: 'Z' });
  await owner.query(`CREATE DATABASE ${name}`);
  created = true;
  url.pathname = `/${name}`;
  execFileSync(process.execPath, ['v1/scripts/migrate.js'], {
    env: { ...process.env, MIGRATION_DATABASE_URL: url.href, MIGRATION_DATABASE_TLS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  connection = await mysql.createConnection({ uri: url.href, timezone: 'Z' });
  const fixedNow = '2026-09-21T15:30:00.000Z'; // 2026-09-21 23:30 Beijing.
  await connection.query(`SET timestamp = ${Math.floor(Date.parse(fixedNow) / 1000)}`);

  const rows = [
    ['success-lower', 'RECHARGE_SUCCESS', '2026-09-14 16:00:00.000'],
    ['failed-inside', 'RECHARGE_FAILED', '2026-09-18 03:00:00.000'],
    ['closed-normal', 'CLOSED', '2026-09-19 03:00:00.000'],
    ['closed-success-event', 'CLOSED', '2026-09-20 03:00:00.000'],
    ['closed-rehearsal', 'CLOSED', '2026-09-20 04:00:00.000'],
    ['closed-marked-real', 'CLOSED', '2026-09-20 04:30:00.000'],
    ['processing', 'RECHARGE_PROCESSING', '2026-09-20 05:00:00.000'],
    ['too-old', 'RECHARGE_FAILED', '2026-09-14 15:59:59.999'],
    ['upper-exclusive', 'RECHARGE_SUCCESS', '2026-09-22 16:00:00.000']
  ];
  const ids = new Map();
  for (const [label, status, createdAt] of rows) {
    const cdkId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    ids.set(label, orderId);
    await connection.query("INSERT INTO cdks(id,code_hash,status) VALUES (?,?,'REDEEMED')", [
      cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')
    ]);
    await connection.query(`INSERT INTO orders
      (id,public_no,cdk_id,status,session_ciphertext,card_purchase_idempotency_key,created_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?)`, [
      orderId, `D339-${label}`, cdkId, status, Buffer.from('synthetic'), orderId, createdAt,
      ['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED'].includes(status) ? createdAt : null
    ]);
  }
  await connection.query(`INSERT INTO order_events
    (order_id,from_status,to_status,actor_type,reason,metadata_json)
    VALUES (?,'RECHARGE_PROCESSING','CLOSED','SYSTEM','synthetic success history',NULL)`, [ids.get('closed-success-event')]);
  await connection.query(`INSERT INTO order_events
    (order_id,from_status,to_status,actor_type,reason,metadata_json)
    VALUES (?,'RECHARGE_PROCESSING','RECHARGE_SUCCESS','SYSTEM','synthetic success history',NULL)`, [ids.get('closed-success-event')]);
  // D-395：演练按运行方判定。演练单＝只被演练程序跑过；另一张打了旧标记、却是常驻池正式跑的，必须算进样本。
  const profileId = crypto.randomUUID();
  await connection.query(`INSERT INTO executor_profiles (id, profile_code, profile_version, adapter_version, executor_kind, runtime_id)
    VALUES (?, 'd395-profile', 1, 'synthetic', 'BROWSER', 'synthetic')`, [profileId]);
  let runNo = 0;
  const runFor = async (label, workerId, lastError) => {
    const attemptId = crypto.randomUUID();
    runNo += 1;
    await connection.query("INSERT INTO recharge_attempts (id, order_id, executor_kind, status, funds_risk_state) VALUES (?, ?, 'BROWSER', 'CLEARED', 'CLEARED')", [attemptId, ids.get(label)]);
    await connection.query(`INSERT INTO browser_runs (id, recharge_attempt_id, executor_profile_id, account_key_hmac, run_no, start_operation_key, status, payment_state, worker_id, last_error_code)
      VALUES (?, ?, ?, ?, ?, ?, 'FAILED_SAFE', 'NOT_STARTED', ?, ?)`,
    [crypto.randomUUID(), attemptId, profileId, crypto.randomBytes(32).toString('hex'), runNo, `d395-${runNo}`, workerId, lastError]);
  };
  await runFor('closed-rehearsal', 'production-readonly-1', 'REHEARSAL_CLOSED');
  await runFor('closed-marked-real', 'pool:lane-1', 'REHEARSAL_CLOSED');
  await connection.query(`INSERT INTO order_events
    (order_id,from_status,to_status,actor_type,reason,metadata_json)
    VALUES (?,'CREATED','CLOSED','SYSTEM','closed with the rehearsal script but run by the pool',JSON_OBJECT('closeRehearsalOrder',true))`, [ids.get('closed-marked-real')]);

  const read = createAdminReadService({ pool: connection });
  const overview = await read.getOverview();
  const sample = await read.listOrders({ status: 'RECENT_FINISHED', pageSize: 20 });
  const sampleNos = sample.orders.map((row) => row.publicNo).sort();
  console.log('SAMPLE', sampleNos.join(','));
  assert.deepEqual({
    successful: overview.metrics.recentSuccessfulOrders,
    finished: overview.metrics.recentFinishedOrders,
    rate: overview.metrics.recentSuccessRate
  }, { successful: 2, finished: 5, rate: 40 });
  pass('aggregate uses finished non-rehearsal orders in seven Beijing calendar days', '2/5 = 40%');

  assert.equal(sample.total, 5);
  assert.deepEqual(sampleNos, [
    'D339-closed-marked-real', 'D339-closed-normal', 'D339-closed-success-event', 'D339-failed-inside', 'D339-success-lower'
  ]);
  pass('D-395: an order the pool ran counts even if the rehearsal script closed it', 'closed-marked-real in sample');
  pass('click-through cohort matches aggregate denominator', sampleNos.join(','));
  assert(!sample.orders.some((row) => ['D339-closed-rehearsal', 'D339-processing', 'D339-too-old', 'D339-upper-exclusive'].includes(row.publicNo)));
  pass('rehearsal, pending, lower-minus-1ms and upper boundary are excluded');

  await connection.query('DELETE FROM order_events');
  await connection.query('DELETE FROM browser_runs');
  await connection.query('DELETE FROM recharge_attempts');
  await connection.query('DELETE FROM orders');
  const empty = await read.getOverview();
  assert.equal(empty.metrics.recentSuccessRate, null);
  assert.equal(empty.metrics.recentFinishedOrders, 0);
  pass('zero sample returns null rate for UI dash');
  console.log(JSON.stringify({ passed: true, checks, database: name, fixedNow }));
} finally {
  if (connection) await connection.end();
  if (created) await owner.query(`DROP DATABASE ${name}`);
  if (owner) await owner.end();
  console.log('CLEANUP isolated database removed');
}
