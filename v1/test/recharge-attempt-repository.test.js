import assert from 'node:assert/strict';
import test from 'node:test';
import { createRechargeAttemptRepository } from '../src/db/repositories/recharge-attempt-repository.js';

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
  return { queries, transaction, async getConnection() { return connection; } };
}

function beginResponses({ existingAttempts = [], providerInsert = [{ insertId: 501 }, []] } = {}) {
  return [
    [[{ id: 91, order_id: 'order-1', status: 'RUNNING', attempts: 1 }], []],
    [[{
      id: 'order-1', status: 'CARD_READY', version: 7,
      fulfillment_route_id: 'route-1', executor_kind: 'API',
      recharge_provider_account_id: 'provider-account-1', provider_code: 'new-provider', write_enabled: 1
    }], []],
    [[{
      id: 'item-1', order_id: 'order-1', item_status: 'PENDING',
      authorization_id: 'auth-1', authorization_status: 'ACTIVE',
      expires_at: new Date('2026-08-20T12:10:00.000Z')
    }], []],
    [existingAttempts, []],
    [[], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    providerInsert
  ];
}

test('atomically begins an authorized attempt in the required lock/write order', async () => {
  const pool = scriptedPool(beginResponses());
  const repository = createRechargeAttemptRepository(pool);
  const now = new Date('2026-08-20T12:00:00.000Z');
  const result = await repository.beginAuthorizedAttempt({
    orderId: 'order-1',
    taskId: 91,
    authorizationItemId: 'item-1',
    attemptId: 'attempt-1',
    idempotencyKey: 'idem-1',
    now
  });

  assert.deepEqual(result, {
    id: 'attempt-1', orderId: 'order-1', authorizationItemId: 'item-1',
    providerAccountId: 'provider-account-1', executorKind: 'API',
    status: 'PREPARED', fundsRiskState: 'ACTIVE', providerCallId: 501, startedAt: now
  });
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
  assert.match(pool.queries[0].sql, /FROM tasks[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[1].sql, /FROM orders o[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[2].sql, /recharge_authorization_items[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[5].sql, /INSERT INTO recharge_attempts/);
  assert.match(pool.queries[5].sql, /'PREPARED', 'ACTIVE'/);
  assert.match(pool.queries[6].sql, /status = 'CONSUMED'/);
  assert.match(pool.queries[7].sql, /SET status = \?, version = version \+ 1/);
  assert.match(pool.queries[8].sql, /INSERT INTO order_events/);
  assert.match(pool.queries[9].sql, /INSERT INTO provider_calls/);
  assert.deepEqual(pool.queries[9].values.slice(0, 4), [
    'order-1', 'attempt-1', 'new-provider', 'provider-account-1'
  ]);
  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /app_settings|dispatch_new_recharges|payload_json/i);
});

test('rolls back every write when provider-call persistence fails', async () => {
  const responses = beginResponses({ providerInsert: new Error('provider call insert failed') });
  const pool = scriptedPool(responses);
  const repository = createRechargeAttemptRepository(pool);
  await assert.rejects(repository.beginAuthorizedAttempt({
    orderId: 'order-1', taskId: 91, authorizationItemId: 'item-1', attemptId: 'attempt-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  }), /provider call insert failed/);
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('expired authorization cannot create a funds-risk attempt', async () => {
  const responses = beginResponses();
  responses[2] = [[{
    id: 'item-1', order_id: 'order-1', item_status: 'PENDING',
    authorization_id: 'auth-1', authorization_status: 'ACTIVE',
    expires_at: new Date('2026-08-20T11:59:59.000Z')
  }], []];
  const pool = scriptedPool(responses);
  const repository = createRechargeAttemptRepository(pool);
  await assert.rejects(repository.beginAuthorizedAttempt({
    orderId: 'order-1', taskId: 91, authorizationItemId: 'item-1', attemptId: 'attempt-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  }), (error) => error.code === 'AUTHORIZATION_EXPIRED');
  assert.equal(pool.queries.some((entry) => entry.sql.includes('INSERT INTO recharge_attempts')), false);
  assert.equal(pool.transaction.rolledBack, 1);
});

test('same order can begin only once when a competing funds fence exists', async () => {
  const firstPool = scriptedPool(beginResponses());
  await createRechargeAttemptRepository(firstPool).beginAuthorizedAttempt({
    orderId: 'order-1', taskId: 91, authorizationItemId: 'item-1', attemptId: 'attempt-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  });

  const secondPool = scriptedPool(beginResponses({
    existingAttempts: [{ id: 'attempt-1', funds_risk_state: 'ACTIVE' }]
  }));
  await assert.rejects(
    createRechargeAttemptRepository(secondPool).beginAuthorizedAttempt({
      orderId: 'order-1', taskId: 92, authorizationItemId: 'item-2', attemptId: 'attempt-2',
      now: new Date('2026-08-20T12:00:01.000Z')
    }),
    (error) => error.code === 'FUNDS_FENCE_EXISTS'
  );
  assert.equal(firstPool.transaction.committed, 1);
  assert.equal(secondPool.transaction.rolledBack, 1);
  assert.equal(secondPool.queries.some((entry) => entry.sql.includes('INSERT INTO recharge_attempts')), false);
});

function transitionResponses({ orderStatus = 'SUBMITTING', authorizationItemId = 'item-1',
  release = false, persistSubmission = false } = {}) {
  const responses = [
    [[{
      id: 'attempt-1', order_id: 'order-1', authorization_item_id: authorizationItemId,
      provider_account_id: 'provider-account-1', attempt_status: 'PREPARED', funds_risk_state: 'ACTIVE',
      order_status: orderStatus, order_version: 7
    }], []],
    [{ affectedRows: 1 }, []]
  ];
  if (release) {
    responses.push([{ affectedRows: 1 }, []]); // authorization release
    responses.push([{ affectedRows: 1 }, []]); // task reset
  }
  responses.push([{ affectedRows: 1 }, []]); // order
  if (persistSubmission) {
    responses.push([{ affectedRows: 1 }, []]); // clear cached card credentials
    responses.push([{ affectedRows: 1 }, []]); // enqueue polling
  }
  responses.push([{ affectedRows: 1 }, []]); // event
  responses.push([{ affectedRows: 1 }, []]); // provider call
  return responses;
}

test('UNKNOWN and SETTLED retain the order funds fence', async () => {
  const unknownPool = scriptedPool(transitionResponses());
  const unknown = await createRechargeAttemptRepository(unknownPool).markAttemptUnknown({
    attemptId: 'attempt-1', resultSummary: { code: 'timeout' },
    now: new Date('2026-08-20T12:01:00.000Z')
  });
  assert.equal(unknown.fundsRiskState, 'UNKNOWN');
  assert.deepEqual(unknownPool.queries[1].values.slice(0, 2), ['SUBMIT_UNKNOWN', 'UNKNOWN']);
  assert.equal(unknown.orderStatus, 'SUBMIT_UNKNOWN');

  const settledPool = scriptedPool(transitionResponses({ orderStatus: 'RECHARGE_PROCESSING' }));
  const settled = await createRechargeAttemptRepository(settledPool).markAttemptSettled({
    attemptId: 'attempt-1', externalOrderId: 'external-1',
    now: new Date('2026-08-20T12:02:00.000Z')
  });
  assert.equal(settled.fundsRiskState, 'SETTLED');
  assert.deepEqual(settledPool.queries[1].values.slice(0, 2), ['SUCCESS', 'SETTLED']);
  assert.equal(settled.orderStatus, 'RECHARGE_SUCCESS');
});

test('CLEARED releases the fence and consumed authorization for manual re-authorization', async () => {
  const pool = scriptedPool(transitionResponses({ orderStatus: 'SUBMIT_UNKNOWN', release: true }));
  const result = await createRechargeAttemptRepository(pool).markAttemptCleared({
    attemptId: 'attempt-1', resultSummary: { verifiedNoCharge: true },
    now: new Date('2026-08-20T12:03:00.000Z')
  });
  assert.equal(result.fundsRiskState, 'CLEARED');
  assert.equal(result.orderStatus, 'CARD_READY');
  assert.match(pool.queries[2].sql, /SET status = 'RELEASED'/);
  assert.deepEqual(pool.queries[2].values, ['item-1', 'attempt-1']);
  assert.match(pool.queries[3].sql, /UPDATE tasks/);
  assert.match(pool.queries[3].sql, /attempts = 0/);
  assert.doesNotMatch(pool.queries[3].sql, /payload_json/);
  assert.match(pool.queries[4].sql, /UPDATE orders/);
});

test('a settled attempt can never be cleared and release its fence', async () => {
  const pool = scriptedPool([[[{
    id: 'attempt-1', order_id: 'order-1', authorization_item_id: 'item-1',
    provider_account_id: 'provider-account-1', attempt_status: 'SUCCESS', funds_risk_state: 'SETTLED',
    order_status: 'RECHARGE_SUCCESS', order_version: 8
  }], []]]);
  await assert.rejects(
    createRechargeAttemptRepository(pool).markAttemptCleared({ attemptId: 'attempt-1' }),
    (error) => error.code === 'INVALID_ATTEMPT_TRANSITION'
  );
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.transaction.rolledBack, 1);
});

test('markAttemptSubmitted records external identity and moves to processing', async () => {
  const pool = scriptedPool(transitionResponses({ persistSubmission: true }));
  const result = await createRechargeAttemptRepository(pool).markAttemptSubmitted({
    attemptId: 'attempt-1', externalOrderId: 'external-1', externalReference: 'reference-1',
    now: new Date('2026-08-20T12:01:00.000Z')
  });
  assert.equal(result.status, 'PROCESSING');
  assert.equal(result.fundsRiskState, 'ACTIVE');
  assert.equal(result.orderStatus, 'RECHARGE_PROCESSING');
  assert.match(pool.queries[1].sql, /submitted_at = COALESCE/);
  assert.match(pool.queries[1].sql, /external_order_id = \?/);
  assert.match(pool.queries[2].sql, /recharge_order_no = \?/);
  assert.match(pool.queries[3].sql, /card_credentials_ciphertext = NULL/);
  assert.match(pool.queries[4].sql, /POLL_RECHARGE/);
});
