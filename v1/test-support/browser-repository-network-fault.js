#!/usr/bin/env node
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const durationMs = Number(process.env.NETWORK_FAULT_DURATION_MS || 20000);
const routeId = '00000000-0000-4000-8000-000000000302';
const productId = '00000000-0000-4000-8000-000000000201';
const suffix = crypto.randomUUID();
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, connectTimeout: 3000 });
const admin = mysql.createPool({ uri: databaseUrl, connectionLimit: 1, connectTimeout: 3000 });
const rows = [];
const errors = [];
let claimed = 0;
let heartbeats = 0;
let killed = 0;
let injections = 0;
let stop = false;

async function createJob(index) {
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  rows.push({ cdkId, orderId, attemptId });
  await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')', [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(`INSERT INTO orders
    (id, public_no, cdk_id, status, session_ciphertext, card_purchase_idempotency_key,
     product_id, fulfillment_route_id, route_resolution_status)
    VALUES (?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, 'RESOLVED')`,
  [orderId, `NET-${suffix}-${index}`, cdkId, Buffer.from('repository-network-fault'), `net-${suffix}-${index}`, productId, routeId]);
  await pool.query(`INSERT INTO recharge_attempts
    (id, order_id, fulfillment_route_id, executor_kind, status, funds_risk_state, idempotency_key)
    VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?)`,
  [attemptId, orderId, routeId, `net-${suffix}-${index}`]);
  await pool.query(`INSERT INTO browser_dispatch_jobs
    (job_key, recharge_attempt_id, order_id, executor_profile_id, status, queued_at)
    VALUES (?, ?, ?, NULL, 'QUEUED', NOW())`, [`net-job-${suffix}-${index}`, attemptId, orderId]);
}

async function worker(index) {
  const repository = createBrowserDispatchRepository(pool);
  while (!stop) {
    try {
      const job = await repository.claim({ workerId: `net-worker-${index}`, leaseSeconds: 120 });
      if (!job) { await new Promise((resolve) => setTimeout(resolve, 10)); continue; }
      claimed += 1;
      await repository.heartbeat({ jobId: job.jobId, workerId: job.leaseOwner, leaseToken: job.leaseToken, leaseSeconds: 120 });
      heartbeats += 1;
    } catch (error) {
      errors.push({ code: error?.code || 'UNKNOWN', message: error?.message || String(error) });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

async function injectKills(until, adminId) {
  while (Date.now() < until && !stop) {
    injections += 1;
    try {
      const [processes] = await admin.query('SHOW PROCESSLIST');
      const victims = processes.filter((row) => Number(row.Id) !== adminId && row.db === 'pojia_test')
        .map((row) => Number(row.Id)).filter(Number.isInteger).slice(0, 2);
      for (const id of victims) { await admin.query(`KILL CONNECTION ${id}`).catch(() => {}); killed += 1; }
    } catch (error) { errors.push({ code: error?.code || 'ADMIN_ERROR', message: error?.message || String(error) }); }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function cleanup() {
  const fresh = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, connectTimeout: 3000 });
  try {
    for (const row of rows) {
      await fresh.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [row.attemptId]);
      await fresh.query('DELETE FROM recharge_attempts WHERE id = ?', [row.attemptId]);
      await fresh.query('DELETE FROM orders WHERE id = ?', [row.orderId]);
      await fresh.query('DELETE FROM cdks WHERE id = ?', [row.cdkId]);
    }
    const [[dispatch]] = await fresh.query('SELECT COUNT(*) AS count FROM browser_dispatch_jobs WHERE job_key LIKE ?', [`net-job-${suffix}-%`]);
    return Number(dispatch.count);
  } finally { await fresh.end(); }
}

try {
  const [[before]] = await pool.query('SELECT COUNT(*) AS count FROM browser_dispatch_jobs');
  if (Number(before.count) !== 0) throw new Error(`requires empty dispatch queue; found ${before.count}`);
  for (let index = 0; index < 80; index += 1) await createJob(index);
  const [[identity]] = await admin.query('SELECT CONNECTION_ID() AS id');
  const workers = Promise.all(Array.from({ length: 4 }, (_, index) => worker(index)));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await injectKills(Date.now() + Math.min(7000, durationMs / 2), Number(identity.id));
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, durationMs - 10000)));
  stop = true;
  await workers;
  const residual = await cleanup();
  const result = { scenario: 'repository-only-network-connection-fault', durationMs, created: rows.length, claimed, heartbeats, injections, killed, residualDispatch: residual, errors: errors.slice(0, 12), errorCount: errors.length };
  console.log(JSON.stringify(result, null, 2));
  if (residual !== 0 || claimed === 0 || heartbeats === 0) process.exitCode = 1;
} finally {
  stop = true;
  await pool.end().catch(() => {});
  await admin.end().catch(() => {});
}
