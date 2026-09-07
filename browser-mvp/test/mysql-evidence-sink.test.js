import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { CompositeEvidenceSink, MysqlEvidenceSink } from '../src/mysql-evidence-sink.js';

const digest = (v) => createHash('sha256').update(v).digest('hex');
const ORDER = 'f8622308-2099-4053-9e7e-d6b7f52a7e34';
const RUN = '84686b57-d07f-4e92-8bb2-03cc73262bd7';

test('timeline sink writes one row per event with order and run keys taken from refs or the job id', async () => {
  const inserts = [];
  const pool = { async query(sql, params) { inserts.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const sink = new MysqlEvidenceSink({ pool, workerId: 'pool:lane-3' });
  await sink.append({ jobId: `brjob:${ORDER}:attempt-1`, type: 'checkpoint', sequence: 3, payloadDigest: digest('a'), summary: { action: 'checkout-navigation', checkoutCreated: true }, orderRef: `order:${ORDER}`, runRef: `run:${RUN}` });
  await sink.append({ jobId: `brpreflight:${ORDER}:83`, type: 'freeze', sequence: 5, payloadDigest: digest('b'), summary: { action: 'fail-closed', reason: 'SESSION_INVALID' } });
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /INSERT IGNORE INTO browser_run_events/);
  assert.deepEqual(inserts[0].params, [`brjob:${ORDER}:attempt-1`, ORDER, RUN, 3, 'checkpoint', 'checkout-navigation', JSON.stringify({ action: 'checkout-navigation', checkoutCreated: true }), digest('a'), 'pool:lane-3']);
  assert.deepEqual(inserts[1].params.slice(0, 6), [`brpreflight:${ORDER}:83`, ORDER, null, 5, 'freeze', 'fail-closed']);
  assert.equal(sink.failures, 0);
});

test('timeline sink never blocks the order on a database failure and rejects unsafe summaries', async () => {
  const logs = [];
  const sink = new MysqlEvidenceSink({ pool: { async query() { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); } }, log: (m, d) => logs.push({ m, d }) });
  await sink.append({ jobId: `brjob:${ORDER}:attempt-1`, type: 'intent', sequence: 1, payloadDigest: digest('c'), summary: { action: 'observe-page' } });
  assert.equal(sink.failures, 1);
  assert.deepEqual(logs[0].d, { jobId: `brjob:${ORDER}:attempt-1`, sequence: 1, code: 'ECONNREFUSED' });
  await assert.rejects(() => sink.append({ jobId: `brjob:${ORDER}:attempt-1`, type: 'intent', sequence: 2, payloadDigest: digest('d'), summary: { cvv: '123' } }));
});

test('composite sink fans out in order and fails when the integrity sink fails', async () => {
  const seen = [];
  const ok = { async append(e) { seen.push('ok:' + e.sequence); } };
  const composite = new CompositeEvidenceSink([ok, { async append(e) { seen.push('db:' + e.sequence); } }]);
  await composite.append({ jobId: `brjob:${ORDER}:a`, type: 'intent', sequence: 1, payloadDigest: digest('e'), summary: {} });
  assert.deepEqual(seen, ['ok:1', 'db:1']);
  const failing = new CompositeEvidenceSink([{ async append() { throw new Error('wal'); } }, ok]);
  await assert.rejects(() => failing.append({ jobId: `brjob:${ORDER}:a`, type: 'intent', sequence: 2, payloadDigest: digest('f'), summary: {} }), /wal/);
  assert.throws(() => new CompositeEvidenceSink([]));
});
