#!/usr/bin/env node
import mysql from 'mysql2/promise';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const childPath = fileURLToPath(new URL('./browser-pool-reconnect-child.js', import.meta.url));
const admin = mysql.createPool({ uri: databaseUrl, connectionLimit: 2 });
const child = spawn(process.execPath, [childPath], {
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
const firstLine = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`child timeout: ${output}`)), 5000);
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    const line = output.split('\n').find(Boolean);
    if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
  });
  child.once('error', reject);
});
try {
  await admin.query(`KILL CONNECTION ${Number(firstLine.connectionId)}`);
  child.kill('SIGUSR1');
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`reconnect timeout: ${output}`)), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('RECONNECTED:1')) { clearTimeout(timer); resolve({ ok: true }); }
      if (output.includes('RECONNECT_ERROR:')) { clearTimeout(timer); reject(new Error(output)); }
    });
    child.once('exit', (code) => { if (code !== 0) reject(new Error(`child exit ${code}: ${output}`)); });
  });
  console.log(JSON.stringify({ scenario: 'existing-pool-connection-reconnect', connectionKilled: true, ...result }));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await admin.end();
}
