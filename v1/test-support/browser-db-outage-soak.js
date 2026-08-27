#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
const container = process.env.MYSQL_CONTAINER || 'pojia-stage1-mysql';
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const child = spawn(process.execPath, ['v1/test-support/browser-mysql-bounded-soak.js', '--duration-ms=30000', '--jobs=10', '--workers=4', '--delay-ms=3', '--lease-seconds=120'], {
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });
const runDocker = (args) => new Promise((resolve, reject) => execFile('docker', args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
try {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await runDocker(['pause', container]);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await runDocker(['unpause', container]);
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  console.log(JSON.stringify({ scenario: 'mysql-pause-unpause-during-dispatch-soak', childExit: exit, outputTail: output.slice(-4000) }, null, 2));
  if (exit.code !== 0) process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
