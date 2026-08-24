#!/usr/bin/env node
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const jobs = Number(process.env.BACKLOG_JOBS || 240);
const workers = Number(process.env.BACKLOG_WORKERS || 6);
const actionDelayMs = Number(process.env.BACKLOG_ACTION_DELAY_MS || 15);
const routeId = '00000000-0000-4000-8000-000000000302';
const productId = '00000000-0000-4000-8000-000000000201';
const suffix = crypto.randomUUID();
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: workers + 4, connectTimeout: 3000 });
const rows = [];
const claimedSet = new Set();
let duplicate = 0;
let heartbeatOk = 0;
let claimLatencyTotal = 0;
let claimLatencyMax = 0;
let queuePeak = 0;
let stop = false;
const errors = [];

async function createJob(index) {
  const cdkId = crypto.randomUUID(); const orderId = crypto.randomUUID(); const attemptId = crypto.randomUUID();
  rows.push({ cdkId, orderId, attemptId });
  await pool.query("INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, 'REDEEMED')", [cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')]);
  await pool.query(`INSERT INTO orders (id, public_no, cdk_id, status, session_ciphertext, card_purchase_idempotency_key, product_id, fulfillment_route_id, route_resolution_status)
    VALUES (?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, 'RESOLVED')`, [orderId, `BACKLOG-${suffix}-${index}`, cdkId, Buffer.from('queue-backlog'), `backlog-${suffix}-${index}`, productId, routeId]);
  await pool.query(`INSERT INTO recharge_attempts (id, order_id, fulfillment_route_id, executor_kind, status, funds_risk_state, idempotency_key)
    VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?)`, [attemptId, orderId, routeId, `backlog-${suffix}-${index}`]);
  await pool.query(`INSERT INTO browser_dispatch_jobs (job_key, recharge_attempt_id, order_id, status, queued_at)
    VALUES (?, ?, ?, 'QUEUED', NOW())`, [`backlog-job-${suffix}-${index}`, attemptId, orderId]);
}

async function worker(index) {
  const repository = createBrowserDispatchRepository(pool);
  while (!stop) {
    const started = Date.now();
    let job;
    try {
      job = await repository.claim({ workerId: `backlog-worker-${index}`, leaseSeconds: 120 });
    } catch (error) {
      errors.push({ code: error?.code || 'UNKNOWN', message: error?.message || String(error) });
      await new Promise((resolve) => setTimeout(resolve, 30));
      continue;
    }
    const elapsed = Date.now() - started; claimLatencyTotal += elapsed; claimLatencyMax = Math.max(claimLatencyMax, elapsed);
    if (!job) return;
    const id = String(job.jobId);
    if (claimedSet.has(id)) duplicate += 1; else claimedSet.add(id);
    await repository.heartbeat({ jobId: job.jobId, workerId: job.leaseOwner, leaseToken: job.leaseToken, leaseSeconds: 120 });
    heartbeatOk += 1;
    await new Promise((resolve) => setTimeout(resolve, actionDelayMs));
  }
}

async function queueMetric() {
  const [[row]] = await pool.query("SELECT COUNT(*) AS count FROM browser_dispatch_jobs WHERE status='QUEUED' AND job_key LIKE ?", [`backlog-job-${suffix}-%`]);
  queuePeak = Math.max(queuePeak, Number(row.count));
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
  } finally { await fresh.end(); }
}

try {
  const [[pending]] = await pool.query('SELECT COUNT(*) AS count FROM browser_dispatch_jobs');
  if (Number(pending.count) !== 0) throw new Error(`requires empty dispatch queue; found ${pending.count}`);
  for (let index = 0; index < jobs; index += 1) await createJob(index);
  console.log('BACKLOG_READY');
  if (process.env.BACKLOG_PREPARE_ONLY === '1') {
    await pool.end();
    process.exit(0);
  }
  const metricTimer = setInterval(() => queueMetric().catch(() => {}), 100);
  await Promise.all(Array.from({ length: workers }, (_, index) => worker(index)));
  stop = true; clearInterval(metricTimer); await queueMetric();
  await cleanup();
  const result = { scenario: 'browser-dispatch-queue-backlog', jobs, workers, actionDelayMs, claimed: claimedSet.size, duplicate, missing: jobs - claimedSet.size, heartbeatOk, queuePeak, claimLatencyAvgMs: claimedSet.size ? claimLatencyTotal / claimedSet.size : 0, claimLatencyMaxMs: claimLatencyMax, errors: errors.slice(0, 12), errorCount: errors.length, residualDispatch: 0 };
  console.log(JSON.stringify(result, null, 2));
  if (result.missing || duplicate || heartbeatOk !== jobs) process.exitCode = 1;
} finally { stop = true; await pool.end().catch(() => {}); }
