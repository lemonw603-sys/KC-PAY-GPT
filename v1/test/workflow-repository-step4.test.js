import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { OrderStatus } from '../src/domain/order-status.js';

function harness(route) {
  const queries = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      return route(flat, params);
    }
  };
  const pool = { getConnection: async () => connection, query: connection.query };
  return { queries, workflow: createWorkflowRepository(pool, { sessionEncryptionKey: Buffer.alloc(32, 1) }) };
}

test('findStaleInventoryCandidate: an eligible card short-circuits (no candidate query); otherwise picks an API-synced, non-manual, >15min-stale, <5-failure card', async () => {
  const eligible = harness((sql) => {
    if (sql.startsWith('SELECT o.status')) return [[{ status: 'CREATED', minimum_required_card_balance: '16', card_provider_account_id: 'acct' }]];
    if (sql.startsWith('SELECT 1 FROM cards')) return [[{ 1: 1 }]];
    throw new Error(`unexpected ${sql.slice(0, 40)}`);
  });
  assert.equal(await eligible.workflow.findStaleInventoryCandidate('o1'), null);
  assert.equal(eligible.queries.length, 2);

  const stale = harness((sql) => {
    if (sql.startsWith('SELECT o.status')) return [[{ status: 'WAITING_FOR_CARD', minimum_required_card_balance: '16', card_provider_account_id: 'acct' }]];
    if (sql.startsWith('SELECT 1 FROM cards')) return [[]];
    if (sql.startsWith('SELECT cards.id')) return [[{ id: 'c1', provider_card_id: '5622', card_type_id: 23, funded_amount: '50', provider_account_id: 'acct', last_transaction_synced_at: null }]];
    throw new Error(`unexpected ${sql.slice(0, 40)}`);
  });
  const candidate = await stale.workflow.findStaleInventoryCandidate('o1');
  assert.deepEqual(candidate, { id: 'c1', providerCardId: '5622', providerAccountId: 'acct', cardTypeId: 23, fundedAmount: '50', minimumRequiredBalance: '16', lastTransactionSyncedAt: null });
  const candidateSql = stale.queries[2].sql;
  assert.match(candidateSql, /stale_pa\.supports_api_sync = 1/);
  assert.match(candidateSql, /sync_tier <> 'MANUAL_IMPORT'/);
  assert.match(candidateSql, /INTERVAL 15 MINUTE/);
  assert.match(candidateSql, /sync_consecutive_failures, 0\) < 5/);
  assert.equal(stale.queries.some((q) => /INSERT/.test(q.sql)), false, 'candidate lookup is read-only');
});

test('assignAvailableCard with no eligible card no longer inserts a card_sync_jobs row (on-demand sync replaced it)', async () => {
  const h = harness((sql) => {
    if (sql.startsWith('SELECT o.status')) return [[{ status: 'CREATED', version: 1, card_type_id: 7, product_id: 'p', open_card_amount: '50', minimum_required_card_balance: '16', fulfillment_route_id: 'r', card_provider_account_id: 'acct' }]];
    if (sql.startsWith('SELECT id, supports_api_sync')) return [[{ id: 'acct', supports_api_sync: 1, supports_auto_open: 1 }]];
    if (sql.startsWith('SELECT id, provider_card_id, current_balance')) return [[]];
    if (sql.startsWith('SELECT COUNT(*) AS count FROM cards')) return [[{ count: 0 }]];
    if (sql.startsWith('SELECT c.id, c.current_balance')) return [[]];
    if (sql.startsWith('SELECT setting_key, setting_value')) return [[{ setting_key: 'card_auto_replenishment_enabled', setting_value: 'true' }]];
    return [{ affectedRows: 1 }];
  });
  const result = await h.workflow.assignAvailableCard('o1');
  assert.deepEqual(result, { waitingForCard: true, replenishmentPending: true });
  assert.equal(h.queries.some((q) => /card_sync_jobs/.test(q.sql)), false);
  assert.equal(h.queries.some((q) => /UPDATE orders SET status = \?/.test(q.sql) && q.params[0] === OrderStatus.WAITING_FOR_CARD), true);
});

test('assignAvailableCard without an eligible card: funding line is gone (D-367) — auto-open on hands it to the scheduler, no human alert', async () => {
  const route = (autoOpen) => (sql) => {
    if (sql.startsWith('SELECT o.status')) return [[{ status: 'CREATED', version: 1, card_type_id: 7, product_id: 'p', plan_type: 'plus', open_card_amount: '50', minimum_required_card_balance: '16', fulfillment_route_id: 'r', card_provider_account_id: 'acct' }]];
    if (sql.startsWith('SELECT id, supports_api_sync')) return [[{ id: 'acct', supports_api_sync: 1, supports_auto_open: 1 }]];
    if (sql.startsWith('SELECT id, provider_card_id, current_balance')) return [[]];
    if (sql.startsWith('SELECT setting_key, setting_value')) return [autoOpen ? [{ setting_key: 'card_auto_replenishment_enabled', setting_value: 'true' }] : []];
    return [{ affectedRows: 1 }];
  };
  const on = harness(route(true));
  assert.deepEqual(await on.workflow.assignAvailableCard('o1'), { waitingForCard: true, replenishmentPending: true });
  assert.equal(on.queries.some((q) => /card_funding_attempts|card_balance_recharge_enabled|supports_auto_funding/.test(q.sql)), false);
  assert.equal(on.queries.some((q) => /INSERT INTO operator_alerts/.test(q.sql)), false, '自动开卡开着：不叫人，开不出来由调度器的供卡告警叫');
  assert.equal(on.queries.some((q) => /UPDATE operator_alerts SET status='RESOLVED'/.test(q.sql)), true);

  const off = harness(route(false));
  assert.deepEqual(await off.workflow.assignAvailableCard('o1'), { waitingForCard: true });
  const alert = off.queries.find((q) => /INSERT INTO operator_alerts/.test(q.sql));
  assert.ok(alert, '自动开卡关着：照旧推「订单在等卡」叫人');
  assert.equal(alert.params[2], '当前没有可用于 Plus 的卡，订单正在等待处理。');
});

test('commitCancellationStatus(exhausted): order delivers as RECHARGE_SUCCESS with review flag + reminder alert, never CANCELLATION_REVIEW_REQUIRED (D-248)', async () => {
  const h = harness((sql) => {
    if (sql.startsWith('SELECT status, version')) return [[{ status: OrderStatus.CANCELLATION_PENDING, version: 3 }]];
    if (sql.startsWith('SELECT public_no')) return [[{ public_no: 'PJV1-x' }]];
    return [{ affectedRows: 1 }];
  });
  await h.workflow.commitCancellationStatus('o1', { status: 'success', isSubscriptionCancelled: 0 }, null, { exhausted: true });
  const update = h.queries.find((q) => q.sql.startsWith('UPDATE orders SET status = ?'));
  assert.equal(update.params[0], OrderStatus.RECHARGE_SUCCESS);
  assert.equal(update.params[4], 0, 'subscription_cancelled stays 0');
  assert.equal(update.params[5], 1, 'cancellation_review_required = 1 is the fact that feeds the retirement list');
  const event = h.queries.find((q) => /INSERT INTO order_events/.test(q.sql));
  assert.equal(event.params[2], OrderStatus.RECHARGE_SUCCESS);
  assert.match(event.params[3], /queued for retirement/);
  const alert = h.queries.find((q) => /ORDER_CANCELLATION_UNCONFIRMED/.test(q.sql));
  assert.equal(alert.params[0], 'order-cancellation-unconfirmed:o1');
  assert.match(alert.params[3], /PJV1-x/);
  assert.equal(h.queries.some((q) => JSON.stringify(q.params || []).includes('CANCELLATION_REVIEW_REQUIRED')), false);

  const pending = harness((sql) => sql.startsWith('SELECT status, version') ? [[{ status: OrderStatus.CANCELLATION_PENDING, version: 3 }]] : [{ affectedRows: 1 }]);
  await pending.workflow.commitCancellationStatus('o1', { status: 'success', isSubscriptionCancelled: 0 }, null, { exhausted: false });
  assert.equal(pending.queries.find((q) => q.sql.startsWith('UPDATE orders SET status = ?')).params[0], OrderStatus.CANCELLATION_PENDING);
  assert.equal(pending.queries.some((q) => /ORDER_CANCELLATION_UNCONFIRMED/.test(q.sql)), false);
});

test('escalateUnknownSubmission: SUBMIT_UNKNOWN → RECONCILIATION_REQUIRED with event + alert + case all carrying both evidence lines; funds fence untouched', async () => {
  const h = harness((sql) => {
    if (sql.startsWith('SELECT o.status')) return [[{ status: OrderStatus.SUBMIT_UNKNOWN, version: 2, public_no: 'PJV1-y', attempt_id: 'att-1' }]];
    return [{ affectedRows: 1 }];
  });
  const evidence = { account: { available: false, summary: '账号状态：ZZSHU 没有返回 cardKey，无法查询' },
    card: { available: true, charged: true, summary: '卡台扣款：提交后卡台流水里有 1 笔 OpenAI 成功扣款（15.71 USD）', candidates: [{ amount: '15.71' }] } };
  const result = await h.workflow.escalateUnknownSubmission('o1', { reasonCode: 'CARD_CHARGED_ACCOUNT_UNVERIFIABLE', evidence });
  assert.equal(result.replayed, false);
  const update = h.queries.find((q) => q.sql.startsWith('UPDATE orders SET status = ?'));
  assert.equal(update.params[0], OrderStatus.RECONCILIATION_REQUIRED);
  assert.equal(h.queries.some((q) => /^UPDATE (recharge_attempts|card_consumption_ledger|card_assignment_history)/.test(q.sql)), false, 'funds fence is not released');
  const alert = h.queries.find((q) => /ORDER_PAYMENT_UNKNOWN_REVIEW/.test(q.sql));
  assert.match(alert.params[3], /没有返回 cardKey/);
  assert.match(alert.params[3], /1 笔 OpenAI 成功扣款/);
  const kase = h.queries.find((q) => /INSERT INTO reconciliation_cases/.test(q.sql));
  assert.equal(kase.params[0], 'api-payment-unknown:o1');
  assert.equal(JSON.parse(kase.params[3]).card.charged, true);
  const replay = harness((sql) => sql.startsWith('SELECT o.status') ? [[{ status: OrderStatus.RECONCILIATION_REQUIRED, version: 3, public_no: 'PJV1-y', attempt_id: 'att-1' }]] : [{ affectedRows: 1 }]);
  assert.equal((await replay.workflow.escalateUnknownSubmission('o1', { reasonCode: 'X' })).replayed, true);
});
