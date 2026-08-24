import mysql from 'mysql2/promise';
import { createBrowserDispatchRepository } from '../src/db/repositories/browser-dispatch-repository.js';

const pool = mysql.createPool({ uri: process.env.TEST_DATABASE_URL, connectionLimit: 2 });
const repository = createBrowserDispatchRepository(pool);
const job = await repository.claim({
  workerId: process.env.BROWSER_CRASH_WORKER_ID || 'crashed-worker',
  leaseSeconds: 10
});
if (!job) {
  process.stdout.write('NO_JOB\n');
  await pool.end();
  process.exit(2);
}
process.stdout.write(`${JSON.stringify({ jobId: job.jobId, leaseToken: job.leaseToken, leaseUntil: job.leaseUntil.toISOString() })}\n`);
setInterval(() => {}, 1000);
