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
      if (sql.includes('SELECT status, version, public_no FROM orders')) {
        return [[{ status: OrderStatus.RECHARGE_PROCESSING, version: 4, public_no: 'PJV1-api-fail' }]];
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
  // D-401：没有只读流水接口的卡（MANUAL_IMPORT）不排同步——排了 runner 只会拿去问 hnskj、必失败。
  assert.match(syncInsert.sql, /sync_tier <> 'MANUAL_IMPORT'/);
  // D-401：提交后失败要叫人（卡占用转对账、卡密不自动退），推送文案带单号、原因已脱敏。
  const alert = queries.find((query) => /INSERT INTO operator_alerts/.test(query.sql) && /'API_ORDER_FAILED'/.test(query.sql));
  assert.ok(alert, 'API route failure raises an API_ORDER_FAILED alert');
  assert.equal(alert.parameters[0], 'api-order-failed:order-1');
  assert.match(alert.parameters[2], /^订单 PJV1-api-fail｜直充平台返回失败：卡片被拒；sessionToken=\[REDACTED\]。/);
  assert.equal(alert.parameters[2].includes('secret-value'), false);
});

// D-401：API 路线也会用没有只读流水接口的卡（MANUAL_IMPORT / highvcc）。三处排同步任务都按同一口径跳过它们
// （与 card-sync-job-service 定时排队一致），否则 runner 拿它的 id 去问 hnskj、必失败进 REVIEW_REQUIRED。
function recordingWorkflow(routes) {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      for (const [pattern, result] of routes) if (pattern.test(sql)) return result;
      return [{ affectedRows: 1 }];
    }
  };
  const workflow = createWorkflowRepository({ getConnection: async () => connection }, { sessionEncryptionKey: Buffer.alloc(32, 1) });
  return { queries, workflow };
}

test('D-401: post-recharge success sync skips manual-import cards', async () => {
  const { queries, workflow } = recordingWorkflow([
    [/SELECT status, version FROM orders/, [[{ status: OrderStatus.RECHARGE_PROCESSING, version: 2 }]]]
  ]);
  await workflow.commitRechargeSuccess('order-1', { status: 'success', isSubscriptionCancelled: 1 });
  const syncInsert = queries.find((query) => query.sql.includes("CONCAT('post-recharge:'"));
  assert.ok(syncInsert, 'post-recharge sync insert still issued for cards with a read API');
  assert.match(syncInsert.sql, /c\.sync_tier <> 'MANUAL_IMPORT'/);
});

test('D-401: stale-evidence sync request skips manual-import cards', async () => {
  const { queries, workflow } = recordingWorkflow([
    [/SELECT c\.id AS card_id/, [[{ card_id: 'card-1' }]]],
    [/INSERT INTO card_sync_jobs/, [{ affectedRows: 0 }]]
  ]);
  const result = await workflow.queueAssignedCardTransactionSync('order-1');
  assert.deepEqual(result, { queued: false, cardId: 'card-1' });
  const insert = queries.find((query) => /INSERT INTO card_sync_jobs/.test(query.sql));
  assert.match(insert.sql, /sc\.sync_tier <> 'MANUAL_IMPORT'/);
  assert.deepEqual(insert.parameters, ['card-1', 'order-demand-transaction-sync:order-1', 'card-1', 'card-1']);
});
