#!/usr/bin/env node
import mysql from 'mysql2/promise';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, waitForConnections: false, connectTimeout: 3000 });
const held = [];
try {
  held.push(...await Promise.all([pool.getConnection(), pool.getConnection()]));
  const started = Date.now();
  let timeoutCode = null;
  try {
    await createBrowserDispatchRepository(pool, { transactionTimeoutMs: 80 }).claim({ workerId: 'pool-exhaustion', leaseSeconds: 10 });
  } catch (error) { timeoutCode = error?.code || null; }
  const elapsedMs = Date.now() - started;
  for (const connection of held) connection.release();
  held.length = 0;
  await pool.query('SELECT 1');
  const result = { scenario: 'bounded-pool-exhaustion', connectionLimit: 2, heldConnections: 2, timeoutCode, elapsedMs, recovered: true };
  console.log(JSON.stringify(result, null, 2));
  if (timeoutCode !== 'DB_POOL_EXHAUSTED' || elapsedMs > 2000) process.exitCode = 1;
} finally {
  for (const connection of held) connection.destroy();
  await pool.end().catch(() => {});
}
