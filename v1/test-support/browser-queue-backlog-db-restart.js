#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import mysql from 'mysql2/promise';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const container = process.env.MYSQL_CONTAINER || 'pojia-stage1-mysql';
const jobs = Number(process.env.BACKLOG_JOBS || 120);
const docker = (args) => new Promise((resolve, reject) => execFile('docker', args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
const port = async () => Number((await docker(['port', container, '3306/tcp'])).stdout.match(/:(\d+)/)?.[1]);
const waitDb = async () => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { await docker(['exec', container, 'mysqladmin', 'ping', '-uroot', '-proot', '--silent']); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error('database did not become ready after restart'); };
const run = (script, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${script} watchdog: ${output.slice(-2000)}`)); }, 30000);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
});
try {
  const prepared = await run('v1/test-support/browser-queue-backlog-soak.js', { TEST_DATABASE_URL: databaseUrl, BACKLOG_JOBS: String(jobs), BACKLOG_PREPARE_ONLY: '1' });
  const beforeRestartPool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, connectTimeout: 3000 });
  const preRestartClaim = await createBrowserDispatchRepository(beforeRestartPool).claim({
    workerId: 'pre-restart-worker', leaseSeconds: 10,
  });
  await beforeRestartPool.end();
  if (!preRestartClaim) throw new Error('pre-restart claim did not return a queued job');
  await docker(['restart', container]);
  await waitDb();
  const recoveryUrl = `mysql://root:root@127.0.0.1:${await port()}/pojia_test`;
  const expirePool = mysql.createPool({ uri: recoveryUrl, connectionLimit: 2, connectTimeout: 3000 });
  await expirePool.query('UPDATE browser_dispatch_jobs SET lease_until = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?', [preRestartClaim.jobId]);
  await expirePool.end();
  const recovered = await run('v1/test-support/browser-queue-restart-recovery.js', {
    TEST_DATABASE_URL: recoveryUrl, BACKLOG_WORKERS: '6',
    BACKLOG_STALE_JOB_ID: String(preRestartClaim.jobId),
    BACKLOG_STALE_LEASE_TOKEN: preRestartClaim.leaseToken,
  });
  console.log(JSON.stringify({ scenario: 'browser-dispatch-queue-backlog-db-restart', container, jobs, preparedExit: { code: prepared.code, signal: prepared.signal }, recoveryExit: { code: recovered.code, signal: recovered.signal }, preRestartClaim: { jobId: preRestartClaim.jobId, attemptId: preRestartClaim.attemptId }, recoveryOutput: recovered.output.slice(-5000) }, null, 2));
  if (prepared.code !== 0 || recovered.code !== 0) process.exitCode = 1;
} catch (error) { console.error(error.stack || error); process.exitCode = 1; }
