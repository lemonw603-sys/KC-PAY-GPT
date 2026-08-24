#!/usr/bin/env node
import mysql from 'mysql2/promise';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const childPath = fileURLToPath(new URL('./browser-pool-reconnect-child.js', import.meta.url));
const admin = mysql.createPool({ uri: databaseUrl, connectionLimit: 8 });
const children = Array.from({ length: 4 }, () => spawn(process.execPath, [childPath], {
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe']
}));
const waitLine = (child) => new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error(`child timeout: ${output}`)), 5000);
  child.stdout.on('data', (chunk) => {
    output += chunk.toString(); const line = output.split('\n').find(Boolean);
    if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
  });
  child.once('error', reject);
});
try {
  const identities = await Promise.all(children.map(waitLine));
  await Promise.all(identities.map(({ connectionId }) => admin.query(`KILL CONNECTION ${Number(connectionId)}`)));
  children.forEach((child) => child.kill('SIGUSR1'));
  await Promise.all(children.map((child) => new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`reconnect timeout: ${output}`)), 5000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); if (output.includes('RECONNECTED:1')) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { if (code !== 0) reject(new Error(`child exit ${code}: ${output}`)); });
  })));
  console.log(JSON.stringify({ scenario: 'four-pool-connections-reconnect', killed: identities.length, reconnected: identities.length }));
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await admin.end();
}
