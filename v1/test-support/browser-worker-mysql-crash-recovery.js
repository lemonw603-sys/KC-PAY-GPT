#!/usr/bin/env node
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const childPath = fileURLToPath(new URL('./browser-worker-mysql-crash-recovery-child.js', import.meta.url));
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8 });
let activePool = pool;
let repository = createBrowserDispatchRepository(activePool);
const suffix = `crash-${crypto.randomUUID()}`;
const routeId = '00000000-0000-4000-8000-000000000302';
const productId = '00000000-0000-4000-8000-000000000201';
const cdkId = crypto.randomUUID();
const orderId = crypto.randomUUID();
const attemptId = crypto.randomUUID();
let child;

function waitForLine(proc) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`child output timeout: ${output}`)), 5000);
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const line = output.split('\n').find(Boolean);
      if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
    });
    proc.once('error', (error) => { clearTimeout(timer); reject(error); });
    proc.once('exit', (code, signal) => {
      if (!output) { clearTimeout(timer); reject(new Error(`child exited ${code}/${signal}`)); }
    });
  });
}

const docker = (args) => new Promise((resolve, reject) => execFile('docker', args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));

try {
  await pool.query("INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')", [
    cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')
  ]);
  await pool.query(`INSERT INTO orders
    (id, public_no, cdk_id, status, session_ciphertext, card_purchase_idempotency_key,
     product_id, fulfillment_route_id, route_resolution_status)
    VALUES (?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, 'RESOLVED')`,
    [orderId, `${suffix}-order`, cdkId, Buffer.from('crash-recovery'), `${suffix}-purchase`, productId, routeId]);
  await pool.query(`INSERT INTO recharge_attempts
    (id, order_id, fulfillment_route_id, executor_kind, status, funds_risk_state, idempotency_key)
    VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?)`,
    [attemptId, orderId, routeId, `${suffix}-attempt`]);
  await repository.enqueue({ jobKey: `${suffix}-job`, attemptId, orderId });

  child = spawn(process.execPath, [childPath], {
    env: { ...process.env, TEST_DATABASE_URL: databaseUrl, BROWSER_CRASH_WORKER_ID: `${suffix}-crashed` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const claimed = await waitForLine(child);
  let concurrentFault = null;
  if (process.env.BROWSER_COMBINED_FAULT === '1') {
    await docker(['pause', process.env.MYSQL_CONTAINER || 'pojia-stage1-mysql']);
    concurrentFault = 'MYSQL_PAUSED_DURING_WORKER_CRASH';
  }
  const childExit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGKILL');
  if (concurrentFault) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await docker(['unpause', process.env.MYSQL_CONTAINER || 'pojia-stage1-mysql']);
    // Never reuse sockets that were alive during the database pause.
    await pool.end().catch(() => {});
    activePool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8, connectTimeout: 5000 });
    repository = createBrowserDispatchRepository(activePool);
  }
  const crashed = await childExit;
  await new Promise((resolve) => setTimeout(resolve, 11_000));

  const recovered = await repository.claim({ workerId: `${suffix}-recovery`, leaseSeconds: 10 });
  if (!recovered || String(recovered.jobId) !== String(claimed.jobId)) throw new Error('recovery worker did not take over expired job');
  let oldHeartbeatCode = null;
  try {
    await repository.heartbeat({ jobId: claimed.jobId, workerId: `${suffix}-crashed`, leaseToken: claimed.leaseToken, leaseSeconds: 10 });
  } catch (error) {
    oldHeartbeatCode = error.code;
  }
  const result = {
    scenario: 'cross-process-worker-crash-recovery',
    childExit: crashed,
    claimedJobId: String(claimed.jobId),
    recoveredJobId: String(recovered.jobId),
    takeover: true,
    oldOwnerHeartbeat: oldHeartbeatCode,
    concurrentFault,
    paymentActions: 0
  };
  console.log(JSON.stringify(result, null, 2));
  if (oldHeartbeatCode !== 'LEASE_NOT_OWNED') process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await activePool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [attemptId]).catch(() => {});
  await activePool.query('DELETE FROM recharge_attempts WHERE id = ?', [attemptId]).catch(() => {});
  await activePool.query('DELETE FROM orders WHERE id = ?', [orderId]).catch(() => {});
  await activePool.query('DELETE FROM cdks WHERE id = ?', [cdkId]).catch(() => {});
  await activePool.end().catch(() => {});
  if (activePool !== pool) await pool.end().catch(() => {});
}
