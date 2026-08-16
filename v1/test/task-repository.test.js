import assert from 'node:assert/strict';
import test from 'node:test';
import { claimNextTask } from '../src/db/repositories/task-repository.js';

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

  const task = await claimNextTask(pool, { workerId: 'worker-a', leaseSeconds: 90 });

  assert.equal(task.id, 7);
  assert.equal(task.attempts, 1);
  const selectCall = calls.find(([sql]) => typeof sql === 'string' && sql.includes('SELECT id'));
  assert.match(selectCall[0], /FOR UPDATE SKIP LOCKED/);
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
    { workerId: 'worker-b' }
  );

  assert.equal(task, null);
  assert.match(queries[0], /status = \? AND leased_until < CURRENT_TIMESTAMP\(3\)/);
});
