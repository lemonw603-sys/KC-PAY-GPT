import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRechargeAuthorization,
  getRechargeAuthorizationStatus,
  revokeRechargeAuthorization
} from '../src/services/recharge-authorization-v2-service.js';

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

test('freezes an explicit batch without touching task payloads or global dispatch', async () => {
  const pool = scriptedPool([
    [[
      { order_id: 'order-1', public_no: 'PJV2-ORDER-0001', order_status: 'CARD_READY', task_id: 11, task_status: 'PENDING', attempts: 0 },
      { order_id: 'order-2', public_no: 'PJV2-ORDER-0002', order_status: 'CARD_READY', task_id: 12, task_status: 'PENDING', attempts: 0 }
    ], []],
    [[], []],
    [[], []],
    [{ affectedRows: 0 }, []],
    [[], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 2 }, []]
  ]);
  const result = await createRechargeAuthorization(pool, {
    publicNos: ['PJV2-ORDER-0001', 'PJV2-ORDER-0002'],
    ttlMinutes: 15,
    authorizedBy: 'operator-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  });

  assert.equal(result.mode, 'BATCH');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.expiresAt, '2026-08-20T12:15:00.000Z');
  assert.deepEqual(result.items.map((item) => item.publicNo), ['PJV2-ORDER-0001', 'PJV2-ORDER-0002']);
  assert.equal(result.items.every((item) => item.status === 'PENDING'), true);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });

  assert.match(pool.queries[0].sql, /ORDER BY o\.id\s+FOR UPDATE/);
  assert.match(pool.queries[1].sql, /funds_risk_state IN \('ACTIVE', 'UNKNOWN', 'SETTLED'\)/);
  assert.match(pool.queries[2].sql, /recharge_attempt_id IS NULL/);
  assert.match(pool.queries[3].sql, /SET rai\.status = 'EXPIRED'/);
  assert.match(pool.queries[4].sql, /recharge_authorization_items/);
  assert.match(pool.queries[6].sql, /VALUES \(\?, \?, \?, 'PENDING', \?\), \(\?, \?, \?, 'PENDING', \?\)/);
  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /app_settings|dispatch_new_recharges|payload_json/i);
});

test('rejects the whole batch and rolls back when one member is not eligible', async () => {
  const pool = scriptedPool([
    [[
      { order_id: 'order-1', public_no: 'PJV2-ORDER-0001', order_status: 'CARD_READY', task_id: 11, task_status: 'PENDING', attempts: 0 },
      { order_id: 'order-2', public_no: 'PJV2-ORDER-0002', order_status: 'SUBMITTING', task_id: 12, task_status: 'RUNNING', attempts: 1 }
    ], []]
  ]);

  await assert.rejects(
    createRechargeAuthorization(pool, { publicNos: ['PJV2-ORDER-0001', 'PJV2-ORDER-0002'] }),
    (error) => error.code === 'ORDER_NOT_ELIGIBLE'
  );
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
  assert.equal(pool.queries.length, 1);
});

test('allows a cleared historical attempt but refuses an active funds fence', async () => {
  const eligible = [[{
    order_id: 'order-1', public_no: 'PJV2-ORDER-0001', order_status: 'CARD_READY',
    task_id: 11, task_status: 'PENDING', attempts: 0
  }], []];
  const pool = scriptedPool([
    eligible,
    [[{ order_id: 'order-1' }], []]
  ]);
  await assert.rejects(
    createRechargeAuthorization(pool, { publicNos: ['PJV2-ORDER-0001'] }),
    (error) => error.code === 'FUNDS_FENCE_EXISTS'
  );
  assert.match(pool.queries[1].sql, /ACTIVE.*UNKNOWN.*SETTLED/);
  assert.doesNotMatch(pool.queries[1].sql, /CLEARED/);
});

test('recovers only a safely unstarted authorization-race task before reauthorizing it', async () => {
  const now = new Date('2026-08-20T12:00:00.000Z');
  const pool = scriptedPool([
    [[{
      order_id: 'order-1', public_no: 'PJV2-ORDER-0001', order_status: 'CARD_READY',
      task_id: 11, task_status: 'PENDING', attempts: 1,
      last_error_code: 'RECHARGE_AUTHORIZATION_REQUIRED'
    }], []],
    [[], []],
    [[], []],
    [{ affectedRows: 1 }, []],
    [[], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);

  const result = await createRechargeAuthorization(pool, {
    publicNos: ['PJV2-ORDER-0001'], now
  });
  assert.equal(result.items.length, 1);
  assert.match(pool.queries[5].sql, /SET attempts = 0/);
  assert.deepEqual(pool.queries[5].values.slice(0, 2), [now, now]);
  assert.equal(pool.queries[5].values[2], 11);
});

test('refuses authorization when a legacy ZZSHU create call exists', async () => {
  const pool = scriptedPool([
    [[{
      order_id: 'order-1', public_no: 'PJV2-ORDER-0001', order_status: 'CARD_READY',
      task_id: 11, task_status: 'PENDING', attempts: 0
    }], []],
    [[], []],
    [[{ order_id: 'order-1' }], []]
  ]);
  await assert.rejects(
    createRechargeAuthorization(pool, { publicNos: ['PJV2-ORDER-0001'] }),
    (error) => error.code === 'LEGACY_CREATE_ALREADY_ATTEMPTED'
  );
});

test('revokes pending members while preserving already consumed members', async () => {
  const pool = scriptedPool([
    [[{ id: 'auth-1', status: 'ACTIVE' }], []],
    [[
      { id: 'item-1', order_id: 'order-1', status: 'CONSUMED' },
      { id: 'item-2', order_id: 'order-2', status: 'PENDING' }
    ], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const result = await revokeRechargeAuthorization(pool, {
    authorizationId: 'auth-1',
    revokedBy: 'operator-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  });
  assert.equal(result.revokedItems, 1);
  assert.equal(result.consumedItems, 1);
  assert.match(pool.queries[2].sql, /status = 'REVOKED'/);
  assert.doesNotMatch(pool.queries.map((entry) => entry.sql).join('\n'), /app_settings|payload_json/i);
});

test('status view exposes only operational authorization and attempt fields', async () => {
  const pool = scriptedPool([
    [[{
      order_status: 'CARD_READY', task_status: 'PENDING', attempts: 0,
      authorization_id: 'auth-1', authorization_mode: 'SINGLE', authorization_status: 'ACTIVE',
      expires_at: new Date('2026-08-20T12:10:00.000Z'), authorization_item_id: 'item-1', item_status: 'PENDING',
      attempt_id: null, attempt_status: null, funds_risk_state: null
    }], []]
  ]);
  const result = await getRechargeAuthorizationStatus(pool, {
    publicNo: 'PJV2-ORDER-0001',
    now: new Date('2026-08-20T12:11:00.000Z')
  });
  assert.equal(result.authorization.itemStatus, 'EXPIRED');
  assert.equal(result.attempt, null);
  assert.deepEqual(Object.keys(result).sort(), ['attempt', 'authorization', 'orderStatus', 'publicNo', 'taskAttempts', 'taskStatus']);
  assert.doesNotMatch(pool.queries[0].sql, /payload_json|session_ciphertext|response_summary_json/i);
});

test('validates TTL and duplicate batch members before opening a transaction', async () => {
  const pool = scriptedPool([]);
  await assert.rejects(
    createRechargeAuthorization(pool, { publicNos: ['PJV2-ORDER-0001'], ttlMinutes: 31 }),
    (error) => error.code === 'INVALID_TTL'
  );
  await assert.rejects(
    createRechargeAuthorization(pool, { publicNos: ['PJV2-ORDER-0001', 'PJV2-ORDER-0001'] }),
    (error) => error.code === 'DUPLICATE_ORDER'
  );
  assert.equal(pool.transaction.began, 0);
});
