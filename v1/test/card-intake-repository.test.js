import assert from 'node:assert/strict';
import test from 'node:test';
import { createCardIntakeRepository } from '../src/db/repositories/card-intake-repository.js';

function fakePool(responder) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ sql: 'BEGIN', params: [] }); },
    async commit() { calls.push({ sql: 'COMMIT', params: [] }); },
    async rollback() { calls.push({ sql: 'ROLLBACK', params: [] }); },
    release() { calls.push({ sql: 'RELEASE', params: [] }); },
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return responder(String(sql), params, calls);
    }
  };
  return {
    calls, connection,
    async getConnection() { return connection; },
    async query(sql, params = []) { return connection.query(sql, params); }
  };
}

test('serializes active intake batch creation on the provider account row', async () => {
  const pool = fakePool((sql) => {
    if (sql.includes('FROM provider_accounts')) return [[{ id: 'acct-a' }]];
    if (sql.includes('FROM card_intake_batches') && sql.includes('FOR UPDATE')) {
      return [[{ id: 'active-1', provider_account_id: 'acct-a', status: 'VALIDATING',
        baseline_hash: 'a'.repeat(64) }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createCardIntakeRepository({ pool, idFactory: () => 'new-batch' });
  const result = await repository.createBatch({ providerAccountId: 'acct-a',
    baselineHash: 'b'.repeat(64) });

  assert.equal(result.created, false);
  assert.equal(result.batch.id, 'active-1');
  assert.ok(pool.calls.some((call) => call.sql.includes('provider_accounts WHERE id = ? FOR UPDATE')));
  assert.ok(pool.calls.some((call) => call.sql.includes("status IN ('DISCOVERING','VALIDATING')")));
  assert.equal(pool.calls.some((call) => call.sql.startsWith('INSERT INTO card_intake_batches')), false);
  assert.ok(pool.calls.some((call) => call.sql === 'COMMIT'));
});

test('discovery checks account-scoped inventory before writing QUARANTINED', async () => {
  const pool = fakePool((sql) => {
    if (sql.includes('SELECT id FROM cards')) return [[]];
    if (sql.includes('INSERT IGNORE INTO card_discoveries')) return [{ affectedRows: 1 }];
    if (sql.includes('SELECT * FROM card_discoveries')) return [[{
      id: 'discovery-1', intake_batch_id: 'batch-1', provider_account_id: 'acct-a',
      external_card_id: 'same-id', intake_status: 'QUARANTINED', validation_attempts: 0
    }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createCardIntakeRepository({ pool, idFactory: () => 'discovery-1' });
  const result = await repository.addDiscovery({ batchId: 'batch-1', providerAccountId: 'acct-a',
    externalCardId: 'same-id' });
  assert.equal(result.kind, 'discovered');
  const check = pool.calls.find((call) => call.sql.includes('SELECT id FROM cards'));
  assert.deepEqual(check.params, ['acct-a', 'same-id']);
  const insert = pool.calls.find((call) => call.sql.includes('INSERT IGNORE INTO card_discoveries'));
  assert.ok(insert.sql.includes("'QUARANTINED'"));
});

test('repository refuses acceptance without persisted two-snapshot technical proof', async () => {
  const pool = fakePool((sql) => {
    if (sql.includes('SELECT * FROM card_discoveries')) return [[{
      id: 'discovery-1', intake_batch_id: 'batch-1', provider_account_id: 'acct-a',
      external_card_id: 'card-1', intake_status: 'REVIEW_REQUIRED', validation_attempts: 2,
      first_snapshot_hash: 'a'.repeat(64), second_snapshot_hash: 'b'.repeat(64),
      details_json: JSON.stringify({ validation: { rulesPassed: true } })
    }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createCardIntakeRepository({ pool });
  await assert.rejects(repository.acceptDiscovery('discovery-1', {}, { manual: true }),
    (error) => error.code === 'CARD_VALIDATION_REQUIRED');
  assert.ok(pool.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(pool.calls.some((call) => call.sql.startsWith('INSERT INTO cards')), false);
});

test('inventory identity queries are scoped by provider account and external ID', async () => {
  const pool = fakePool((sql, params) => {
    if (sql.includes('SELECT id, external_card_id FROM cards')) {
      assert.deepEqual(params, ['acct-b', 'shared-id']);
      return [[{ id: 'card-b', external_card_id: 'shared-id' }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createCardIntakeRepository({ pool });
  const result = await repository.findExistingExternalIds('acct-b', ['shared-id']);
  assert.equal(result.get('shared-id'), 'card-b');
  assert.ok(pool.calls[0].sql.includes('provider_account_id = ?'));
});
