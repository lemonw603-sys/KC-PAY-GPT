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
  assert.equal(queries.some((query) => /card_credentials_ciphertext = NULL/.test(query.sql)), false);
});

test('confirmed recharge failure persists the redacted Provider reason on the order', async () => {
  const queries = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes('SELECT status, version FROM orders')) {
        return [[{ status: OrderStatus.RECHARGE_PROCESSING, version: 4 }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const workflow = createWorkflowRepository({ getConnection: async () => connection }, {
    sessionEncryptionKey: Buffer.alloc(32, 1)
  });

  await workflow.commitRechargeFailure('order-1', {
    status: 'failed',
    failureReason: '卡片被拒；sessionToken=secret-value'
  });

  const orderUpdate = queries.find((query) => /failure_code = 'PROVIDER_CONFIRMED_FAILURE'/.test(query.sql));
  assert.ok(orderUpdate);
  assert.equal(orderUpdate.parameters[1], '卡片被拒；sessionToken=[REDACTED]');
  assert.equal(orderUpdate.parameters.includes('secret-value'), false);
  const syncInsert = queries.find((query) => query.sql.includes('failed-recharge-reconcile:'));
  assert.ok(syncInsert);
  assert.deepEqual(syncInsert.parameters, ['order-1', 'order-1']);
});
