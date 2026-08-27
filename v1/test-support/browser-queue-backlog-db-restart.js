#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';

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
  await docker(['restart', container]);
  await waitDb();
  const recoveryUrl = `mysql://root:root@127.0.0.1:${await port()}/pojia_test`;
  const recovered = await run('v1/test-support/browser-queue-restart-recovery.js', { TEST_DATABASE_URL: recoveryUrl, BACKLOG_WORKERS: '6' });
  console.log(JSON.stringify({ scenario: 'browser-dispatch-queue-backlog-db-restart', container, jobs, preparedExit: { code: prepared.code, signal: prepared.signal }, recoveryExit: { code: recovered.code, signal: recovered.signal }, recoveryOutput: recovered.output.slice(-5000) }, null, 2));
  if (prepared.code !== 0 || recovered.code !== 0) process.exitCode = 1;
} catch (error) { console.error(error.stack || error); process.exitCode = 1; }
