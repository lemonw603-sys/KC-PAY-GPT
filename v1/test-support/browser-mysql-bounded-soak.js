#!/usr/bin/env node
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const arg = (name, fallback) => Number(process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const rounds = arg('rounds', 20);
const jobsPerRound = arg('jobs', 20);
const workers = arg('workers', 8);
const delayMs = arg('delay-ms', 5);
const durationMs = arg('duration-ms', 0);
const leaseSeconds = arg('lease-seconds', 60);
const metadataPath = String(process.env.BROWSER_SOAK_METADATA_PATH || '').trim();
const routeId = '00000000-0000-4000-8000-000000000302';
const productId = '00000000-0000-4000-8000-000000000201';

const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: Math.max(workers + 4, 12) });
const repository = createBrowserDispatchRepository(pool);
const [[pendingDispatch]] = await pool.query('SELECT COUNT(*) AS count FROM browser_dispatch_jobs');
if (Number(pendingDispatch.count) !== 0) {
  await pool.end();
  throw new Error(`bounded soak requires an empty dispatch queue; found ${pendingDispatch.count} existing jobs`);
}
const suffix = crypto.randomUUID();
const rows = [];
let finalResult = null;
let runStatus = 'RUNNING';
let createdCount = 0;
let claimedCount = 0;
let duplicateClaims = 0;
let claimedThisRound = new Set();
let heartbeatOk = 0;
const startedAt = Date.now();
const rssStart = process.memoryUsage().rss;
let rssPeak = rssStart;
const heapStart = process.memoryUsage().heapUsed;
const externalStart = process.memoryUsage().external;
let heapPeak = heapStart;
let externalPeak = externalStart;
let dbThreadsPeak = 0;
let claimLatencyTotalMs = 0; let claimLatencyMaxMs = 0; let claimLatencyCount = 0;
let heartbeatLatencyTotalMs = 0; let heartbeatLatencyMaxMs = 0; let heartbeatLatencyCount = 0;
const metricTimer = setInterval(async () => {
  const memory = process.memoryUsage();
  rssPeak = Math.max(rssPeak, memory.rss);
  heapPeak = Math.max(heapPeak, memory.heapUsed);
  externalPeak = Math.max(externalPeak, memory.external);
  try {
    const [rows] = await pool.query("SHOW STATUS LIKE 'Threads_connected'");
    dbThreadsPeak = Math.max(dbThreadsPeak, Number(rows[0]?.Value || 0));
  } catch {}
}, 1000);

async function createJob(round, index) {
  const number = round * jobsPerRound + index;
  const cdkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  rows.push({ cdkId, orderId, attemptId });
  await pool.query('INSERT INTO cdks (id, code_hash, status) VALUES (?, ?, \'REDEEMED\')', [
    cdkId, crypto.createHash('sha256').update(cdkId).digest('hex')
  ]);
  await pool.query(
    `INSERT INTO orders
      (id, public_no, cdk_id, status, session_ciphertext,
       card_purchase_idempotency_key, product_id, fulfillment_route_id,
       route_resolution_status)
     VALUES (?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, 'RESOLVED')`,
    [orderId, `SOAK-${suffix}-${number}`, cdkId, Buffer.from('bounded-soak'), `soak-${suffix}-${number}`, productId, routeId]
  );
  await pool.query(
    `INSERT INTO recharge_attempts
      (id, order_id, fulfillment_route_id, executor_kind, status,
       funds_risk_state, idempotency_key)
     VALUES (?, ?, ?, 'BROWSER', 'PREPARED', 'ACTIVE', ?)`,
    [attemptId, orderId, routeId, `soak-${suffix}-${number}`]
  );
  await repository.enqueue({ jobKey: `soak-job-${suffix}-${number}`, attemptId, orderId });
}

async function worker(workerIndex) {
  while (true) {
    const claimStarted = Date.now();
    const job = await repository.claim({ workerId: `soak-worker-${workerIndex}`, leaseSeconds });
    const claimElapsed = Date.now() - claimStarted;
    claimLatencyTotalMs += claimElapsed; claimLatencyMaxMs = Math.max(claimLatencyMaxMs, claimElapsed); claimLatencyCount += 1;
    if (!job) return;
    const jobId = String(job.jobId);
    if (claimedThisRound.has(jobId)) duplicateClaims += 1;
    else { claimedThisRound.add(jobId); claimedCount += 1; }
    const heartbeatStarted = Date.now();
    await repository.heartbeat({ jobId: job.jobId, workerId: job.leaseOwner, leaseToken: job.leaseToken, leaseSeconds });
    const heartbeatElapsed = Date.now() - heartbeatStarted;
    heartbeatLatencyTotalMs += heartbeatElapsed; heartbeatLatencyMaxMs = Math.max(heartbeatLatencyMaxMs, heartbeatElapsed); heartbeatLatencyCount += 1;
    heartbeatOk += 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function cleanupRows() {
  for (const row of rows) {
    await pool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id = ?', [row.attemptId]);
    await pool.query('DELETE FROM recharge_attempts WHERE id = ?', [row.attemptId]);
    await pool.query('DELETE FROM orders WHERE id = ?', [row.orderId]);
    await pool.query('DELETE FROM cdks WHERE id = ?', [row.cdkId]);
  }
  createdCount += rows.length;
  rows.length = 0;
  claimedThisRound = new Set();
  if (typeof global.gc === 'function') global.gc();
}

try {
  for (let round = 0; (durationMs > 0 ? Date.now() - startedAt < durationMs : round < rounds); round += 1) {
    // Keep fixture production serialized: the soak target is claim/lease concurrency.
    // Concurrent fixture inserts can deadlock under the existing FK/index topology;
    // that behavior is tracked separately as an enqueue-producer finding.
    for (let index = 0; index < jobsPerRound; index += 1) await createJob(round, index);
    await Promise.all(Array.from({ length: workers }, (_, index) => worker(index)));
    await cleanupRows();
  }
  const result = {
    database: 'isolated-test-database', rounds: durationMs > 0 ? undefined : rounds,
    durationMs: durationMs > 0 ? durationMs : undefined, jobsPerRound, workers, delayMs, leaseSeconds,
    created: createdCount, claimed: claimedCount, missing: createdCount - claimedCount,
    duplicateClaims, heartbeatOk, elapsedMs: Date.now() - startedAt,
    rssStartBytes: rssStart, rssPeakBytes: rssPeak, rssEndBytes: process.memoryUsage().rss,
    heapStartBytes: heapStart, heapPeakBytes: heapPeak, heapEndBytes: process.memoryUsage().heapUsed,
    externalStartBytes: externalStart, externalPeakBytes: externalPeak, externalEndBytes: process.memoryUsage().external,
    dbThreadsPeak,
    claimLatency: { count: claimLatencyCount, avgMs: claimLatencyCount ? claimLatencyTotalMs / claimLatencyCount : 0, maxMs: claimLatencyMaxMs },
    heartbeatLatency: { count: heartbeatLatencyCount, avgMs: heartbeatLatencyCount ? heartbeatLatencyTotalMs / heartbeatLatencyCount : 0, maxMs: heartbeatLatencyMaxMs }
  };
  finalResult = result;
  runStatus = 'COMPLETED';
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  runStatus = 'FAILED';
  throw error;
} finally {
  clearInterval(metricTimer);
  let residualDispatch = 0; let residualAttempts = 0; let residualOrders = 0; let residualCdks = 0;
  const cdkHashes = rows.map((row) => crypto.createHash('sha256').update(row.cdkId).digest('hex'));
  await cleanupRows();
  // Query by the unique run suffix even after cleanupRows clears its in-memory
  // fixture list. This keeps the residual evidence independent of local
  // bookkeeping and catches partial cleanup failures.
  [[{ count: residualDispatch }]] = await pool.query('SELECT COUNT(*) AS count FROM browser_dispatch_jobs WHERE job_key LIKE ?', [`soak-job-${suffix}-%`]);
  [[{ count: residualAttempts }]] = await pool.query('SELECT COUNT(*) AS count FROM recharge_attempts WHERE idempotency_key LIKE ?', [`soak-${suffix}-%`]);
  [[{ count: residualOrders }]] = await pool.query('SELECT COUNT(*) AS count FROM orders WHERE public_no LIKE ?', [`SOAK-${suffix}-%`]);
  if (cdkHashes.length) {
    [[{ count: residualCdks }]] = await pool.query('SELECT COUNT(*) AS count FROM cdks WHERE code_hash IN (?)', [cdkHashes]);
  }
  const cleanup = { residualDispatch, residualAttempts, residualOrders, residualCdks };
  console.error(JSON.stringify({ cleanup }));
  if (metadataPath) {
    const status = Object.values(cleanup).some((count) => Number(count) > 0) ? 'FAILED' : runStatus;
    writeFileSync(metadataPath, `${JSON.stringify({
      runId: path.basename(metadataPath, '.json').replace(/^24h-/, ''),
      status,
      finishedAt: new Date().toISOString(),
      result: finalResult,
      cleanup
    }, null, 2)}\n`, { mode: 0o600 });
  }
  if (residualDispatch || residualAttempts || residualOrders || residualCdks) process.exitCode = 1;
  await pool.end();
}
