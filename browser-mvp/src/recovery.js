import { WalIntegrityError } from './wal.js';

/**
 * Reconcile after a process restart. An in-flight Browser job is never replayed
 * from an incomplete WAL; it is moved to RECONCILE_ONLY for human inspection.
 */
export async function reconcileIncompleteJobs({ store, wal, now } = {}) {
  if (!store || typeof store.snapshot !== 'function' || typeof store.markReconcileOnly !== 'function') throw new TypeError('store is required');
  if (!wal || typeof wal.verify !== 'function') throw new TypeError('wal is required');
  let records;
  try {
    records = await wal.verify();
  } catch (error) {
    if (error instanceof WalIntegrityError) throw error;
    throw error;
  }
  const terminalJobs = new Set(records
    .filter((record) => ['completion', 'freeze', 'recovery'].includes(record.event.type))
    .map((record) => record.event.jobId));
  const snapshot = await store.snapshot();
  const reconciled = [];
  for (const [jobId, entry] of Object.entries(snapshot.jobs)) {
    if (entry.job.state !== 'RUNNING' || terminalJobs.has(jobId)) continue;
    const job = await store.markReconcileOnly(jobId, 'restart-without-terminal-evidence');
    if (job) reconciled.push(job);
  }
  return { verifiedRecords: records.length, reconciled };
}
