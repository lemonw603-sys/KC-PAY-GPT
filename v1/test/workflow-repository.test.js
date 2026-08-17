import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { OrderStatus } from '../src/domain/order-status.js';

test('recharge submission events do not duplicate the card key', async () => {
  const queries = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes('SELECT status, version')) {
        return [[{ status: OrderStatus.SUBMITTING, version: 1 }]];
      }
      if (sql.includes('UPDATE orders')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    }
  };
  const pool = { getConnection: async () => connection };
  const workflow = createWorkflowRepository(pool, {
    sessionEncryptionKey: Buffer.alloc(32, 1)
  });

  await workflow.commitRechargeSubmission('order-1', {
    orderNo: 'external-order-1',
    cardKey: 'DIRECT-sensitive-fixture'
  });

  const eventInsert = queries.find((query) => query.sql.includes('INSERT INTO order_events'));
  assert.deepEqual(JSON.parse(eventInsert.parameters[4]), { orderNo: 'external-order-1' });
  assert.equal(eventInsert.parameters[4].includes('DIRECT-sensitive-fixture'), false);
});
