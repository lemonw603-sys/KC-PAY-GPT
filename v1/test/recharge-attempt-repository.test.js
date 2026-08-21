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

function beginResponses({
  existingAttempts = [], providerInsert = [{ insertId: 501 }, []], orderOverrides = {},
  dispatchEnabled = true, dispatchMode = 'AUTOMATIC', authorizationMode = 'MANUAL'
} = {}) {
  return [
    [[{ id: 91, order_id: 'order-1', status: 'RUNNING', attempts: 1 }], []],
    [[{
      id: 'order-1', status: 'CARD_READY', version: 7,
      fulfillment_route_id: 'route-1', executor_kind: 'API',
      recharge_provider_account_id: 'provider-account-1', provider_code: 'new-provider', write_enabled: 1,
      minimum_required_card_balance: '16', card_status: 'active', card_balance: '25',
      card_credentials_ciphertext: Buffer.from('encrypted'),
      card_last_synced_at: new Date('2026-08-20T11:59:00.000Z'), prepayment_ready: 1,
      ...orderOverrides
    }], []],
    [[
      { setting_key: 'dispatch_new_recharges', setting_value: String(dispatchEnabled) },
      { setting_key: 'recharge_dispatch_mode', setting_value: dispatchMode }
    ], []],
    [existingAttempts, []],
    [[], []],
    [[{
      id: 'item-1', order_id: 'order-1', item_status: 'PENDING',
      authorization_id: 'auth-1', authorization_mode: authorizationMode, authorization_status: 'ACTIVE',
      expires_at: new Date('2026-08-20T12:10:00.000Z')
    }], []],
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
    now
  });

  assert.deepEqual(result, {
    id: 'attempt-1', orderId: 'order-1', authorizationItemId: 'item-1',
    authorizationMode: 'MANUAL',
    dispatchMode: 'AUTOMATIC',
    providerAccountId: 'provider-account-1', executorKind: 'API',
    status: 'PREPARED', fundsRiskState: 'ACTIVE', providerCallId: 501,
    idempotencyKey: 'recharge-auth-item:item-1', startedAt: now
  });
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
  assert.match(pool.queries[0].sql, /FROM tasks[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[1].sql, /FROM orders o[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[2].sql, /FROM app_settings[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[3].sql, /FROM recharge_attempts[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[5].sql, /recharge_authorization_items[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[6].sql, /INSERT INTO recharge_attempts/);
  assert.match(pool.queries[6].sql, /'PREPARED', 'ACTIVE'/);
  assert.equal(pool.queries[6].values[6], 'recharge-auth-item:item-1');
  assert.match(pool.queries[7].sql, /status = 'CONSUMED'/);
  assert.match(pool.queries[8].sql, /SET status = \?, version = version \+ 1/);
  assert.match(pool.queries[9].sql, /INSERT INTO order_events/);
  assert.match(pool.queries[10].sql, /INSERT INTO provider_calls/);
  assert.match(pool.queries[10].sql, /'create_direct'/);
  assert.deepEqual(pool.queries[10].values.slice(0, 4), [
    'order-1', 'attempt-1', 'new-provider', 'provider-account-1'
  ]);
  assert.equal(pool.queries[10].values[4], 'recharge-auth-item:item-1');
  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /payload_json/i);
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
  responses[5] = [[{
    id: 'item-1', order_id: 'order-1', item_status: 'PENDING',
    authorization_id: 'auth-1', authorization_mode: 'MANUAL', authorization_status: 'ACTIVE',
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

test('cannot create funds intent before preparation and fresh card checks pass', async () => {
  for (const [orderOverrides, code] of [
    [{ prepayment_ready: 0 }, 'PREPAYMENT_NOT_READY'],
    [{ card_last_synced_at: new Date('2026-08-20T11:40:00.000Z') }, 'CARD_CHECK_STALE'],
    [{ card_balance: '1' }, 'CARD_NOT_READY']
  ]) {
    const pool = scriptedPool(beginResponses({ orderOverrides }));
    await assert.rejects(
      createRechargeAttemptRepository(pool).beginAuthorizedAttempt({
        orderId: 'order-1', taskId: 91, attemptId: `attempt-${code}`,
        now: new Date('2026-08-20T12:00:00.000Z')
      }),
      (error) => error.code === code
    );
    assert.equal(pool.queries.some((entry) => /INSERT INTO recharge_attempts/.test(entry.sql)), false);
    assert.equal(pool.queries.some((entry) => /INSERT INTO provider_calls/.test(entry.sql)), false);
  }
});

test('automatically creates and consumes one auditable authorization when none exists', async () => {
  const now = new Date('2026-08-20T12:00:00.000Z');
  const responses = beginResponses();
  responses[5] = [[], []];
  responses.splice(6, 0,
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  );
  const pool = scriptedPool(responses);
  const result = await createRechargeAttemptRepository(pool).beginAuthorizedAttempt({
    orderId: 'order-1', taskId: 91, attemptId: 'attempt-auto', now
  });

  assert.equal(result.authorizationMode, 'AUTOMATIC');
  assert.match(result.idempotencyKey, /^recharge-auth-item:/);
  assert.match(pool.queries[6].sql, /SET rai\.status = 'EXPIRED'/);
  assert.match(pool.queries[7].sql, /INSERT INTO recharge_authorizations/);
  assert.match(pool.queries[7].sql, /'AUTOMATIC'/);
  assert.match(pool.queries[8].sql, /INSERT INTO recharge_authorization_items/);
  assert.match(pool.queries[9].sql, /INSERT INTO recharge_attempts/);
  assert.match(pool.queries[11].sql, /SET status = 'CONSUMED'/);
  assert.match(pool.queries[14].sql, /INSERT INTO provider_calls/);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
});

test('transactional dispatch gate blocks funds writes after dispatch is disabled', async () => {
  const pool = scriptedPool(beginResponses({ dispatchEnabled: false }));
  await assert.rejects(
    createRechargeAttemptRepository(pool).beginAuthorizedAttempt({
      orderId: 'order-1', taskId: 91, attemptId: 'attempt-disabled',
      now: new Date('2026-08-20T12:00:00.000Z')
    }),
    (error) => error.code === 'DISPATCH_DISABLED'
  );
  assert.equal(pool.queries.some((entry) => /INSERT INTO recharge_attempts/.test(entry.sql)), false);
  assert.equal(pool.queries.some((entry) => /INSERT INTO provider_calls/.test(entry.sql)), false);
  assert.equal(pool.transaction.rolledBack, 1);
});

test('manual mode cannot synthesize an automatic authorization', async () => {
  const responses = beginResponses({ dispatchMode: 'MANUAL' });
  responses[5] = [[], []];
  const pool = scriptedPool(responses);
  await assert.rejects(
    createRechargeAttemptRepository(pool).beginAuthorizedAttempt({
      orderId: 'order-1', taskId: 91, attemptId: 'attempt-manual',
      now: new Date('2026-08-20T12:00:00.000Z')
    }),
    (error) => error.code === 'MANUAL_AUTHORIZATION_REQUIRED'
  );
  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /INSERT INTO recharge_authorizations/);
  assert.doesNotMatch(allSql, /INSERT INTO recharge_attempts/);
  assert.doesNotMatch(allSql, /INSERT INTO provider_calls/);
});

test('manual mode rejects an explicitly requested automatic authorization item', async () => {
  const pool = scriptedPool(beginResponses({
    dispatchMode: 'MANUAL', authorizationMode: 'AUTOMATIC'
  }));
  await assert.rejects(
    createRechargeAttemptRepository(pool).beginAuthorizedAttempt({
      orderId: 'order-1', taskId: 91, authorizationItemId: 'item-1',
      attemptId: 'attempt-explicit-auto', now: new Date('2026-08-20T12:00:00.000Z')
    }),
    (error) => error.code === 'MANUAL_AUTHORIZATION_REQUIRED'
  );
  assert.equal(pool.queries.some((entry) => /INSERT INTO recharge_attempts/.test(entry.sql)), false);
  assert.equal(pool.queries.some((entry) => /INSERT INTO provider_calls/.test(entry.sql)), false);
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
  release = false, resetTask = release, persistSubmission = false } = {}) {
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
  }
  if (resetTask) {
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

test('UNKNOWN retains the order funds fence', async () => {
  const unknownPool = scriptedPool(transitionResponses());
  const unknown = await createRechargeAttemptRepository(unknownPool).markAttemptUnknown({
    attemptId: 'attempt-1', resultSummary: { code: 'timeout' },
    now: new Date('2026-08-20T12:01:00.000Z')
  });
  assert.equal(unknown.fundsRiskState, 'UNKNOWN');
  assert.deepEqual(unknownPool.queries[1].values.slice(0, 2), ['SUBMIT_UNKNOWN', 'UNKNOWN']);
  assert.equal(unknown.orderStatus, 'SUBMIT_UNKNOWN');

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

test('a definite pre-create rejection atomically clears funds and closes the order', async () => {
  const now = new Date('2026-08-20T12:03:00.000Z');
  const pool = scriptedPool(transitionResponses({ release: true, resetTask: false }));
  const result = await createRechargeAttemptRepository(pool).markAttemptRejected({
    attemptId: 'attempt-1', resultSummary: { code: 'CAPACITY_REJECTED' }, now
  });
  assert.equal(result.fundsRiskState, 'CLEARED');
  assert.equal(result.orderStatus, 'RECHARGE_FAILED');
  assert.match(pool.queries[3].sql, /failure_code = 'RECHARGE_SUBMIT_REJECTED'/);
  assert.match(pool.queries[3].sql, /customer_action_code = NULL/);
  assert.equal(pool.queries.some((entry) => /UPDATE tasks/.test(entry.sql)), false);
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
