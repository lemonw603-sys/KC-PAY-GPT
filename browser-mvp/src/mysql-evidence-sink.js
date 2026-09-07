import { EvidenceSink } from './ports.js';
import { assertEvidenceEvent } from './contracts.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromRef(ref, prefix) {
  const value = typeof ref === 'string' && ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

// Job ids are `brjob:<orderId>:<attemptId>` (shared runs) or
// `brpreflight:<orderId>:<taskId>` (order preflight): the order sits second.
function orderIdFromJobId(jobId) {
  const parts = String(jobId || '').split(':');
  return parts.length >= 2 && UUID.test(parts[1]) ? parts[1].toLowerCase() : null;
}

/**
 * Production timeline sink: one row per evidence event, keyed by job and
 * sequence, so the operator can read an order's Browser stages from the
 * database. It never blocks the order: a write failure is counted and
 * reported, the append-only WAL stays the integrity record.
 */
export class MysqlEvidenceSink extends EvidenceSink {
  constructor({ pool, workerId = null, log = (message, data) => console.warn(message, data) } = {}) {
    super();
    if (!pool || typeof pool.query !== 'function') throw new TypeError('mysql2-like pool is required');
    this.pool = pool;
    this.workerId = workerId == null ? null : String(workerId).slice(0, 96);
    this.log = log;
    this.failures = 0;
  }

  async append(event) {
    assertEvidenceEvent(event);
    const orderId = idFromRef(event.orderRef, 'order:') || orderIdFromJobId(event.jobId);
    const runId = idFromRef(event.runRef, 'run:');
    const action = typeof event.summary?.action === 'string' ? event.summary.action.slice(0, 64) : null;
    try {
      await this.pool.query(
        `INSERT IGNORE INTO browser_run_events
         (job_id, order_id, browser_run_id, sequence_no, event_type, action, summary_json, payload_digest, worker_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [String(event.jobId).slice(0, 191), orderId, runId, event.sequence, event.type, action,
          JSON.stringify(event.summary ?? {}), event.payloadDigest, this.workerId],
      );
    } catch (error) {
      this.failures += 1;
      this.log('browser timeline write failed', { jobId: event.jobId, sequence: event.sequence, code: error?.code || null });
    }
    return event;
  }
}

/** Fan-out to several sinks; the first (integrity) sink's failure still fails the append. */
export class CompositeEvidenceSink extends EvidenceSink {
  constructor(sinks = []) {
    super();
    if (!Array.isArray(sinks) || sinks.length === 0 || sinks.some((sink) => typeof sink?.append !== 'function')) {
      throw new TypeError('at least one evidence sink is required');
    }
    this.sinks = sinks;
  }

  async append(event) {
    for (const sink of this.sinks) await sink.append(event);
    return event;
  }
}
