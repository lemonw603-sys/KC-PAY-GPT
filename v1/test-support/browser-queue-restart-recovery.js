#!/usr/bin/env node
import mysql from 'mysql2/promise';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const workers = Number(process.env.BACKLOG_WORKERS || 6);
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: workers + 2, connectTimeout: 3000 });
const claimed = new Set(); const errors = []; let heartbeatOk = 0; let stop = false;
async function worker(index) {
  const repository = createBrowserDispatchRepository(pool);
  while (!stop) {
    try {
      const job = await repository.claim({ workerId: `restart-recovery-${index}`, leaseSeconds: 120 });
      if (!job) return;
      claimed.add(String(job.jobId));
      await repository.heartbeat({ jobId: job.jobId, workerId: job.leaseOwner, leaseToken: job.leaseToken, leaseSeconds: 120 });
      heartbeatOk += 1;
    } catch (error) { errors.push({ code: error?.code || 'UNKNOWN', message: error?.message || String(error) }); await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
}
async function cleanup() {
  const [orders] = await pool.query("SELECT id, cdk_id FROM orders WHERE public_no LIKE 'BACKLOG-%'");
  for (const order of orders) {
    const [[attempt]] = await pool.query('SELECT id FROM recharge_attempts WHERE order_id=?', [order.id]);
    if (attempt) { await pool.query('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id=?', [attempt.id]); await pool.query('DELETE FROM recharge_attempts WHERE id=?', [attempt.id]); }
    await pool.query('DELETE FROM orders WHERE id=?', [order.id]); await pool.query('DELETE FROM cdks WHERE id=?', [order.cdk_id]);
  }
  const [[residual]] = await pool.query("SELECT COUNT(*) AS count FROM browser_dispatch_jobs WHERE job_key LIKE 'backlog-job-%'");
  return Number(residual.count);
}
try {
  const [[pending]] = await pool.query("SELECT COUNT(*) AS count FROM browser_dispatch_jobs WHERE status IN ('QUEUED','CLAIMED')");
  await Promise.all(Array.from({ length: workers }, (_, index) => worker(index)));
  const residual = await cleanup();
  const result = { scenario: 'browser-queue-restart-recovery', pendingBefore: Number(pending.count), claimed: claimed.size, heartbeatOk, residual, errors: errors.slice(0, 12), errorCount: errors.length };
  console.log(JSON.stringify(result, null, 2));
  if (residual !== 0 || claimed.size !== Number(pending.count) || heartbeatOk !== claimed.size) process.exitCode = 1;
} finally { stop = true; await pool.end().catch(() => {}); }
