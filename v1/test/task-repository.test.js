import assert from 'node:assert/strict';
import test from 'node:test';
import { claimNextTask, failTask } from '../src/db/repositories/task-repository.js';

test('claims a pending task with a durable lease', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push(['begin']),
    query: async (sql, parameters) => {
      calls.push([sql, parameters]);
      if (sql.includes('SELECT id, order_id')) {
        return [[{
          id: 7,
          order_id: 'order-1',
          task_type: 'PURCHASE_CARD',
          attempts: 0,
          max_attempts: 5,
          payload_json: null
        }]];
      }
      return [{ affectedRows: 1 }];
    },
    commit: async () => calls.push(['commit']),
    rollback: async () => calls.push(['rollback']),
    release: () => calls.push(['release'])
  };
  const pool = { getConnection: async () => connection };

  const task = await claimNextTask(pool, {
    workerId: 'worker-a', leaseSeconds: 90, rechargeDispatchMode: 'AUTOMATIC',
    allowedRechargeExecutorKinds: ['API']
  });

  assert.equal(task.id, 7);
  assert.equal(task.attempts, 1);
  const selectCall = calls.find(([sql]) => typeof sql === 'string' && sql.includes('SELECT id'));
  assert.match(selectCall[0], /FOR UPDATE SKIP LOCKED/);
  assert.match(selectCall[0], /INNER JOIN fulfillment_routes/);
  assert.match(selectCall[0], /fr\.executor_kind = 'API' AND pa\.write_enabled = 1/);
  assert.match(selectCall[0], /fr\.executor_kind = 'BROWSER'/);
  assert.match(selectCall[0], /browser_dispatch_enabled/);
  assert.match(selectCall[0], /browser_profile\.status = 'ACTIVE'/);
  assert.match(selectCall[0], /browser_preflight\.task_type = 'BROWSER_PREFLIGHT'/);
  assert.match(selectCall[0], /JSON_EXTRACT\(browser_preflight\.payload_json, '\$\.outcome'\)/);
  assert.match(selectCall[0], /funds_risk_state IN \('ACTIVE', 'UNKNOWN', 'SETTLED'\)/);
  assert.match(selectCall[0], /pc\.recharge_attempt_id IS NULL/);
  assert.match(selectCall[0], /recharge_authorization_items manual_item/);
  assert.equal(selectCall[1][0], 'AUTOMATIC');
  assert.equal(selectCall[1][1], 'API');
  assert.doesNotMatch(selectCall[0], /rechargePermit/);
  const updateCall = calls.find(([sql]) => typeof sql === 'string' && sql.includes('UPDATE tasks'));
  assert.deepEqual(updateCall[1].slice(0, 3), ['RUNNING', 'worker-a', 90]);
  assert.equal(calls.some(([name]) => name === 'commit'), true);
  assert.equal(calls.some(([name]) => name === 'release'), true);
});

test('expired running tasks remain reclaimable after a worker crash', async () => {
  const queries = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('SELECT id, order_id')) return [[]];
      return [{ affectedRows: 0 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };

  const task = await claimNextTask(
    { getConnection: async () => connection },
    { workerId: 'worker-b', rechargeDispatchMode: 'AUTOMATIC' }
  );

  assert.equal(task, null);
  assert.match(queries[0], /status = \? AND leased_until < CURRENT_TIMESTAMP\(3\)/);
});

test('task claiming honors the allowed task-type boundary', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, parameters) => {
      calls.push([sql, parameters]);
      if (sql.includes('SELECT id, order_id')) return [[]];
      return [{ affectedRows: 0 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };
  const pool = { getConnection: async () => connection };

  assert.equal(await claimNextTask(pool, {
    workerId: 'worker-filtered',
    allowedTaskTypes: [],
    rechargeDispatchMode: 'AUTOMATIC'
  }), null);
  assert.equal(calls.length, 0);

  await claimNextTask(pool, {
    workerId: 'worker-filtered',
    allowedTaskTypes: ['POLL_RECHARGE'],
    rechargeDispatchMode: 'AUTOMATIC'
  });
  assert.match(calls[0][0], /task_type IN \(\?\)/);
  assert.deepEqual(calls[0][1], ['AUTOMATIC', 'PENDING', 'RUNNING', 'POLL_RECHARGE']);
});

test('manual dispatch mode claims only explicit SINGLE or BATCH authorizations', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, parameters) => {
      calls.push([sql, parameters]);
      if (sql.includes('SELECT id, order_id')) return [[]];
      return [{ affectedRows: 0 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };
  await claimNextTask({ getConnection: async () => connection }, {
    workerId: 'worker-gray',
    allowedTaskTypes: ['SUBMIT_RECHARGE'],
    allowedRechargeExecutorKinds: ['API'],
    rechargeDispatchMode: 'MANUAL'
  });
  assert.equal(calls[0][1][0], 'MANUAL');
  assert.match(calls[0][0], /authorization_mode IN \('SINGLE', 'BATCH'\)/);
  assert.match(calls[0][0], /manual_auth\.expires_at > UTC_TIMESTAMP/);
  assert.match(calls[0][0], /fr\.executor_kind IN \(\?\)/);
  assert.equal(calls[0][1][1], 'API');
});

test('submit task claim is restricted to this process executor capabilities', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, parameters) => {
      calls.push([sql, parameters]);
      if (sql.includes('SELECT id, order_id')) return [[]];
      return [{ affectedRows: 0 }];
    }
  };
  await claimNextTask({ getConnection: async () => connection }, {
    workerId: 'browser-only', allowedTaskTypes: ['SUBMIT_RECHARGE'],
    allowedRechargeExecutorKinds: ['BROWSER'], rechargeDispatchMode: 'AUTOMATIC'
  });
  assert.match(calls[0][0], /fr\.executor_kind IN \(\?\)/);
  assert.equal(calls[0][1][1], 'BROWSER');
  assert.equal(calls[0][1].includes('API'), false);
});

test('recoverable configuration waiting cannot exhaust the task retry budget', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, parameters) => {
      calls.push([sql, parameters]);
      if (sql.includes('SELECT attempts')) return [[{ attempts: 5, max_attempts: 5 }]];
      return [{ affectedRows: 1 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };
  const result = await failTask({ getConnection: async () => connection }, {
    taskId: 9,
    workerId: 'worker-a',
    errorCode: 'RECHARGE_CONFIGURATION_BLOCKED',
    errorMessage: 'waiting',
    retryAt: new Date('2026-08-22T01:00:00.000Z'),
    refundAttempt: true
  });

  // Exhaustion is evaluated after refunding the current claim.
  assert.equal(result.status, 'PENDING');
  const update = calls.find(([sql]) => sql.includes('UPDATE tasks'));
  assert.match(update[0], /GREATEST\(attempts - 1, 0\)/);
  assert.equal(update[1][2], 1);
});
