#!/usr/bin/env node
import mysql from 'mysql2/promise';
import { spawn } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const container = process.env.MYSQL_CONTAINER || 'pojia-stage1-mysql';
const durationMs = Number(process.env.NETWORK_KILL_DURATION_MS || 30000);
const child = spawn(process.execPath, [
  'v1/test-support/browser-mysql-bounded-soak.js',
  `--duration-ms=${durationMs}`, '--jobs=10', '--workers=4', '--delay-ms=3', '--lease-seconds=120'
], { env: { ...process.env, TEST_DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

const admin = mysql.createPool({ uri: databaseUrl, connectionLimit: 1, connectTimeout: 3000 });
let killed = 0;
let rounds = 0;
let adminId;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  // A bounded fault test must not inherit an unbounded mysql2 wait. The
  // forced exit is evidence of a recovery defect, not a successful run.
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}, durationMs + 20000);
const hardWatchdog = setTimeout(() => {
  console.error(JSON.stringify({ scenario: 'network-level-connection-kill-storm', rounds, killed, failure: 'HARNESS_WATCHDOG_TIMEOUT' }));
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  process.exitCode = 2;
  process.exit();
}, durationMs + 25000);

try {
  const [[identity]] = await admin.query('SELECT CONNECTION_ID() AS id');
  adminId = Number(identity.id);
  await sleep(5000);
  const endAt = Date.now() + Math.min(6000, Math.max(1000, durationMs - 7000));
  while (Date.now() < endAt && child.exitCode === null) {
    rounds += 1;
    const [processes] = await admin.query('SHOW PROCESSLIST');
    const victims = processes
      .filter((row) => Number(row.Id) !== adminId && row.db === 'pojia_test')
      .map((row) => Number(row.Id))
      .filter(Number.isInteger)
      .slice(0, 2);
    for (const id of victims) {
      await admin.query(`KILL CONNECTION ${id}`).catch(() => {});
      killed += 1;
    }
    await sleep(500);
  }
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  clearTimeout(watchdog);
  clearTimeout(hardWatchdog);
  const result = { scenario: 'network-level-connection-kill-storm', container, rounds, killed, childExit: exit, outputTail: output.slice(-5000) };
  console.log(JSON.stringify(result, null, 2));
  if (exit.code !== 0) process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  clearTimeout(hardWatchdog);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await admin.end();
}
