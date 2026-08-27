import assert from 'node:assert/strict';
import test from 'node:test';
import { createReconciliationCaseService } from '../src/services/reconciliation-case-service.js';

function scriptedPool(responses) {
  const queries = [];
  const transaction = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { transaction.began += 1; },
    async commit() { transaction.committed += 1; },
    async rollback() { transaction.rolledBack += 1; },
    release() { transaction.released += 1; },
    async query(sql, values = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error(`unexpected query: ${sql}`);
      return response;
    }
  };
  return {
    queries,
    transaction,
    async getConnection() { return connection; },
    async query(sql, values = []) { return connection.query(sql, values); }
  };
}

const now = new Date('2026-08-20T12:00:00.000Z');

test('upserts by dedupe key and preserves resolved cases while updating last seen surface', async () => {
  const pool = scriptedPool([
    [{ affectedRows: 2 }, []],
    [[{
      id: 'case-existing', case_type: 'PAYMENT_MISMATCH', status: 'RESOLVED',
      severity: 'critical', dedupe_key: 'order:1:payment', order_id: 'order-1',
      card_id: 'card-1', recharge_attempt_id: 'attempt-1', provider_account_id: 'acct-1',
      evidence_json: JSON.stringify({ old: true }), assigned_to: 'ops-a',
      resolution_note: 'checked with provider', detected_at: new Date('2026-08-19T00:00:00.000Z'),
      resolved_at: new Date('2026-08-19T01:00:00.000Z'), last_seen_at: now, updated_at: now,
      public_no: 'PJV2-ORDER-0001'
    }], []]
  ]);
  const service = createReconciliationCaseService({ pool, idFactory: () => 'case-new', now: () => now });
  const result = await service.upsertCase({
    caseType: 'CARD_CHARGED_WITHOUT_RECHARGE',
    dedupeKey: 'order:1:payment',
    severity: 'warning',
    orderId: 'order-2',
    evidence: { newer: true }
  });

  assert.equal(result.id, 'case-existing');
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.resolutionNote, 'checked with provider');
  assert.deepEqual(result.evidence, { old: true });
  assert.equal(result.lastSeenAt, '2026-08-20T12:00:00.000Z');
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });

  const upsertSql = pool.queries[0].sql;
  assert.match(upsertSql, /ON DUPLICATE KEY UPDATE/);
  assert.match(upsertSql, /last_seen_at = VALUES\(last_seen_at\)/);
  assert.match(upsertSql, /updated_at = IF\(status = 'RESOLVED', updated_at, VALUES\(updated_at\)\)/);
  assert.match(upsertSql, /case_type = IF\(status = 'RESOLVED', case_type, VALUES\(case_type\)\)/);
  assert.match(upsertSql, /evidence_json = IF\(status = 'RESOLVED', evidence_json, VALUES\(evidence_json\)\)/);
  assert.doesNotMatch(upsertSql, /resolution_note\s*=\s*VALUES|resolved_at\s*=\s*VALUES/i);
  assert.doesNotMatch(pool.queries[1].sql, /BINARY rc\.dedupe_key/i,
    'readback collation must match the case-insensitive unique key');
});

test('inserts a new OPEN case with operational evidence only', async () => {
  const pool = scriptedPool([
    [{ affectedRows: 1 }, []],
    [[{
      id: 'case-1', case_type: 'SUBMIT_UNKNOWN_STALE', status: 'OPEN', severity: 'warning',
      dedupe_key: 'attempt:1:unknown', order_id: 'order-1', card_id: null,
      recharge_attempt_id: 'attempt-1', provider_account_id: 'acct-1',
      evidence_json: JSON.stringify({ attemptStatus: 'SUBMIT_UNKNOWN' }),
      assigned_to: null, resolution_note: null, detected_at: now, last_seen_at: now, resolved_at: null,
      updated_at: now, public_no: 'PJV2-ORDER-0001'
    }], []]
  ]);
  const service = createReconciliationCaseService({ pool, idFactory: () => 'case-1', now: () => now });
  const result = await service.upsertCase({
    caseType: 'SUBMIT_UNKNOWN_STALE',
    dedupeKey: 'attempt:1:unknown',
    rechargeAttemptId: 'attempt-1',
    providerAccountId: 'acct-1',
    evidence: { attemptStatus: 'SUBMIT_UNKNOWN' }
  });

  assert.equal(result.status, 'OPEN');
  assert.equal(result.publicNo, 'PJV2-ORDER-0001');
  assert.deepEqual(result.evidence, { attemptStatus: 'SUBMIT_UNKNOWN' });
  assert.equal(pool.queries[0].values[0], 'case-1');
  assert.equal(pool.queries[0].values[2], 'OPEN');
  assert.equal(pool.queries[0].values[4], 'attempt:1:unknown');
});

test('lists reconciliation cases with bounded page pagination and filters', async () => {
  const pool = scriptedPool([
    [[{
      id: 'case-2', case_type: 'PAYMENT_MISMATCH', status: 'ASSIGNED', severity: 'critical',
      dedupe_key: 'order:2:payment', order_id: 'order-2', evidence_json: null,
      assigned_to: 'ops-a', detected_at: now, last_seen_at: now, updated_at: now, public_no: 'PJV2-ORDER-0002'
    }], []],
    [[{ total: 51 }], []]
  ]);
  const service = createReconciliationCaseService({ pool });
  const result = await service.listCases({ page: 2, pageSize: 50, status: 'ASSIGNED', severity: 'critical', assignedTo: 'ops-a' });

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 50);
  assert.equal(result.total, 51);
  assert.equal(result.hasMore, false);
  assert.equal(result.cases[0].id, 'case-2');
  assert.equal('evidence' in result.cases[0], false, 'queue API must not expose evidence JSON');
  assert.match(pool.queries[0].sql, /ORDER BY FIELD\(rc\.status/);
  assert.match(pool.queries[0].sql, /COALESCE\(rc\.last_seen_at, rc\.detected_at\) DESC/);
  assert.match(pool.queries[0].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(pool.queries[0].values, ['ASSIGNED', 'critical', 'ops-a', 50, 50]);
  assert.deepEqual(pool.queries[1].values, ['ASSIGNED', 'critical', 'ops-a']);
});

test('redacts sensitive evidence before persistence', async () => {
  const pool = scriptedPool([
    [{ affectedRows: 1 }, []],
    [[{
      id: 'case-1', case_type: 'X', status: 'OPEN', severity: 'warning',
      dedupe_key: 'safe-key', evidence_json: '{"apiKey":"[REDACTED]"}',
      detected_at: now, last_seen_at: now, updated_at: now
    }], []]
  ]);
  const service = createReconciliationCaseService({ pool, idFactory: () => 'case-1', now: () => now });
  await service.upsertCase({
    caseType: 'X', dedupeKey: 'safe-key',
    evidence: { apiKey: 'SECRET', cdkCode: 'PJ-ABCDE-FGHJK-MNPQR-ST234', status: 'UNKNOWN' }
  });
  const storedEvidence = pool.queries[0].values[9];
  assert.doesNotMatch(storedEvidence, /SECRET|PJ-ABCDE/);
  assert.match(storedEvidence, /REDACTED/);
});

test('assign refuses resolved cases and rolls back', async () => {
  const pool = scriptedPool([
    [[{
      id: 'case-1', status: 'RESOLVED', case_type: 'PAYMENT_MISMATCH', severity: 'warning',
      dedupe_key: 'k1', evidence_json: null, resolution_note: 'done', updated_at: now
    }], []]
  ]);
  const service = createReconciliationCaseService({ pool });
  await assert.rejects(
    service.assign({ id: 'case-1', assignedTo: 'ops-b' }),
    (error) => error.code === 'CASE_ALREADY_RESOLVED'
  );
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
  assert.equal(pool.queries.some((entry) => entry.sql.startsWith('UPDATE reconciliation_cases')), false);
});

test('assigns and resolves cases with explicit resolution note', async () => {
  const pool = scriptedPool([
    [[{ id: 'case-1', status: 'OPEN', case_type: 'PAYMENT_MISMATCH', severity: 'warning', dedupe_key: 'k1', evidence_json: null, updated_at: now }], []],
    [{ affectedRows: 1 }, []],
    [[{ id: 'case-1', status: 'ASSIGNED', assigned_to: 'ops-b', case_type: 'PAYMENT_MISMATCH', severity: 'warning', dedupe_key: 'k1', evidence_json: null, updated_at: now }], []],
    [[{ id: 'case-1', status: 'ASSIGNED', assigned_to: 'ops-b', case_type: 'PAYMENT_MISMATCH', severity: 'warning', dedupe_key: 'k1', evidence_json: null, updated_at: now }], []],
    [{ affectedRows: 1 }, []],
    [[{ id: 'case-1', status: 'RESOLVED', assigned_to: 'ops-b', case_type: 'PAYMENT_MISMATCH', severity: 'warning', dedupe_key: 'k1', evidence_json: null, resolution_note: 'provider evidence matched', resolved_at: now, updated_at: now }], []]
  ]);
  const service = createReconciliationCaseService({ pool, now: () => now });

  const assigned = await service.assign({ id: 'case-1', assignedTo: 'ops-b' });
  assert.equal(assigned.status, 'ASSIGNED');
  assert.equal(assigned.assignedTo, 'ops-b');
  const resolved = await service.resolve({ id: 'case-1', resolutionNote: 'provider evidence matched' });
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.resolutionNote, 'provider evidence matched');
  assert.match(pool.queries[1].sql, /SET status = 'ASSIGNED', assigned_to = \?, updated_at = \?/);
  assert.match(pool.queries[4].sql, /SET status = 'RESOLVED', resolution_note = \?, resolved_at = \?, updated_at = \?/);
});

test('validates reconciliation case inputs before opening a transaction', async () => {
  const pool = scriptedPool([]);
  const service = createReconciliationCaseService({ pool });
  await assert.rejects(service.upsertCase({ caseType: '', dedupeKey: 'k' }), (error) => error.code === 'INVALID_CASE_TYPE');
  await assert.rejects(service.upsertCase({ caseType: 'X', dedupeKey: 'k', severity: 'high' }), (error) => error.code === 'INVALID_SEVERITY');
  await assert.rejects(service.resolve({ id: 'case-1', resolutionNote: '' }), (error) => error.code === 'INVALID_RESOLUTION_NOTE');
  assert.equal(pool.transaction.began, 0);
});
