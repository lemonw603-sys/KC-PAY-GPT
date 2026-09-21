// Real local MySQL acceptance for D-339. Synthetic rows only; no provider/worker/payment calls.
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
  await connection.query(`INSERT INTO order_events
    (order_id,from_status,to_status,actor_type,reason,metadata_json)
    VALUES (?,'CREATED','CLOSED','SYSTEM','synthetic rehearsal',JSON_OBJECT('closeRehearsalOrder',true))`, [ids.get('closed-rehearsal')]);

  const read = createAdminReadService({ pool: connection });
  const overview = await read.getOverview();
  const sample = await read.listOrders({ status: 'RECENT_FINISHED', pageSize: 20 });
  const sampleNos = sample.orders.map((row) => row.publicNo).sort();
  console.log('SAMPLE', sampleNos.join(','));
  assert.deepEqual({
    successful: overview.metrics.recentSuccessfulOrders,
    finished: overview.metrics.recentFinishedOrders,
    rate: overview.metrics.recentSuccessRate
  }, { successful: 2, finished: 4, rate: 50 });
  pass('aggregate uses finished non-rehearsal orders in seven Beijing calendar days', '2/4 = 50%');

  assert.equal(sample.total, 4);
  assert.deepEqual(sampleNos, [
    'D339-closed-normal', 'D339-closed-success-event', 'D339-failed-inside', 'D339-success-lower'
  ]);
  pass('click-through cohort matches aggregate denominator', sampleNos.join(','));
  assert(!sample.orders.some((row) => ['D339-closed-rehearsal', 'D339-processing', 'D339-too-old', 'D339-upper-exclusive'].includes(row.publicNo)));
  pass('rehearsal, pending, lower-minus-1ms and upper boundary are excluded');

  await connection.query('DELETE FROM order_events');
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
