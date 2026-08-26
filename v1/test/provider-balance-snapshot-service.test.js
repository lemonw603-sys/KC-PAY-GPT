import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  createProviderBalanceSnapshotService,
  normalizeDecimalString,
  recordProviderBalanceSnapshot,
  sha256Payload
} from '../src/services/provider-balance-snapshot-service.js';

function scriptedPool(responses) {
  const queries = [];
  const transaction = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { transaction.began += 1; },
    async commit() { transaction.committed += 1; },
    async rollback() { transaction.rolledBack += 1; },
    release() { transaction.released += 1; },
    async query(sql, values = []) {
      queries.push({ sql, values });
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

const accountId = '00000000-0000-4000-8000-000000000101';
const observedAt = new Date('2026-08-20T12:00:00.123Z');

test('normalizes strict fixed-point decimal strings for DECIMAL(18,6)', () => {
  assert.equal(normalizeDecimalString('5', { field: 'amount' }), '5.000000');
  assert.equal(normalizeDecimalString('0005.1', { field: 'amount' }), '5.100000');
  assert.equal(normalizeDecimalString('-0.1', { field: 'amount' }), '-0.100000');
  assert.throws(() => normalizeDecimalString(5, { field: 'amount' }), (error) => error.code === 'INVALID_DECIMAL');
  assert.throws(() => normalizeDecimalString('5.1234567', { field: 'amount' }), (error) => error.code === 'INVALID_DECIMAL');
  assert.throws(() => normalizeDecimalString('1000000000000.00', { field: 'amount' }), (error) => error.code === 'DECIMAL_OUT_OF_RANGE');
});

test('appends a balance snapshot and stores only SHA256 payload evidence', async () => {
  const rawPayload = { balance: '12.34', nested: { z: 1, a: 2 } };
  const payloadHash = sha256Payload(rawPayload);
  const pool = scriptedPool([
    [[{ id: accountId }], []],
    [[{ id: 44, provider_account_id: accountId }], []],
    [{ affectedRows: 1, insertId: 101 }, []],
    [[{
      id: 101,
      provider_account_id: accountId,
      currency: 'USD',
      available_balance: '12.340000',
      pending_balance: '0.500000',
      source_call_id: 44,
      payload_hash: payloadHash,
      observed_at: observedAt
    }], []]
  ]);

  const result = await recordProviderBalanceSnapshot(pool, {
    providerAccountId: accountId,
    currency: 'usd',
    availableBalance: '12.34',
    pendingBalance: '0.5',
    sourceCallId: 44,
    rawPayload,
    observedAt
  });

  assert.equal(result.inserted, true);
  assert.equal(result.availableBalance, '12.340000');
  assert.equal(result.pendingBalance, '0.500000');
  assert.equal(result.payloadHash, payloadHash);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
  assert.match(pool.queries[0].sql, /provider_accounts[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[1].sql, /provider_calls[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[2].sql, /INSERT IGNORE INTO provider_balance_snapshots/);
  assert.match(pool.queries[3].sql, /provider_account_id[\s\S]*currency[\s\S]*observed_at/);

  const insertValues = pool.queries[2].values;
  assert.deepEqual(insertValues.slice(0, 7), [accountId, 'USD', '12.340000', '0.500000', 44, payloadHash, observedAt]);
  const serializedValues = JSON.stringify(insertValues);
  assert.doesNotMatch(serializedValues, /nested|balance/);
  assert.doesNotMatch(pool.queries.map((entry) => entry.sql).join('\n'), /raw|payload_json|response_summary_json/i);
});

test('duplicate provider account currency observed_at is idempotent when evidence matches', async () => {
  const payloadHash = crypto.createHash('sha256').update('provider-response').digest('hex');
  const pool = scriptedPool([
    [[{ id: accountId }], []],
    [{ affectedRows: 0, insertId: 0 }, []],
    [[{
      id: 202,
      provider_account_id: accountId,
      currency: 'USD',
      available_balance: '8.000000',
      pending_balance: null,
      source_call_id: null,
      payload_hash: payloadHash,
      observed_at: observedAt
    }], []]
  ]);
  const service = createProviderBalanceSnapshotService({ pool });

  const result = await service.recordSnapshot({
    providerAccountId: accountId,
    currency: 'USD',
    availableBalance: '8.000000',
    rawPayload: 'provider-response',
    observedAt
  });

  assert.equal(result.id, 202);
  assert.equal(result.inserted, false);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
  assert.equal(pool.queries.length, 3, 'idempotency must not update existing rows');
  assert.match(pool.queries[1].sql, /INSERT IGNORE/);
  assert.doesNotMatch(pool.queries[1].sql, /ON DUPLICATE KEY UPDATE|UPDATE provider_balance_snapshots/i);
});

test('duplicate observation with different evidence rolls back as conflict', async () => {
  const pool = scriptedPool([
    [[{ id: accountId }], []],
    [{ affectedRows: 0, insertId: 0 }, []],
    [[{
      id: 303,
      provider_account_id: accountId,
      currency: 'USD',
      available_balance: '9.000000',
      pending_balance: null,
      source_call_id: null,
      payload_hash: null,
      observed_at: observedAt
    }], []]
  ]);

  await assert.rejects(
    recordProviderBalanceSnapshot(pool, {
      providerAccountId: accountId,
      currency: 'USD',
      availableBalance: '10.000000',
      observedAt
    }),
    (error) => error.code === 'SNAPSHOT_CONFLICT'
  );
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('source provider call must belong to the same provider account when known', async () => {
  const pool = scriptedPool([
    [[{ id: accountId }], []],
    [[{ id: 55, provider_account_id: '00000000-0000-4000-8000-000000000102' }], []]
  ]);

  await assert.rejects(
    recordProviderBalanceSnapshot(pool, {
      providerAccountId: accountId,
      currency: 'USD',
      availableBalance: '1.00',
      sourceCallId: 55,
      observedAt
    }),
    (error) => error.code === 'SOURCE_CALL_ACCOUNT_MISMATCH'
  );
  assert.equal(pool.queries.length, 2);
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('stable SHA256 payload hashing canonicalizes object key order', () => {
  assert.equal(sha256Payload({ b: 1, a: { y: 2, x: 3 } }), sha256Payload({ a: { x: 3, y: 2 }, b: 1 }));
  assert.equal(sha256Payload(null), null);
});
